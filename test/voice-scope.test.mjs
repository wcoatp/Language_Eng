import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { selectLessons } from '../tools/voice-scope.mjs';

const root = new URL('../', import.meta.url);
const audioDir = new URL('../content/audio/', import.meta.url);
const lessonDir = new URL('../content/lessons/', import.meta.url);
const lessonFiles = (await readdir(lessonDir)).filter(name => name.endsWith('.json'));
const lessons = await Promise.all(lessonFiles.map(name =>
  readFile(new URL(name, lessonDir), 'utf8').then(JSON.parse)));
const allowedIds = ['l2-09', 'l2-10', 'l2-11', 'l2-12'];

test('VSC-01: explicit scope selects only U05-U08 and exactly 40 English sentences', () => {
  const selected = selectLessons(lessons, allowedIds.join(','));
  assert.deepEqual(selected.map(lesson => lesson.id), allowedIds);
  assert.equal(selected.reduce((count, lesson) => count + lesson.sentences.length, 0), 40);
  assert.ok(selected.every(lesson => lesson.sentences.every(sentence => sentence.text.trim())));
});

test('VSC-02: omitted local-engine scope keeps the legacy all-lessons behavior', () => {
  assert.equal(selectLessons(lessons).length, lessons.length);
});

test('VSC-03: malformed, duplicate, and unknown lesson scopes are rejected', () => {
  assert.throws(() => selectLessons(lessons, ''), /lesson scope/);
  assert.throws(() => selectLessons(lessons, 'l2-09,'), /lesson scope/);
  assert.throws(() => selectLessons(lessons, 'l2-09,l2-09'), /duplicate lesson ID/);
  assert.throws(() => selectLessons(lessons, 'not-a-lesson'), /unknown lesson ID/);
});

test('VSC-04: Edge CLI refuses to run without a scope before changing the manifest', async () => {
  const manifestUrl = new URL('manifest.json', audioDir);
  const before = await readFile(manifestUrl, 'utf8');
  const script = new URL('../tools/generate-voices.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [script.pathname, '--voice', 'edge-us'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires an explicit --lesson/);
  assert.equal(await readFile(manifestUrl, 'utf8'), before);
});

test('VSC-05: Edge CLI refuses an unknown scoped lesson before changing the manifest', async () => {
  const manifestUrl = new URL('manifest.json', audioDir);
  const before = await readFile(manifestUrl, 'utf8');
  const script = new URL('../tools/generate-voices.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [
    script.pathname, '--voice', 'edge-us', '--lesson', 'not-a-lesson',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown lesson ID/);
  assert.equal(await readFile(manifestUrl, 'utf8'), before);
});
