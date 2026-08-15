#!/usr/bin/env node
/* Validate lessons, the generated lesson index, and every pre-rendered clip.

   This command is intentionally read-only. It is safe to run in CI and catches
   stale index/manifest entries, missing audio, and audio files that the app
   cannot discover through content/audio/manifest.json. */

import { readdir, readFile, access } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICES } from '../js/voices.js';
import {
  dailyLessonProblems,
  dailySeriesProblems,
  dailyTitleProblems,
  englishWordCount,
} from '../js/daily.js';
import { REFERENCE_TITLES } from './daily-reference-titles.mjs';

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SMART = new Set([0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014, 0x2026]);

const exists = (path) => access(path).then(() => true, () => false);
const slash = (path) => path.split(sep).join('/');

async function mp3Files(dir) {
  const out = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith('.mp3')) out.push(path);
    }
  }
  await walk(dir);
  return out.sort();
}

function summary(lesson) {
  const sentences = Array.isArray(lesson.sentences) ? lesson.sentences : [];
  const questions = Array.isArray(lesson.questions) ? lesson.questions : [];
  const item = {
    id: lesson.id,
    title: lesson.title,
    titleZh: lesson.titleZh || '',
    summaryZh: lesson.summaryZh || '',
    level: lesson.level,
    type: lesson.type,
    topic: lesson.topic || 'daily',
    count: sentences.length,
    questions: questions.length,
    realAudio: !!lesson.realAudio,
    preGeneratedAudio: lesson.preGeneratedAudio !== false,
    source: lesson.source || '',
  };
  if (lesson.daily) {
    item.daily = lesson.daily;
    item.wordCount = englishWordCount(sentences);
  }
  return item;
}

