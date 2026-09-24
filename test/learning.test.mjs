import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { containsSurface, learningProblems, prepareQueue, progressFor, recordLearning, shuffleOptions, wordStatus, withAutomaticLearning } from '../js/learning.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const daily = JSON.parse(await read('content/lessons/daily-2026-08-23.json'));
const foundation = JSON.parse(await read('content/lessons/l1-07.json'));
const lunch = JSON.parse(await read('content/lessons/l1-05.json'));
const hotel = JSON.parse(await read('content/lessons/l2-07.json'));
const invitation = JSON.parse(await read('content/lessons/l2-08.json'));

test('LP-03/RC-01: all five authored learning specs reference real complete words', () => {
  for (const lesson of [daily, foundation, lunch, hotel, invitation]) assert.deepEqual(learningProblems(lesson), []);
  assert.equal(daily.level, 3);
  assert.equal(foundation.level, 1);
  assert.equal(foundation.sentences.length, 12);
  assert.equal(foundation.preGeneratedAudio, undefined);
  assert.equal(hotel.level, 2);
  assert.equal(hotel.sentences.length, 12);
  assert.equal(invitation.level, 2);
  assert.equal(invitation.sentences.length, 10);
  assert.equal(hotel.learning.prerequisite.id, 'l1-04');
  assert.equal(invitation.learning.prerequisite.id, 'l2-01');
});

test('LP-03: sentence matching rejects substrings and phrase across punctuation', () => {
  assert.equal(containsSurface('The site was inspected.', 'inspect'), false);
  assert.equal(containsSurface('The site was inspected.', 'inspected'), true);
  assert.equal(containsSurface('We work out the cost.', 'work out'), true);
  assert.equal(containsSurface('We work. Out there.', 'work out'), false);
  assert.equal(containsSurface('certified', 'cert'), false);
});

test('LP-01/03: default queue excludes extra words, no forced warmup for old lessons', () => {
  const progress = progressFor(daily);
  assert.equal(prepareQueue(daily, progress).length, 6);
  assert.equal(prepareQueue(daily, progress, 'extra').length, 2);
  assert.deepEqual(prepareQueue({ id: 'old' }, progress), []);
  assert.deepEqual(learningProblems({ sentences: [] }), []);
});

test('RC-03: a lesson without authored metadata gets a deterministic local fallback', () => {
  const old = { id: 'old', level: 2, sentences: [
    { id: 's1', text: 'Scientists measured a bright object outside the station.' },
    { id: 's2', text: 'The object changed quickly during the afternoon.' },
  ] };
  const prepared = withAutomaticLearning(old);
  assert.equal(prepared.learning.automatic, true);
  assert.ok(prepared.learning.vocabulary.length >= 4);
  assert.equal(withAutomaticLearning(prepared), prepared);
  assert.deepEqual(learningProblems(prepared), []);
  assert.equal(old.learning, undefined);
});

test('LP-02/04: no-audio and text recognition never become hearing mastery', () => {
  assert.equal(wordStatus(), 'unseen');
  assert.equal(wordStatus({ heard: 'yes', read: 'known' }), 'heard');
  assert.equal(wordStatus({ heard: 'unavailable', read: 'known' }), 'reading');
  assert.equal(wordStatus({ heard: 'hint', read: 'known' }), 'reading');
  assert.equal(wordStatus({ heard: 'yes', read: 'practice' }), 'practice');
});

test('LP-04: state is immutable, resumable, scoped per lesson and resets on content revision', () => {
  const first = recordLearning({}, daily, 'vocabulary', 'flood', { heard: 'hint', read: 'known' }, 100);
  const both = recordLearning(first, lunch, 'vocabulary', 'pay', { heard: 'yes', read: 'practice' }, 200);
  assert.ok(!first[lunch.id]);
  assert.deepEqual(both[daily.id], first[daily.id]);
  const restored = progressFor(daily, JSON.parse(JSON.stringify(both)));
  assert.equal(prepareQueue(daily, restored).length, 5);
  assert.equal(prepareQueue(daily, restored, 'review').length, 6);
  const revised = { ...daily, learning: { ...daily.learning, version: 2 } };
  assert.equal(prepareQueue(revised, progressFor(revised, both)).length, 6);
  assert.deepEqual(both[daily.id].vocabulary.flood, { heard: 'hint', read: 'known', at: 100 });
});

