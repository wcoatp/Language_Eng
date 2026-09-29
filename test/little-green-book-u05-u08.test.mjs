import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildLessonPlan, learningProblems } from '../js/learning.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const expected = [
  ['l2-09', 'U05', 'The AC Isn\'t Cooling', 'l2-10'],
  ['l2-10', 'U06', 'Is Parking Included?', 'l2-11'],
  ['l2-11', 'U07', 'Checking In at the Clinic', 'l2-12'],
  ['l2-12', 'U08', 'Calling Roadside Assistance', null],
];
const lessons = await Promise.all(expected.map(([id]) =>
  read(`content/lessons/${id}.json`).then(JSON.parse)));

test('LGI-07: U05-U08 are four ordered standalone L2 lessons with 40 original sentences', () => {
  assert.equal(lessons.reduce((total, lesson) => total + lesson.sentences.length, 0), 40);
  lessons.forEach((lesson, index) => {
    const [id, unit, title, next] = expected[index];
    assert.equal(lesson.id, id);
    assert.equal(lesson.title, title);
    assert.equal(lesson.curriculum.seriesId, 'little-green-book-foundation');
    assert.equal(lesson.curriculum.unit, unit);
    assert.equal(lesson.level, 2);
    assert.equal(lesson.type, 'dialogue');
    assert.equal(lesson.sentences.length, 10);
    assert.equal(lesson.learning.next?.id || null, next);
    assert.equal(lesson.preGeneratedAudio, true);
    assert.match(lesson.source, /^原創基礎課程/);
    lesson.sentences.forEach((sentence, sentenceIndex) => {
      assert.equal(sentence.id, `s${sentenceIndex + 1}`, `${id}/${sentence.id}`);
      assert.equal(sentence.speaker, sentenceIndex % 2 === 0 ? 'A' : 'B', `${id}/${sentence.id}`);
      assert.ok(sentence.text.trim(), `${id}/${sentence.id} has English text`);
      assert.ok(sentence.zh.trim(), `${id}/${sentence.id} has Chinese text`);
    });
  });
});

test('LGI-08: vocab, question evidence, tasks and optional speaking practice validate', () => {
  lessons.forEach((lesson, index) => {
    assert.deepEqual(learningProblems(lesson), [], lesson.id);
    assert.equal(lesson.learning.vocabulary.length, 6, lesson.id);
    assert.equal(lesson.questions.length, 3, lesson.id);
    assert.ok(lesson.questions.every(question =>
      question.explanationZh && question.sentenceIds?.length), lesson.id);
    assert.equal(lesson.learning.task.steps.length, 3, lesson.id);
    assert.ok(lesson.learning.task.partnerLabelZh, lesson.id);
    assert.ok(lesson.learning.task.success.length >= 3, lesson.id);
    assert.ok(lesson.learning.spokenPractice.alternatives.length >= 2, lesson.id);
    assert.ok(lesson.learning.spokenPractice.drill.turns.length >= 2, lesson.id);
    const plan = buildLessonPlan(lesson);
    assert.equal(plan.targetMinutes, 30, lesson.id);
    assert.equal(plan.isExcerpt, false, lesson.id);
    assert.deepEqual(plan.coreSentenceIds, lesson.sentences.map(sentence => sentence.id), lesson.id);
    assert.equal(plan.coreSentenceCount, 10, lesson.id);
    assert.ok(expected[index][1], 'unit mapping is defined');
  });
  assert.equal(lessons.reduce((total, lesson) => total + lesson.learning.vocabulary.length, 0), 24);
  assert.equal(lessons.reduce((total, lesson) => total + lesson.questions.length, 0), 12);
});

test('LGI-09: all four voice sets align with each course sentence order', async () => {
  const [index, manifest] = await Promise.all([
    read('content/index.json').then(JSON.parse),
    read('content/audio/manifest.json').then(JSON.parse),
  ]);
  const voiceIds = ['edge-gb', 'edge-us', 'kokoro-gb', 'kokoro-us'];
  for (const [id, unit] of expected) {
    const lesson = lessons.find(item => item.id === id);
    const row = index.lessons.find(item => item.id === id);
    assert.ok(row, `${id} is present in content index`);
    assert.equal(row.level, 2, id);
    assert.equal(row.count, 10, id);
    assert.equal(lesson.curriculum.unit, unit);
    assert.deepEqual(Object.keys(manifest.lessons?.[id] || {}).sort(), voiceIds, id);
    const sentenceIds = lesson.sentences.map(sentence => sentence.id);
    for (const voiceId of voiceIds) {
      assert.deepEqual(manifest.lessons[id][voiceId], sentenceIds, `${id}/${voiceId}`);
    }
  }
  assert.equal(index.lessons.length, 119);
  assert.equal(index.lessons.reduce((total, lesson) => total + lesson.count, 0), 1956);
});
