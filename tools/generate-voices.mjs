#!/usr/bin/env node
/* Generate a pre-rendered voice set for the synthetic lessons.

   One folder per voice under content/audio/<voiceId>/, matching js/voices.js.
   Real-recording lessons (VOA) are skipped: they already have their own audio
   and re-synthesising them would throw away the human speaker.

     node tools/generate-voices.mjs --list
     node tools/generate-voices.mjs --voice kokoro-us
     node tools/generate-voices.mjs --voice edge-in,edge-ie --force

   Engines and their setup:
     edge-tts     .venv/bin/edge-tts            (pip install edge-tts)
     kokoro       .venv-tts/bin/python          (pip install kokoro)
     chatterbox   .venv-tts/bin/python          (pip install chatterbox-tts)
*/

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, readdir, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const audioDir = join(root, 'content', 'audio');
const lessonDir = join(root, 'content', 'lessons');

/* Per-voice engine settings. Two speakers per accent wherever the engine has
   them, so dialogue roles stay distinguishable. */
const VOICES = {
  'edge-us': { engine: 'edge', A: 'en-US-AriaNeural',    B: 'en-US-GuyNeural' },
  'edge-gb': { engine: 'edge', A: 'en-GB-SoniaNeural',   B: 'en-GB-RyanNeural' },
  'edge-au': { engine: 'edge', A: 'en-AU-NatashaNeural', B: 'en-AU-WilliamNeural' },
  'edge-in': { engine: 'edge', A: 'en-IN-NeerjaNeural',  B: 'en-IN-PrabhatNeural' },
  'edge-ie': { engine: 'edge', A: 'en-IE-EmilyNeural',   B: 'en-IE-ConnorNeural' },
  'edge-za': { engine: 'edge', A: 'en-ZA-LeahNeural',    B: 'en-ZA-LukeNeural' },
  'edge-ca': { engine: 'edge', A: 'en-CA-ClaraNeural',   B: 'en-CA-LiamNeural' },
  'edge-nz': { engine: 'edge', A: 'en-NZ-MollyNeural',   B: 'en-NZ-MitchellNeural' },

  'kokoro-us': { engine: 'kokoro', lang: 'a', A: 'af_heart', B: 'am_michael' },
  'kokoro-gb': { engine: 'kokoro', lang: 'b', A: 'bf_emma',  B: 'bm_george' },

  // Single-voice model: speaker B borrows a reference clip so a dialogue does
  // not end up with one person playing both parts.
  'chatterbox-us': { engine: 'chatterbox', A: null, B: null,
                     reference: { B: 'content/audio/edge-us/l1-01/s1.mp3' } },
};

/* edge-tts alters delivery speed per level; the neural engines have their own
   natural pace and sound wrong when pushed. */
const EDGE_RATE_BY_LEVEL = { 1: '-18%', 2: '-10%', 3: '-4%', 4: '+0%', 5: '+6%' };

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? true);
};
const has = n => argv.includes(`--${n}`);
const exists = p => access(p).then(() => true, () => false);

if (has('list') || has('help')) {
  console.log('\nvoice sets:\n');
  for (const [id, v] of Object.entries(VOICES)) console.log(`  ${id.padEnd(16)} ${v.engine}`);
  console.log('\n  node tools/generate-voices.mjs --voice kokoro-us,kokoro-gb\n');
  process.exit(0);
}

const wanted = String(flag('voice', '')).split(',').map(s => s.trim()).filter(Boolean);
if (!wanted.length) {
  console.error('pass --voice <id[,id...]>, or --list to see them');
  process.exit(1);
}
for (const id of wanted) {
  if (!VOICES[id]) { console.error(`unknown voice "${id}"`); process.exit(1); }
}
const force = has('force');

/* ---------- lessons ---------- */

const files = (await readdir(lessonDir)).filter(f => f.endsWith('.json')).sort();
const lessons = [];
for (const f of files) {
  const l = JSON.parse(await readFile(join(lessonDir, f), 'utf8'));
  // Real recordings keep their human voice. Device-TTS lessons deliberately
  // stay lightweight until preGeneratedAudio is explicitly switched on.
  if (!l.realAudio && l.preGeneratedAudio !== false) lessons.push(l);
}
console.log(`${lessons.length} synthetic lessons, ` +
  `${lessons.reduce((n, l) => n + l.sentences.length, 0)} sentences`);

