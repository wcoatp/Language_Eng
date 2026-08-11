/* Spaced repetition over individual sentences (SM-2, simplified).

   A card is created the first time a sentence is graded in the trainer.
   Grades: 0 = 沒聽懂, 1 = 勉強, 2 = 聽懂了 */

import { db } from './db.js';

const DAY = 86400000;
const cardId = (lessonId, sentenceId) => `${lessonId}:${sentenceId}`;

export async function getCard(lessonId, sentenceId) {
  return db.get('cards', cardId(lessonId, sentenceId));
}

export async function grade(lessonId, sentenceId, g, extra = {}) {
  const id = cardId(lessonId, sentenceId);
  const now = Date.now();
  const card = (await db.get('cards', id)) || {
    id, lessonId, sentenceId,
    ease: 2.5, interval: 0, reps: 0, lapses: 0, due: now,
  };

  if (g <= 0) {
    // Missed it — back to the front of the queue, and make future gaps shorter.
    card.lapses++;
    card.reps = 0;
    card.interval = 0;
    card.ease = Math.max(1.3, card.ease - 0.2);
    card.due = now + 10 * 60 * 1000;          // again in 10 minutes
  } else {
    card.reps++;
    if (g === 1) card.ease = Math.max(1.3, card.ease - 0.15);
    else card.ease = Math.min(2.8, card.ease + 0.1);

    if (card.reps === 1) card.interval = g === 1 ? 1 : 2;
    else if (card.reps === 2) card.interval = g === 1 ? 3 : 5;
    else card.interval = Math.round(card.interval * card.ease);

    card.interval = Math.min(card.interval, 180);
    card.due = now + card.interval * DAY;
  }

  card.lastGrade = g;
  card.updatedAt = now;
  Object.assign(card, extra);
  await db.put('cards', card);
  return card;
}

/** Cards due now, hardest-first. */
export async function dueCards(limit = 40) {
  const rows = await db.byIndexUpTo('cards', 'due', Date.now());
  rows.sort((a, b) => (a.lastGrade ?? 9) - (b.lastGrade ?? 9) || a.due - b.due);
  return rows.slice(0, limit);
}

export async function dueCount() {
  const rows = await db.byIndexUpTo('cards', 'due', Date.now());
  return rows.length;
}

export async function lessonProgress(lessonId) {
  const all = await db.all('cards');
  const mine = all.filter(c => c.lessonId === lessonId);
  const learned = mine.filter(c => (c.lastGrade ?? 0) >= 1).length;
  return { seen: mine.length, learned };
}

/** Map of lessonId → {seen, learned}, for the library list. */
export async function allLessonProgress() {
  const all = await db.all('cards');
  const map = new Map();
  for (const c of all) {
    const e = map.get(c.lessonId) || { seen: 0, learned: 0 };
    e.seen++;
    if ((c.lastGrade ?? 0) >= 1) e.learned++;
    map.set(c.lessonId, e);
  }
  return map;
}