export async function validateContent(root = defaultRoot) {
  const lessonDir = join(root, 'content', 'lessons');
  const audioDir = join(root, 'content', 'audio');
  const problems = [];
  const check = (condition, message) => {
    if (!condition) problems.push(message);
  };

  const files = (await readdir(lessonDir))
    .filter((file) => file.endsWith('.json'))
    .sort();
  const lessons = [];

  for (const file of files) {
    const fileId = basename(file, '.json');
    let lesson;
    try {
      lesson = JSON.parse(await readFile(join(lessonDir, file), 'utf8'));
    } catch (error) {
      problems.push(`${fileId}: invalid JSON (${error.message})`);
      continue;
    }

    check(lesson.id === fileId, `${fileId}: id does not match filename`);
    check(typeof lesson.title === 'string' && !!lesson.title.trim(), `${fileId}: missing title`);
    check(Number.isInteger(lesson.level) && lesson.level >= 1 && lesson.level <= 5,
      `${fileId}: level must be 1-5`);
    check(['dialogue', 'article'].includes(lesson.type), `${fileId}: invalid type`);
    const sentences = Array.isArray(lesson.sentences) ? lesson.sentences : [];
    const questions = Array.isArray(lesson.questions) ? lesson.questions : [];
    check(sentences.length > 0,
      `${fileId}: no sentences`);

    for (const [i, sentence] of sentences.entries()) {
      const label = `${fileId}/${sentence.id || `sentence-${i + 1}`}`;
      check(sentence.id === `s${i + 1}`, `${label}: sentence ids must be consecutive`);
      check(typeof sentence.text === 'string' && !!sentence.text.trim(), `${label}: missing text`);
      if (lesson.type === 'dialogue') {
        check(typeof sentence.speaker === 'string' && !!sentence.speaker,
          `${label}: dialogue sentence is missing speaker`);
      }
      const smart = [...(sentence.text || '')].find((char) => SMART.has(char.codePointAt(0)));
      if (smart) {
        problems.push(`${label}: use ASCII punctuation instead of U+${smart.codePointAt(0)
          .toString(16).toUpperCase().padStart(4, '0')}`);
      }
    }

    for (const [i, question] of questions.entries()) {
      const label = `${fileId}/question-${i + 1}`;
      check(Array.isArray(question.options) && question.options.length === 3,
        `${label}: expected exactly 3 options`);
      check(Number.isInteger(question.answer) && question.answer >= 0 && question.answer <= 2,
        `${label}: answer must be 0-2`);
    }
    for (const problem of dailyLessonProblems(lesson)) {
      problems.push(`${fileId}: ${problem}`);
    }
    for (const problem of dailyTitleProblems(lesson, REFERENCE_TITLES)) {
      problems.push(`${fileId}: ${problem}`);
    }
    lessons.push(lesson);
  }

  lessons.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
  problems.push(...dailySeriesProblems(lessons));
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  check(byId.size === lessons.length, 'lesson ids must be unique');

  const index = JSON.parse(await readFile(join(root, 'content', 'index.json'), 'utf8'));
  check(Number.isFinite(Date.parse(index.generatedAt)), 'content/index.json has no valid generatedAt');
  const summaries = lessons.map(summary);
  check(JSON.stringify(index.lessons) === JSON.stringify(summaries),
    'content/index.json is stale; run npm run index');
  const sentenceTotal = lessons.reduce((total, lesson) =>
    total + (Array.isArray(lesson.sentences) ? lesson.sentences.length : 0), 0);
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  check(readme.includes(`${lessons.length} 課`),
    `README.md lesson count is stale (expected ${lessons.length} 課)`);
  check(readme.includes(`${sentenceTotal} 句`),
    `README.md sentence count is stale (expected ${sentenceTotal} 句)`);

  const manifestPath = join(audioDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const voiceIds = VOICES.map((voice) => voice.id);
  check(new Set(voiceIds).size === voiceIds.length, 'voice catalogue ids must be unique');
  check(Number.isFinite(Date.parse(manifest.generatedAt)), 'audio manifest has no valid generatedAt');
  const expectedPaths = new Set();

  for (const id of Object.keys(manifest.lessons || {})) {
    check(byId.has(id), `audio manifest references unknown lesson ${id}`);
  }

  for (const lesson of lessons) {
    const byVoice = manifest.lessons?.[lesson.id];
    if (lesson.preGeneratedAudio === false) {
      check(!byVoice, `${lesson.id}: device-TTS lesson should not be in the audio manifest`);
      continue;
    }
    check(!!byVoice, `${lesson.id}: missing from audio manifest`);
    if (!byVoice) continue;

    const expectedVoices = lesson.realAudio ? ['real'] : voiceIds;
    const actualVoices = Object.keys(byVoice);
    for (const voiceId of expectedVoices) {
      check(actualVoices.includes(voiceId), `${lesson.id}: missing voice set ${voiceId}`);
    }
    for (const voiceId of actualVoices) {
      check(expectedVoices.includes(voiceId), `${lesson.id}: unexpected voice set ${voiceId}`);
    }

    const sentenceIds = (Array.isArray(lesson.sentences) ? lesson.sentences : [])
      .map((sentence) => sentence.id);
    for (const [voiceId, ids] of Object.entries(byVoice)) {
      check(Array.isArray(ids), `${lesson.id}/${voiceId}: manifest entry must be an array`);
      if (!Array.isArray(ids)) continue;
      check(JSON.stringify(ids) === JSON.stringify(sentenceIds),
        `${lesson.id}/${voiceId}: sentence list is incomplete, duplicated, or out of order`);
      for (const sentenceId of ids) {
        const rel = `${voiceId}/${lesson.id}/${sentenceId}.mp3`;
        expectedPaths.add(rel);
        check(await exists(join(audioDir, rel)), `${rel}: file is missing`);
      }
    }
  }

  const actualPaths = new Set(
    (await mp3Files(audioDir)).map((path) => slash(relative(audioDir, path))),
  );
  for (const path of actualPaths) {
    check(expectedPaths.has(path), `${path}: audio file is not listed in the manifest`);
  }
  for (const path of expectedPaths) {
    check(actualPaths.has(path), `${path}: manifest entry has no audio file`);
  }

  return {
    problems,
    lessons: lessons.length,
    sentences: sentenceTotal,
    voices: voiceIds.length,
    audioFiles: actualPaths.size,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = await validateContent();
    if (result.problems.length) {
      console.error(`content validation failed with ${result.problems.length} problem(s):`);
      for (const problem of result.problems) console.error(`  - ${problem}`);
      process.exitCode = 1;
    } else {
      console.log(`content OK: ${result.lessons} lessons, ${result.sentences} sentences, ` +
        `${result.voices} voice sets, ${result.audioFiles} audio files`);
    }
  } catch (error) {
    console.error(`content validation could not run: ${error.message}`);
    process.exitCode = 1;
  }
}
