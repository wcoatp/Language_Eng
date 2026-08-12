#!/usr/bin/env node
/* Turn any audio or video into sentence-aligned lessons with real human speech.

   This is the shared engine behind two very different sources:

     public-domain media  ->  --mode repo   ->  content/lessons + content/audio
     your own films/casts ->  --mode pack   ->  a portable .echopack you keep

   Only ever use --mode repo on material you may legally redistribute. The repo
   is public, so anything written there is published. Personal media belongs in
   a pack, which never leaves your devices.

   Setup once:
     brew install whisper-cpp ffmpeg
     mkdir -p models && curl -L -o models/ggml-large-v3-turbo.bin \
       https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin

   Examples:
     node tools/align-media.mjs episode.mp3 --title "A Day in Court" --mode pack
     node tools/align-media.mjs https://host/clip.mp3 --mode repo --topic media --source-note "VOA"
*/

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rm, mkdtemp, access } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- args ---------- */

const argv = process.argv.slice(2);
const input = argv.find(a => !a.startsWith('--'));
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const has = name => argv.includes(`--${name}`);

if (!input || has('help')) {
  console.log(`usage: node tools/align-media.mjs <file|url> [options]

  --title "..."        lesson title (default: from filename)
  --mode repo|pack     repo = publishable content/ files, pack = private .echopack (default pack)
  --topic X            daily|work|travel|media|science|custom
  --accent us|gb|...   audio folder for repo mode (default: real)
  --chunk N            sentences per lesson (default 15)
  --level N            force a level instead of scoring it
  --id-prefix X        lesson id prefix (default derived from title)
  --model PATH         whisper model (default models/ggml-large-v3-turbo.bin)
  --source-note "..."  attribution recorded in the lesson
  --source-url "..."   attribution link
  --max-sentences N    stop after N sentences (useful while testing)
  --keep-temp          leave the working directory for inspection
`);
  process.exit(input ? 0 : 1);
}

const MODE = flag('mode', 'pack');
if (!['repo', 'pack'].includes(MODE)) {
  console.error(`--mode must be "repo" or "pack"`);
  process.exit(1);
}
const CHUNK = Number(flag('chunk', 15));
const ACCENT = String(flag('accent', 'real'));
const MODEL = String(flag('model', join(root, 'models', 'ggml-large-v3-turbo.bin')));
const TOPIC = String(flag('topic', 'custom'));
const MAX_SENTENCES = Number(flag('max-sentences', 0)) || Infinity;

const exists = p => access(p).then(() => true, () => false);

/* ---------- preflight ---------- */

for (const [bin, hint] of [['ffmpeg', 'brew install ffmpeg'], ['whisper-cli', 'brew install whisper-cpp']]) {
  try {
    await run(bin, ['-h']).catch(() => run(bin, ['--help']));
  } catch {
    console.error(`${bin} not found. Install it with: ${hint}`);
    process.exit(1);
  }
}
if (!await exists(MODEL)) {
  console.error(`whisper model not found at ${MODEL}
Download one with:
  mkdir -p models && curl -L -o models/ggml-large-v3-turbo.bin \\
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin`);
  process.exit(1);
}

/* ---------- fetch / locate source ---------- */

const work = await mkdtemp(join(tmpdir(), 'echo-align-'));
const cleanup = async () => { if (!has('keep-temp')) await rm(work, { recursive: true, force: true }); };

let source = input;
if (/^https?:\/\//i.test(input)) {
  const dest = join(work, 'source' + (extname(new URL(input).pathname) || '.mp3'));
  process.stdout.write(`downloading ${input}\n`);
  const res = await fetch(input, {
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15' },
  });
  if (!res.ok) { console.error(`download failed: ${res.status}`); await cleanup(); process.exit(1); }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  source = dest;
} else if (!await exists(source)) {
  console.error(`file not found: ${source}`);
  await cleanup();
  process.exit(1);
}

const TITLE = String(flag('title', basename(source, extname(source)).replace(/[-_]+/g, ' ')));

/* ---------- transcribe ---------- */

// whisper.cpp wants 16 kHz mono PCM regardless of what the source is.
const wav = join(work, 'audio.wav');
process.stdout.write('extracting audio\n');
await run('ffmpeg', ['-y', '-i', source, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav],
  { maxBuffer: 1 << 26 });

