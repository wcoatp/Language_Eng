#!/usr/bin/env node
/* Pre-generate lesson audio with edge-tts (free, high quality, no API key).

   Setup once:   pipx install edge-tts     (or: pip install edge-tts)
   Generate:     node tools/generate-audio.mjs
                 node tools/generate-audio.mjs --accent gb --lesson l1-01
                 node tools/generate-audio.mjs --force

   Output:  content/audio/<accent>/<lessonId>/<sentenceId>.mp3
            content/audio/manifest.json   (what the app checks before falling
                                           back to the browser's own voice)

   Lessons with no generated audio still work — the app reads them with the
   device's built-in speech engine. */

import { readdir, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lessonDir = join(root, 'content', 'lessons');
const audioDir = join(root, 'content', 'audio');

/* One female + one male per accent, so dialogue speakers stay distinct. */
const VOICES = {
  us: { A: 'en-US-AriaNeural',    B: 'en-US-GuyNeural',      narrator: 'en-US-AriaNeural' },
  gb: { A: 'en-GB-SoniaNeural',   B: 'en-GB-RyanNeural',     narrator: 'en-GB-SoniaNeural' },
  au: { A: 'en-AU-NatashaNeural', B: 'en-AU-WilliamNeural',  narrator: 'en-AU-NatashaNeural' },
  in: { A: 'en-IN-NeerjaNeural',  B: 'en-IN-PrabhatNeural',  narrator: 'en-IN-NeerjaNeural' },
  ie: { A: 'en-IE-EmilyNeural',   B: 'en-IE-ConnorNeural',   narrator: 'en-IE-EmilyNeural' },
  za: { A: 'en-ZA-LeahNeural',    B: 'en-ZA-LukeNeural',     narrator: 'en-ZA-LeahNeural' },
};

/* Level 1 is read a touch slower than level 5, matching the app's WPM targets. */
const RATE_BY_LEVEL = { 1: '-18%', 2: '-10%', 3: '-4%', 4: '+0%', 5: '+6%' };

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? true);
};
const force = args.includes('--force');
const onlyLesson = flag('lesson');
const accents = (flag('accent') ? String(flag('accent')).split(',') : ['us', 'gb'])
  .filter(a => {
    if (VOICES[a]) return true;
    console.error(`unknown accent "${a}" — known: ${Object.keys(VOICES).join(', ')}`);
    return false;
  });

if (!accents.length) process.exit(1);

/* ---- preflight ---- */

/* Prefer an explicit override, then the project venv, then whatever is on PATH. */
const candidates = [
  process.env.EDGE_TTS,
  join(root, '.venv', 'bin', 'edge-tts'),
  'edge-tts',
].filter(Boolean);

let edge = null;
for (const c of candidates) {
  try {
    const { stdout } = await run(c, ['--version']);
    edge = c;
    console.log(`using ${c} (${stdout.trim()})`);
    break;
  } catch { /* try the next candidate */ }
}

if (!edge) {
  console.error(`
edge-tts not found. Install it into a project venv:

  python3 -m venv .venv
  .venv/bin/pip install edge-tts

or globally with pipx, then re-run this script. Until then the app falls back
to the browser's own speech engine, which works everywhere but sounds
different from device to device.`);
  process.exit(1);
}

const exists = p => access(p).then(() => true, () => false);

/* ---- generate ---- */

const files = (await readdir(lessonDir)).filter(f => f.endsWith('.json')).sort();
const manifest = { generatedAt: new Date().toISOString(), lessons: {} };

let made = 0, skipped = 0, failed = 0;

/* Each clip is one network round trip to the voice service, so the run is
   latency-bound rather than CPU-bound — a small pool cuts a 45-minute
   sequential run to a few minutes. Kept modest to stay a polite client. */
const CONCURRENCY = Number(flag('jobs', 6));

const queue = [];

for (const file of files) {
  const lesson = JSON.parse(await readFile(join(lessonDir, file), 'utf8'));
  if (onlyLesson && lesson.id !== onlyLesson) continue;

  for (const accent of accents) {
    const outDir = join(audioDir, accent, lesson.id);
    await mkdir(outDir, { recursive: true });

    const done = [];
    manifest.lessons[lesson.id] ||= {};
    manifest.lessons[lesson.id][accent] = done;

    for (const s of lesson.sentences) {
      const out = join(outDir, `${s.id}.mp3`);
      if (!force && await exists(out)) { done.push(s.id); skipped++; continue; }
      queue.push({
        out, done, id: s.id, label: `${accent}/${lesson.id}/${s.id}`,
        voice: VOICES[accent][s.speaker] || VOICES[accent].narrator,
        rate: RATE_BY_LEVEL[lesson.level] || '+0%',
        text: s.text,
      });
    }
  }
}

const total = queue.length;
let cursor = 0;

async function worker() {
  for (;;) {
    const job = queue[cursor++];
    if (!job) return;
    try {
      await run(edge, [
        '--voice', job.voice,
        '--rate', job.rate,
        '--text', job.text,
        '--write-media', job.out,
      ]);
      job.done.push(job.id);
      made++;
      process.stdout.write(`\r${job.label}  (${made}/${total})          `);
    } catch (e) {
      failed++;
      console.error(`\nfailed ${job.label}: ${e.message.split('\n')[0]}`);
    }
  }
}

if (total) {
  console.log(`generating ${total} clips with ${CONCURRENCY} parallel jobs`);
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
}

/* Sentence order matters to the app, and the pool finishes out of order. */
for (const byAccent of Object.values(manifest.lessons)) {
  for (const [accent, ids] of Object.entries(byAccent)) {
    if (!ids.length) delete byAccent[accent];
    else ids.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  }
}
for (const [id, byAccent] of Object.entries(manifest.lessons)) {
  if (!Object.keys(byAccent).length) delete manifest.lessons[id];
}

/* Preserve entries for lessons/accents this run did not touch. */
if (onlyLesson || accents.length < Object.keys(VOICES).length) {
  try {
    const prev = JSON.parse(await readFile(join(audioDir, 'manifest.json'), 'utf8'));
    for (const [id, byAccent] of Object.entries(prev.lessons || {})) {
      manifest.lessons[id] = { ...byAccent, ...(manifest.lessons[id] || {}) };
    }
  } catch { /* no previous manifest */ }
}

await mkdir(audioDir, { recursive: true });
await writeFile(join(audioDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`\n\ngenerated ${made}, reused ${skipped}${failed ? `, failed ${failed}` : ''}`);
console.log(`accents: ${accents.join(', ')}`);
console.log('manifest: content/audio/manifest.json');
