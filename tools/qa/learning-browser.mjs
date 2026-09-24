import { db, kvGet, kvSet, kvUpdate } from '../../js/db.js';
import { recordLearning, progressFor, wordStatus } from '../../js/learning.js';

const key = `qa-sdd002-${crypto.randomUUID()}`;
const lesson = { id: 'qa-lesson', learning: { version: 1, vocabulary: [{ id: 'word' }], task: { id: 'task' } }, questions: [{ options: ['a','b','c'], answer: 1 }] };
const assert = (ok, message = 'assertion failed') => { if (!ok) throw Error(message); };
let failed = 0;
async function test(label, run) {
  const row = document.createElement('li');
  try { await run(); row.textContent = `PASS ${label}`; }
  catch (error) { failed++; row.textContent = `FAIL ${label}: ${error.message}`; }
  document.getElementById('results').append(row);
}
await test('LP-08 concurrent IndexedDB increments do not lose updates', async () => {
  await kvSet(key, 0);
  await Promise.all(Array.from({ length: 20 }, () => kvUpdate(key, 0, value => value + 1)));
  assert(await kvGet(key) === 20);
});
await test('LP-08 failed reducer aborts the write and preserves old data', async () => {
  try { await kvUpdate(key, 0, () => { throw Error('expected'); }); }
  catch (error) { assert(error.message === 'expected'); }
  assert(await kvGet(key) === 20);
});
await test('LP-04/06 concurrent vocabulary/task saves keep independent results', async () => {
  await kvSet(key, {});
  await Promise.all([
    kvUpdate(key, {}, all => recordLearning(all, lesson, 'vocabulary', 'word', { heard: 'unavailable', read: 'known' })),
    kvUpdate(key, {}, all => recordLearning(all, lesson, 'task', 'task', { rating: 'independent', prompted: true })),
  ]);
  const progress = progressFor(lesson, await kvGet(key));
  assert(wordStatus(progress.vocabulary.word) === 'reading');
  assert(progress.tasks.task.rating === 'prompted');
});
await test('LP-08 export-shaped JSON retains vocabulary, quiz and task data', async () => {
  await kvUpdate(key, {}, all => recordLearning(all, lesson, 'quiz', '', { answers: [1] }));
  const exported = JSON.parse(JSON.stringify({ lessonLearningProgress: await kvGet(key) }));
  const saved = exported.lessonLearningProgress[lesson.id];
  assert(saved.quiz.right === 1 && saved.vocabulary.word.read === 'known' && saved.tasks.task.rating === 'prompted');
});
await test('QA cleanup removes only the temporary key created by this run', async () => {
  await db.del('kv', key);
  assert(await kvGet(key) === null);
});
document.getElementById('summary').textContent = failed ? `${failed} FAILED` : 'ALL PASSED';
document.title = failed ? 'FAIL: SDD-002' : 'PASS: SDD-002';