const durationSec = Number(
  (await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', wav])).stdout.trim());
process.stdout.write(`transcribing ${fmtTime(durationSec)} of audio (this is the slow step)\n`);

const jsonBase = join(work, 'out');

/* Sentence splitting depends entirely on punctuation, and whisper occasionally
   returns a whole episode as unpunctuated lowercase text. When that happens the
   lesson degenerates into a few run-on blocks, so detect it and re-decode once
   with an initial prompt that primes the model's written style. */
const PUNCTUATION_PROMPT =
  'Hello, and welcome. This is a news report, written with full punctuation, ' +
  'capital letters, commas and full stops.';

async function transcribe(prompt) {
  const args = [
    '-m', MODEL,
    '-f', wav,
    '-l', 'en',
    '-ojf',                 // full JSON: per-token offsets and confidence
    '-of', jsonBase,
    '-ml', '0',             // natural segment lengths; we re-join into sentences
    '-sow',
    '-pp',
  ];
  if (prompt) args.push('--prompt', prompt, '--carry-initial-prompt');
  await run('whisper-cli', args, { maxBuffer: 1 << 28 });
  return JSON.parse(await readFile(`${jsonBase}.json`, 'utf8'));
}

function punctuationRate(doc) {
  const segs = (doc.transcription || []).map(t => (t.text || '').trim()).filter(Boolean);
  if (!segs.length) return 1;
  return segs.filter(t => /[.!?]["')\]]?$/.test(t)).length / segs.length;
}

let raw = await transcribe(null);
if (punctuationRate(raw) < 0.25) {
  process.stdout.write('transcript came back unpunctuated, re-running with a style prompt\n');
  const retry = await transcribe(PUNCTUATION_PROMPT);
  if (punctuationRate(retry) > punctuationRate(raw)) raw = retry;
  else process.stdout.write('note: still unpunctuated — sentences will be split on length alone\n');
}

/* ---------- tokens -> sentences ---------- */

/* Whisper's own segments are laid out for subtitles, so one can hold several
   sentences and run past 12 seconds — far too long to shadow. Rebuilding from
   token timestamps gives one sentence per unit with exact boundaries. */

// Every whisper control token starts "[_" — [_BEG_], [_TT_446], [_SOT_] and so on.
const SPECIAL = /^\[_/;
const NOISE = /^[\[\(](music|applause|laughter|silence|sound|noise|blank_audio|inaudible)[^\])]*[\]\)]$/i;
const SENTENCE_END = /[.!?]["')\]]?$/;
const MAX_SECONDS = 14;                        // beyond this, shadowing breaks down

const tokens = [];
for (const t of raw.transcription || []) {
  if (NOISE.test((t.text || '').trim())) continue;
  for (const tk of t.tokens || []) {
    const text = tk.text ?? '';
    if (SPECIAL.test(text.trim()) || !text.trim()) continue;
    tokens.push({
      text,
      from: tk.offsets.from / 1000,
      to: tk.offsets.to / 1000,
      p: typeof tk.p === 'number' ? tk.p : 1,
    });
  }
}

function flush(out, group) {
  const text = group.map(t => t.text).join('').replace(/\s+/g, ' ').trim();
  if (!text) return;
  out.push({
    from: group[0].from,
    to: group.at(-1).to,
    text,
    confidence: group.reduce((n, t) => n + t.p, 0) / group.length,
  });
}

const sentences = [];
let group = [];

for (const tk of tokens) {
  group.push(tk);
  const text = group.map(t => t.text).join('').trim();
  const spanned = group.at(-1).to - group[0].from;

  if (SENTENCE_END.test(text)) {
    /* An abbreviation or decimal point is not the end of a sentence. A lone
       letter before the period is the common case here: whisper emits "U.S."
       and "e.g." one character at a time, so the first period would otherwise
       cut the sentence in half. */
    const tail = text.slice(-14);
    if (/\b(mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|no|vol|fig|approx)\.$/i.test(tail)) continue;
    if (/\d\.$/.test(tail)) continue;
    if (/(^|[\s("'])[A-Za-z]\.$/.test(tail)) continue;
    flush(sentences, group);
    group = [];
  } else if (spanned > MAX_SECONDS) {
    // A run-on with no end punctuation: break at the last comma, else here.
    let cut = -1;
    for (let i = group.length - 1; i > 2; i--) {
      if (/[,;:]$/.test(group[i].text.trim())) { cut = i; break; }
    }
    if (cut > 0) {
      flush(sentences, group.slice(0, cut + 1));
      group = group.slice(cut + 1);
    } else {
      flush(sentences, group);
      group = [];
    }
  }
}
if (group.length) flush(sentences, group);

/* A sentence that begins with a lowercase word is the tell-tale of a split in
   the wrong place — "…in the U.S." / "today, the words are…" is one sentence
   that an abbreviation's full stop tore in half. Stitch those back together.
   "I" is excluded because it is legitimately capitalised mid-flow. */
for (let i = sentences.length - 2; i >= 0; i--) {
  const next = sentences[i + 1];
  if (!/^[a-z]/.test(next.text)) continue;
  const merged = sentences[i].to === next.to
    ? 0
    : next.to - sentences[i].from;
  if (merged > MAX_SECONDS + 4) continue;      // do not build an unshadowable run-on
  sentences[i] = {
    from: sentences[i].from,
    to: next.to,
    text: `${sentences[i].text} ${next.text}`.replace(/\s+/g, ' '),
    confidence: Math.min(sentences[i].confidence, next.confidence),
  };
  sentences.splice(i + 1, 1);
}

/* Whisper sometimes stretches a short phrase across trailing music or silence,
   producing a 3-word "sentence" that claims 28 seconds. Nobody speaks that
   slowly, so when the implied pace is impossibly slow, trust the word count
   and trim the tail rather than shipping a clip that is mostly dead air. */
const FLOOR_WPM = 70;      // below this, the span is padding rather than speech
const TRIM_WPM = 95;       // trim a too-slow span back to a plausible delivery
const CEILING_WPM = 200;   // above this the span is too tight to hold the words
const RELAX_WPM = 165;     // pace a too-tight span is stretched back towards

for (const [i, s] of sentences.entries()) {
  const count = s.text.split(/\s+/).filter(Boolean).length;
  if (count < 3) continue;
  const span = s.to - s.from;
  if (span <= 0) continue;
  const pace = (count / span) * 60;

  if (pace < FLOOR_WPM) {
    s.to = s.from + Math.max(0.6, (count / TRIM_WPM) * 60);
    s.trimmed = true;
  } else if (pace > CEILING_WPM) {
    /* Conversational audio makes whisper report spans too short to physically
       contain the words, so the clip cuts off mid-sentence. Stretch the end to
       a realistic pace, but never past where the next sentence starts —
       overlapping into the neighbour would be its own kind of wrong. */
    const wanted = s.from + (count / RELAX_WPM) * 60;
    const ceiling = sentences[i + 1] ? sentences[i + 1].from : Infinity;
    s.to = Math.max(s.to, Math.min(wanted, ceiling));
    s.padded = true;
  }
}

const usable = sentences
  .filter(s => s.text.split(' ').length >= 3 && /[a-z]/i.test(s.text))
  .slice(0, MAX_SENTENCES);

if (!usable.length) {
  console.error('no usable speech found');
  await cleanup();
  process.exit(1);
}

const longest = Math.max(...usable.map(s => s.to - s.from));
const shaky = usable.filter(s => s.confidence < 0.6).length;
console.log(`\n${usable.length} sentences (longest ${longest.toFixed(1)}s) from ${tokens.length} tokens`);
if (shaky) {
  console.log(`note: ${shaky} sentence(s) transcribed with low confidence — check them before publishing`);
}

/* ---------- cut clips ---------- */

const { scoreDifficulty, scoreListening, measuredWpm } =
  await import(join(root, 'js', 'difficulty.js'));

const LEAD = 0.12;   // keep the first phoneme intact
const TAIL = 0.25;   // let the final consonant ring out

const slug = String(flag('id-prefix', TITLE.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'lesson'));

const lessons = [];
for (let i = 0; i < usable.length; i += CHUNK) {
  lessons.push(usable.slice(i, i + CHUNK));
}
// A stray 1-2 sentence tail is not worth a lesson of its own.
if (lessons.length > 1 && lessons.at(-1).length < 4) {
  lessons.at(-2).push(...lessons.pop());
}

const clipsRoot = MODE === 'repo'
  ? join(root, 'content', 'audio', ACCENT)
  : join(work, 'pack', 'audio');

const built = [];
let cut = 0;

for (const [n, group] of lessons.entries()) {
  const id = lessons.length > 1 ? `${slug}-${String(n + 1).padStart(2, '0')}` : slug;
  const outDir = join(clipsRoot, id);
  await mkdir(outDir, { recursive: true });

  const sentenceRecords = [];
  for (const [k, s] of group.entries()) {
    const sid = `s${k + 1}`;
    const start = Math.max(0, s.from - LEAD);
    const dur = Math.max(0.35, (s.to - s.from) + LEAD + TAIL);
    await run('ffmpeg', [
      '-y', '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', source,
      '-vn', '-ac', '1', '-ar', '24000', '-b:a', '48k', '-c:a', 'libmp3lame',
      join(outDir, `${sid}.mp3`),
    ], { maxBuffer: 1 << 26 });
    cut++;
    process.stdout.write(`\rcutting clips ${cut}/${usable.length}   `);

    sentenceRecords.push({
      id: sid,
      text: s.text,
      start: Number(s.from.toFixed(2)),
      end: Number(s.to.toFixed(2)),
      wpm: measuredWpm(s.text, s.to - s.from),
    });
  }

  built.push({
    id,
    title: lessons.length > 1 ? `${TITLE} (${n + 1}/${lessons.length})` : TITLE,
    titleZh: '',
    // Real recordings are graded on delivery speed as well as wording.
    level: Number(flag('level', 0)) || scoreListening(sentenceRecords),
    type: 'article',
    topic: TOPIC,
    summaryZh: '',
    realAudio: true,
    accent: ACCENT,
    source: flag('source-note', null),
    sourceUrl: flag('source-url', null),
    sentences: sentenceRecords,
    questions: [],
  });
}

process.stdout.write('\n');

/* ---------- emit ---------- */

if (MODE === 'repo') {
  const lessonDir = join(root, 'content', 'lessons');
  await mkdir(lessonDir, { recursive: true });
  for (const lesson of built) {
    await writeFile(join(lessonDir, `${lesson.id}.json`), JSON.stringify(lesson, null, 2) + '\n');
  }

  // Fold the new clips into the audio manifest the app consults.
  const manifestPath = join(root, 'content', 'audio', 'manifest.json');
  let manifest = { lessons: {} };
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* first run */ }
  manifest.generatedAt = new Date().toISOString();
  for (const lesson of built) {
    manifest.lessons[lesson.id] ||= {};
    manifest.lessons[lesson.id][ACCENT] = lesson.sentences.map(s => s.id);
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\nwrote ${built.length} lesson(s) to content/lessons/`);
  console.log(`clips in content/audio/${ACCENT}/`);
  console.log(`next: node tools/build-index.mjs`);
} else {
  /* Container format, deliberately trivial so the browser can read it with no
     library: a magic string, a 32-bit header length, a JSON header, then every
     clip concatenated. A .tar.gz would need a gzip pass plus a tar parser (and
     tar's 100-character path limit is uncomfortably close to our lesson ids). */
  const packDir = join(work, 'pack', 'audio');
  const chunks = [];
  const files = [];
  let offset = 0;

  for (const lesson of built) {
    for (const s of lesson.sentences) {
      const bytes = await readFile(join(packDir, lesson.id, `${s.id}.mp3`));
      files.push({ p: `${lesson.id}/${s.id}`, o: offset, n: bytes.length });
      chunks.push(bytes);
      offset += bytes.length;
    }
  }

  const header = Buffer.from(JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    title: TITLE,
    lessons: built,
    files,
  }), 'utf8');

  const magic = Buffer.from('ECHOPACK\x01', 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(header.length);

  const outName = `${slug}.echopack`;
  const outPath = join(process.cwd(), outName);
  await writeFile(outPath, Buffer.concat([magic, len, header, ...chunks]));

  const mb = (magic.length + 4 + header.length + offset) / 1048576;
  console.log(`\nwrote ${outName} (${mb.toFixed(1)} MB) — ${built.length} lesson(s), ${usable.length} sentences`);
  console.log('AirDrop it to your phone, then import it in the app under 課程 -> 匯入文章.');
  console.log('This file stays yours: it is gitignored and never uploaded anywhere.');
}

await cleanup();

function fmtTime(s) {
  if (!isFinite(s)) return '?';
  const m = Math.floor(s / 60);
  return m ? `${m}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
}
