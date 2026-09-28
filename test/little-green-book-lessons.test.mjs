import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildLessonPlan, learningProblems } from '../js/learning.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const expected = [
  ['l1-08', 'U01', 10, 'l1-01', '同學說'],
  ['l1-09', 'U02', 10, null, '室友說'],
  ['l1-10', 'U03', 10, 'l1-05', '店員說'],
  ['l1-11', 'U04', 12, null, '店員說'],
];
const lessons = await Promise.all(expected.map(([id]) =>
  read(`content/lessons/${id}.json`).then(JSON.parse)));

test('LGI-01/02: U01-U04 are four ordered L1 lessons with 42 sentences', () => {
  assert.equal(lessons.reduce((total, lesson) => total + lesson.sentences.length, 0), 42);
  lessons.forEach((lesson, index) => {
    const [id, unit, count, prerequisite] = expected[index];
    assert.equal(lesson.id, id);
    assert.equal(lesson.curriculum.seriesId, 'little-green-book-foundation');
    assert.equal(lesson.curriculum.unit, unit);
    assert.equal(lesson.level, 1);
    assert.equal(lesson.type, 'dialogue');
    assert.equal(lesson.sentences.length, count);
    assert.equal(lesson.learning.prerequisite?.id || null, prerequisite);
    assert.equal(lesson.preGeneratedAudio, false);
    assert.match(lesson.source, /^原創基礎課程/);
  });
});

test('LGI-02/03: vocabulary, evidence questions and contextual tasks validate', () => {
  lessons.forEach((lesson, index) => {
    assert.deepEqual(learningProblems(lesson), [], lesson.id);
    assert.equal(lesson.learning.vocabulary.length, 5, lesson.id);
    assert.equal(lesson.questions.length, 3, lesson.id);
    assert.ok(lesson.questions.every(question => question.explanationZh && question.sentenceIds.length), lesson.id);
    assert.equal(lesson.learning.task.steps.length, 3, lesson.id);
    assert.equal(lesson.learning.task.partnerLabelZh, expected[index][4], lesson.id);
    assert.ok(lesson.learning.task.success.length >= 3, lesson.id);
  });
  assert.equal(lessons.reduce((total, lesson) => total + lesson.learning.vocabulary.length, 0), 20);
  assert.equal(lessons.reduce((total, lesson) => total + lesson.questions.length, 0), 12);
});

test('LGI-04: every lesson has three optional spoken alternatives and a drill', () => {
  for (const lesson of lessons) {
    const spoken = lesson.learning.spokenPractice;
    assert.equal(spoken.alternatives.length, 3, lesson.id);
    assert.ok(spoken.alternatives.every(item => ['active', 'recognition'].includes(item.mode)), lesson.id);
    assert.ok(spoken.drill.turns.length >= 2, lesson.id);
    assert.ok(spoken.drill.successZh, lesson.id);
  }
  const shoppingTask = lessons.find(lesson => lesson.id === 'l1-11').learning.task;
  assert.match(shoppingTask.setupZh, /買黑色.*不買/);
});

test('LGI-05: all four lessons fit wholly inside the 30-minute core', () => {
  for (const lesson of lessons) {
    const plan = buildLessonPlan(lesson);
    assert.equal(plan.targetMinutes, 30, lesson.id);
    assert.equal(plan.isExcerpt, false, lesson.id);
    assert.deepEqual(plan.coreSentenceIds, lesson.sentences.map(sentence => sentence.id), lesson.id);
  }
});

test('LGI-06/07: index, audio manifest and optional UI stay honest', async () => {
  const [index, manifest, lessonView, taskView] = await Promise.all([
    read('content/index.json').then(JSON.parse),
    read('content/audio/manifest.json').then(JSON.parse),
    read('js/views/lesson.js'),
    read('js/views/task.js'),
  ]);
  assert.equal(index.lessons.length, 115);
  assert.equal(index.lessons.reduce((total, lesson) => total + lesson.count, 0), 1916);
  for (const [id] of expected) {
    assert.equal(index.lessons.find(lesson => lesson.id === id)?.preGeneratedAudio, false, id);
    assert.equal(manifest.lessons?.[id], undefined, id);
  }
  assert.match(lessonView, /口語加強/);
  assert.match(lessonView, /尚未經真人聽評/);
  assert.match(lessonView, /spokenPracticePanel/);
  assert.match(taskView, /partnerLabelZh/);
  assert.match(taskView, /partnerName/);
  assert.doesNotMatch(taskView, /聽店員/);
});