test('LP-04: mastered audio terms stay in all but not remaining or review queue', () => {
  const saved = recordLearning({}, lunch, 'vocabulary', 'pay', { heard: 'yes', read: 'known' });
  const p = progressFor(lunch, saved);
  assert.equal(prepareQueue(lunch, p).length, 5);
  assert.equal(prepareQueue(lunch, p, 'review').length, 5);
  assert.equal(prepareQueue(lunch, p, 'all').length, 6);
});

test('LP-05: randomized answer locations preserve original identities', () => {
  for (const q of foundation.questions) {
    const original = [...q.options];
    for (const random of [() => 0, () => 0.5, () => 0.999]) {
      const shuffled = shuffleOptions(q, random);
      assert.equal(shuffled.find(o => o.originalIndex === q.answer).text, original[q.answer]);
      assert.equal(new Set(shuffled.map(o => o.originalIndex)).size, 3);
      assert.deepEqual(q.options, original);
    }
  }
});

test('LP-05/08: quiz stores original choices and derives score, not a claimed client score', () => {
  const answers = foundation.questions.map(q => q.answer);
  const all = recordLearning({}, foundation, 'quiz', '', { answers, right: 999 }, 10);
  assert.deepEqual(all[foundation.id].quiz, { answers, right: 3, total: 3, at: 10 });
  assert.throws(() => recordLearning({}, foundation, 'quiz', '', { answers: [1] }));
  assert.throws(() => recordLearning({}, foundation, 'quiz', '', { answers: [1, 0, 9] }));
});

test('LP-06: hint use cannot be labelled independently completed', () => {
  const all = recordLearning({}, foundation, 'task', 'change-order', { rating: 'independent', prompted: true }, 1);
  assert.equal(all[foundation.id].tasks['change-order'].rating, 'prompted');
  assert.equal(Object.keys(all[foundation.id].vocabulary).length, 0);
  assert.throws(() => recordLearning({}, foundation, 'task', 'wrong', { rating: 'practice' }));
});

test('LP-03: malformed metadata is diagnosed, including bad refs and missing translations', () => {
  const invalid = structuredClone(daily);
  invalid.learning.vocabulary[0].sentenceIds = ['missing'];
  invalid.learning.vocabulary[1].surface = 'gau';
  invalid.learning.vocabulary[2].en = '';
  invalid.learning.vocabulary[3].id = 'flood';
  const errors = learningProblems(invalid).join('\n');
  assert.match(errors, /invalid sentence references/);
  assert.match(errors, /word boundaries/);
  assert.match(errors, /missing en/);
  assert.match(errors, /duplicate vocabulary/);
});

test('LP-04: invalid learner responses do not silently store arbitrary values', () => {
  for (const value of [{ heard: 'yes', read: 'wrong' }, { heard: 'guessed', read: 'known' }]) {
    assert.throws(() => recordLearning({}, daily, 'vocabulary', 'flood', value));
  }
  assert.throws(() => recordLearning({}, daily, 'vocabulary', 'unknown', { heard: 'yes', read: 'known' }));
});

test('LP-07/08/09 and RC-05/07: views, backup and atomic storage are wired without changing SRS', async () => {
  const shell = await read('sw.js');
  for (const file of ['learning.js', 'learning-store.js', 'backup.js', 'views/prepare.js', 'views/task.js']) assert.ok(shell.includes(`./js/${file}`));
  assert.match(await read('js/views/settings.js'), /createBackupText/);
  assert.match(await read('js/views/settings.js'), /replaceAllStores/);
  const prepare = await read('js/views/prepare.js');
  assert.match(prepare, /onResolved:\s*\(\)\s*=>/);
  assert.match(prepare, /word\.lookupRequired && !s\.lookupOpened/);
  assert.match(await read('js/learning-store.js'), /kvUpdate/);
  const storage = await read('js/storage.js');
  assert.match(storage, /cacheDocument\(cache, lessonUrl\(lesson\)\)/);
  assert.match(storage, /cacheDocument\(cache, '\.\/content\/index\.json'\)/);
  for (const file of ['js/views/prepare.js', 'js/views/task.js']) {
    assert.doesNotMatch(await read(file), /import .*srs|grade\(/);
    assert.doesNotMatch(await read(file), /say\([^;]+lessonId/s);
  }
});
