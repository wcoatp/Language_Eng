import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { buildLessonPlan, learningProblems, withAutomaticLearning } from '../js/learning.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const daily = JSON.parse(await read('content/lessons/daily-2026-08-23.json'));
const foundation = JSON.parse(await read('content/lessons/l1-07.json'));

test('CP-02/03: all built-in lessons produce a valid, ordered 30-minute core', async () => {
  const dir = new URL('../content/lessons/', import.meta.url);
  const files = (await readdir(dir)).filter(file => file.endsWith('.json'));
  for (const file of files) {
    const lesson = withAutomaticLearning(JSON.parse(await readFile(new URL(file, dir), 'utf8')));
    const plan = buildLessonPlan(lesson);
    const order = new Map(lesson.sentences.map((sentence, index) => [sentence.id, index]));
    assert.equal(plan.targetMinutes, 30, lesson.id);
    assert.ok(plan.coreSentenceCount > 0 && plan.coreSentenceCount <= plan.totalSentenceCount, lesson.id);
    assert.equal(new Set(plan.coreSentenceIds).size, plan.coreSentenceCount, lesson.id);
    assert.deepEqual(plan.coreSentenceIds,
      [...plan.coreSentenceIds].sort((a, b) => order.get(a) - order.get(b)), lesson.id);
    if (lesson.daily) assert.ok(plan.coreSentenceCount >= 8 && plan.coreSentenceCount <= 12, lesson.id);
  }
});

test('CP-02: every lesson plan has six phases totaling 30 minutes', () => {
  for (const lesson of [daily, foundation]) {
    const plan = buildLessonPlan(lesson);
    assert.equal(plan.phases.length, 6);
    assert.equal(plan.phases.reduce((total, phase) => total + phase.minutes, 0), 30);
    assert.equal(plan.targetMinutes, 30);
  }
});

test('CP-03: a daily story selects ten ordered core sentences across its story arc', () => {
  const plan = buildLessonPlan(daily);
  const lessonOrder = new Map(daily.sentences.map((sentence, index) => [sentence.id, index]));
  assert.equal(plan.coreSentenceCount, 10);
  assert.ok(plan.isExcerpt);
  assert.equal(plan.coreSentenceIds[0], daily.sentences[0].id);
  assert.ok(plan.coreSentenceIds.includes(daily.sentences.at(-1).id));
  for (const id of Object.values(daily.storyArc)) assert.ok(plan.coreSentenceIds.includes(id), id);
  assert.deepEqual(plan.coreSentenceIds, [...plan.coreSentenceIds].sort((a, b) => lessonOrder.get(a) - lessonOrder.get(b)));
  assert.equal(new Set(plan.coreSentenceIds).size, plan.coreSentenceIds.length);
});

test('CP-03: a short situational lesson keeps every sentence in the core class', () => {
  const plan = buildLessonPlan(foundation);
  assert.equal(plan.isExcerpt, false);
  assert.deepEqual(plan.coreSentenceIds, foundation.sentences.map(sentence => sentence.id));
});

test('CP-03: a long non-daily lesson is capped and sampled deterministically', () => {
  const lesson = {
    id: 'long', level: 3, type: 'article',
    sentences: Array.from({ length: 20 }, (_, i) => ({
      id: `s${i + 1}`,
      text: 'This deliberately long sentence contains enough ordinary words to exercise the lesson planner safely.',
    })),
  };
  const first = buildLessonPlan(lesson);
  const second = buildLessonPlan(structuredClone(lesson));
  assert.equal(first.coreSentenceCount, 12);
  assert.equal(first.coreSentenceIds[0], 's1');
  assert.equal(first.coreSentenceIds.at(-1), 's20');
  assert.deepEqual(first, second);
  assert.equal(lesson.learning, undefined);
});

test('CP-03/04: a valid authored selection wins but remains in lesson order', () => {
  const chosen = daily.sentences.slice(0, 8).map(sentence => sentence.id).reverse();
  const lesson = structuredClone(daily);
  lesson.learning.coreSentenceIds = chosen;
  const plan = buildLessonPlan(lesson);
  assert.equal(plan.selection, 'authored');
  assert.deepEqual(plan.coreSentenceIds, chosen.reverse());
  assert.deepEqual(learningProblems(lesson), []);

  lesson.learning.coreSentenceIds = ['s1', 's1'];
  assert.match(learningProblems(lesson).join('\n'), /duplicates|8-12/);
  assert.equal(buildLessonPlan(lesson).selection, 'automatic');
});

test('CP-04/05/06: shell wires the core route while preserving full listening', async () => {
  const [app, lesson, listen, prepare, store] = await Promise.all([
    read('js/app.js'), read('js/views/lesson.js'), read('js/views/listen.js'),
    read('js/views/prepare.js'), read('js/store.js'),
  ]);
  assert.ok(app.includes('([^/]+)(?:\\/(core))?'));
  assert.match(lesson, /本課核心路線/);
  assert.match(lesson, /全文逐句精聽/);
  assert.match(listen, /practiceSentences/);
  assert.match(prepare, /\/core/);
  assert.match(store, /dailyGoalMin:\s*30/);
});