/* ---------- generation ---------- */

async function generateEdge(voiceId, cfg) {
  const edge = join(root, '.venv', 'bin', 'edge-tts');
  if (!await exists(edge)) throw new Error('edge-tts missing: pip install edge-tts in .venv');

  const jobs = [];
  for (const lesson of lessons) {
    const outDir = join(audioDir, voiceId, lesson.id);
    await mkdir(outDir, { recursive: true });
    for (const s of lesson.sentences) {
      const out = join(outDir, `${s.id}.mp3`);
      if (!force && await exists(out)) continue;
      jobs.push({
        out, text: s.text,
        voice: cfg[s.speaker] || cfg.A,
        rate: EDGE_RATE_BY_LEVEL[lesson.level] || '+0%',
      });
    }
  }
  if (!jobs.length) return 0;

  let done = 0;
  const LANES = 6;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(LANES, jobs.length) }, async () => {
    for (;;) {
      const job = jobs[cursor++];
      if (!job) return;
      await run(edge, ['--voice', job.voice, '--rate', job.rate,
                       '--text', job.text, '--write-media', job.out]);
      process.stdout.write(`\r  ${voiceId}  ${++done}/${jobs.length}   `);
    }
  }));
  return done;
}

async function generatePython(voiceId, cfg) {
  const py = join(root, '.venv-tts', 'bin', 'python');
  if (!await exists(py)) {
    throw new Error('.venv-tts missing: python3.11 -m venv .venv-tts && ' +
                    '.venv-tts/bin/pip install kokoro chatterbox-tts');
  }

  const jobs = [];
  for (const lesson of lessons) {
    const outDir = join(audioDir, voiceId, lesson.id);
    await mkdir(outDir, { recursive: true });
    for (const s of lesson.sentences) {
      const out = join(outDir, `${s.id}.mp3`);
      if (!force && await exists(out)) continue;
      jobs.push({ out, text: s.text, speaker: s.speaker || 'A' });
    }
  }
  if (!jobs.length) return 0;

  const reference = {};
  for (const [spk, rel] of Object.entries(cfg.reference || {})) {
    const p = join(root, rel);
    if (await exists(p)) reference[spk] = p;
  }

  const spec = {
    engine: cfg.engine,
    lang_code: cfg.lang || 'a',
    voices: { A: cfg.A, B: cfg.B },
    reference,
    jobs,
  };

  return new Promise((resolve, reject) => {
    const proc = spawn(py, [join(root, 'tools', 'tts_engine.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let done = 0, err = '';
    proc.stdout.on('data', d => {
      for (const line of String(d).split('\n')) {
        if (line.startsWith('OK')) process.stdout.write(`\r  ${voiceId}  ${++done}/${jobs.length}   `);
      }
    });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', code => {
      if (code === 0) resolve(done);
      else reject(new Error(err.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300)));
    });
    proc.stdin.end(JSON.stringify(spec));
  });
}

for (const voiceId of wanted) {
  const cfg = VOICES[voiceId];
  console.log(`\n=== ${voiceId} (${cfg.engine}) ===`);
  const started = Date.now();
  try {
    const made = cfg.engine === 'edge'
      ? await generateEdge(voiceId, cfg)
      : await generatePython(voiceId, cfg);
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`\n  ${made ? `generated ${made} clips in ${mins} min` : 'already complete'}`);
  } catch (e) {
    console.error(`\n  failed: ${e.message}`);
  }
}

/* ---------- manifest ---------- */

const manifestPath = join(audioDir, 'manifest.json');
let manifest = { lessons: {} };
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* first run */ }

for (const voiceId of wanted) {
  for (const lesson of lessons) {
    const present = [];
    for (const s of lesson.sentences) {
      if (await exists(join(audioDir, voiceId, lesson.id, `${s.id}.mp3`))) present.push(s.id);
    }
    manifest.lessons[lesson.id] ||= {};
    if (present.length) manifest.lessons[lesson.id][voiceId] = present;
    else delete manifest.lessons[lesson.id][voiceId];
  }
}
manifest.generatedAt = new Date().toISOString();
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const keys = [...new Set(Object.values(manifest.lessons).flatMap(o => Object.keys(o)))].sort();
console.log(`\nmanifest voices: ${keys.join(', ')}`);
