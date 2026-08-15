/* Spaced repetition over individual sentences (SM-2, simplified).

   A card is created the first time a sentence is graded in the trainer.
   Grades: 0 = 沒聽懂, 1 = 勉強, 2 = 聽懂了 */

import { db } from "./db.js";

const DAY = 86400000;
const LAPSE_DELAY = 10 * 60 * 1000;
const MAX_INTERVAL = 180;

/* 勉強 grows the gap on its own fixed step rather than on the card's ease.
   Using ease for both made the two buttons converge: from rep 3 a card graded
   勉強 came back one day earlier than the same card graded 掌握了, so the
   middle button was, in practice, a slightly apologetic version of the right
   one. Holding it near the current interval is what makes it mean anything. */
const HARD_STEP = 1.2;

const cardId = (lessonId, sentenceId) => `${lessonId}:${sentenceId}`;

export const newCard = (id, lessonId, sentenceId, now = Date.now()) => ({
  id,
  lessonId,
  sentenceId,
  ease: 2.5,
  interval: 0,
  reps: 0,
  lapses: 0,
  due: now,
});

/**
 * The SM-2 arithmetic, with no storage attached so it can be tested and so the
 * buttons can show the interval they are actually about to schedule.
 *
 * @param {object} card  existing card, or one from newCard()
 * @param {0|1|2}  g     0 = 沒聽懂, 1 = 勉強, 2 = 掌握了
 * @returns {{ease:number, interval:number, reps:number, lapses:number, due:number}}
 */
export function schedule(card, g, now = Date.now()) {
  const { ease, interval, reps, lapses } = card;

  if (g <= 0) {
    // Missed it — back to the front of the queue, and make future gaps shorter.
    return {
      ease: Math.max(1.3, ease - 0.2),
      interval: 0,
      reps: 0,
      lapses: lapses + 1,
      due: now + LAPSE_DELAY,
    };
  }

  const nextReps = reps + 1;
  const nextEase =
    g === 1 ? Math.max(1.3, ease - 0.15) : Math.min(2.8, ease + 0.1);

  let next;
  if (nextReps === 1) next = g === 1 ? 1 : 2;
  else if (nextReps === 2) next = g === 1 ? 3 : 5;
  else next = Math.round(interval * (g === 1 ? HARD_STEP : nextEase));
  next = Math.max(1, Math.min(next, MAX_INTERVAL));

  return {
    ease: nextEase,
    interval: next,
    reps: nextReps,
    lapses,
    due: now + next * DAY,
  };
}

/** How the next gap reads on a button, e.g. "10 分鐘" or "12 天". */
export function describeInterval(days) {
  if (!days) return "10 分鐘後";
  if (days === 1) return "明天";
  if (days < 30) return `${days} 天後`;
  const months = Math.round(days / 30);
  return `${months} 個月後`;
}

/** What each grade would schedule for this card, for honest button labels. */
export function gradePreview(card, now = Date.now()) {
  const base = card || newCard("", "", "", now);
  return [0, 1, 2].map((g) =>
    describeInterval(schedule(base, g, now).interval),
  );
}

export async function getCard(lessonId, sentenceId) {
  return db.get("cards", cardId(lessonId, sentenceId));
}

export async function grade(lessonId, sentenceId, g, extra = {}) {
  const id = cardId(lessonId, sentenceId);
  const now = Date.now();
  const card =
    (await db.get("cards", id)) || newCard(id, lessonId, sentenceId, now);

  Object.assign(card, schedule(card, g, now), extra, {
    lastGrade: g,
    updatedAt: now,
  });
  await db.put("cards", card);
  return card;
}

/** Cards due now, hardest-first. */
export async function dueCards(limit = 40) {
  const rows = await db.byIndexUpTo("cards", "due", Date.now());
  rows.sort((a, b) => (a.lastGrade ?? 9) - (b.lastGrade ?? 9) || a.due - b.due);
  return rows.slice(0, limit);
}

export async function dueCount() {
  const rows = await db.byIndexUpTo("cards", "due", Date.now());
  return rows.length;
}

export async function lessonProgress(lessonId) {
  const all = await db.all("cards");
  const mine = all.filter((c) => c.lessonId === lessonId);
  const learned = mine.filter((c) => (c.lastGrade ?? 0) >= 1).length;
  return { seen: mine.length, learned };
}

/** Map of lessonId → {seen, learned}, for the library list. */
export async function allLessonProgress() {
  const all = await db.all("cards");
  const map = new Map();
  for (const c of all) {
    const e = map.get(c.lessonId) || { seen: 0, learned: 0 };
    e.seen++;
    if ((c.lastGrade ?? 0) >= 1) e.learned++;
    map.set(c.lessonId, e);
  }
  return map;
}
