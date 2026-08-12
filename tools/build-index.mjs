#!/usr/bin/env node
/* Scan content/lessons/*.json, validate them, and write content/index.json.
   Run after adding or editing any lesson file:  node tools/build-index.mjs */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'content', 'lessons');

const problems = [];
const lessons = [];

/* Curly quotes, en/em dashes, ellipsis — anything a TTS engine may mispronounce
   or read aloud as a word. Listed by code point rather than as literals. */
const SMART = new Set([0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014, 0x2026]);

function check(cond, id, msg) {
  if (!cond) problems.push(`${id}: ${msg}`);
  return cond;
}

const files = (await readdir(dir).catch(() => []))
  .filter(f => f.endsWith('.json'))
  .sort();

if (!files.length) {
  console.error(`no lesson files in ${dir}`);
  process.exit(1);
}

for (const file of files) {
  const id = basename(file, '.json');
  let lesson;
  try {
    lesson = JSON.parse(await readFile(join(dir, file), 'utf8'));
  } catch (e) {
    problems.push(`${id}: invalid JSON — ${e.message}`);
    continue;
  }

  check(lesson.id === id, id, `id "${lesson.id}" does not match filename`);
  check(typeof lesson.title === 'string' && lesson.title, id, 'missing title');
  check(Number.isInteger(lesson.level) && lesson.level >= 1 && lesson.level <= 5, id, 'level must be 1-5');
  check(['dialogue', 'article'].includes(lesson.type), id, `unknown type "${lesson.type}"`);
  check(Array.isArray(lesson.sentences) && lesson.sentences.length > 0, id, 'no sentences');

  (lesson.sentences || []).forEach((s, i) => {
    check(s.id === `s${i + 1}`, id, `sentence ${i + 1} has id "${s.id}", expected "s${i + 1}"`);
    check(typeof s.text === 'string' && s.text.trim(), id, `sentence ${s.id} has no text`);
    if (lesson.type === 'dialogue') {
      check(typeof s.speaker === 'string' && s.speaker, id, `sentence ${s.id} missing speaker`);
    }
    // Smart punctuation and dashes make speech engines stumble. Compared by code
    // point so an editor cannot silently normalise the check itself away.
    const smart = [...(s.text || '')].find(c => SMART.has(c.codePointAt(0)));
    if (smart) {
      problems.push(`${id}: sentence ${s.id} contains U+${smart.codePointAt(0)
        .toString(16).toUpperCase().padStart(4, '0')}, use plain ASCII punctuation`);
    }
  });

  (lesson.questions || []).forEach((q, i) => {
    check(Array.isArray(q.options) && q.options.length === 3, id, `question ${i + 1} needs 3 options`);
    check(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 2, id, `question ${i + 1} answer out of range`);
  });

  lessons.push({
    id: lesson.id,
    title: lesson.title,
    titleZh: lesson.titleZh || '',
    summaryZh: lesson.summaryZh || '',
    level: lesson.level,
    type: lesson.type,
    topic: lesson.topic || 'daily',
    count: lesson.sentences.length,
    questions: (lesson.questions || []).length,
    realAudio: !!lesson.realAudio,
    source: lesson.source || '',
  });
}

lessons.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

await writeFile(
  join(root, 'content', 'index.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), lessons }, null, 2) + '\n',
);

const byLevel = lessons.reduce((m, l) => (m[l.level] = (m[l.level] || 0) + 1, m), {});
const totalSentences = lessons.reduce((n, l) => n + l.count, 0);
console.log(`indexed ${lessons.length} lessons, ${totalSentences} sentences`);
console.log('by level:', Object.entries(byLevel).map(([k, v]) => `L${k}×${v}`).join('  '));
