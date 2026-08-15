/* Retrieval practice: producing the sentence before hearing it.

   Everywhere else in the app the English is on screen before the learner opens
   their mouth. Shadowing, roleplay, the trainer's compare stage — all of them
   are reading aloud, which rehearses articulation. What none of them rehearses
   is retrieval: getting the words out of memory with nothing to copy. That is
   the thing that fails in a real conversation.

   The cue deliberately is not the Chinese alone. A Chinese-only prompt is a
   translation exercise, and translating from the first language is the habit
   this app exists to unlearn. So the cue is the meaning *plus* an English
   opening: the Chinese says which sentence, the opening keeps the retrieval
   inside English. How much of an opening is the difficulty dial. */

export const SCAFFOLD_STEPS = [0, 2, 4];

/** Words per minute a learner can retrieve and speak at, not read at. */
const RETRIEVAL_WPM = 55;
const MIN_THINK_MS = 2500;
const MAX_THINK_MS = 12000;

export function wordsOf(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean);
}

/**
 * Split a sentence into the part shown as a run-up and the part to retrieve.
 *
 * The opening never swallows the whole sentence: there is always something
 * left to produce, or the drill is just reading again.
 *
 * @param {string} text
 * @param {number} scaffold  how many opening words to reveal
 */
export function recallCue(text, scaffold = 2) {
  const words = wordsOf(text);
  if (!words.length) return { lead: "", missing: 0, total: 0 };
  const lead = Math.max(0, Math.min(scaffold, words.length - 1));
  return {
    lead: words.slice(0, lead).join(" "),
    missing: words.length - lead,
    total: words.length,
  };
}

/**
 * How long to leave silent before offering the answer.
 * Retrieval is much slower than reading, and cutting it short teaches the
 * learner to wait for the model instead of reaching for the words.
 */
export function thinkingMs(text) {
  const n = wordsOf(text).length;
  if (!n) return MIN_THINK_MS;
  const ms = (n / RETRIEVAL_WPM) * 60000;
  return Math.round(Math.min(MAX_THINK_MS, Math.max(MIN_THINK_MS, ms)));
}

/**
 * Is this card worth a retrieval rep yet?
 *
 * Recognising a sentence has to come before producing it: asking someone to
 * generate a sentence they have not yet understood tests nothing and only
 * teaches them that the drill is impossible. One successful recognition is
 * the gate.
 */
export function readyForRecall(card) {
  if (!card) return false;
  return (card.reps || 0) >= 1 && (card.lastGrade ?? 0) >= 1;
}

/**
 * Order a review queue so retrieval cards come first.
 * They are the harder, more valuable rep, and a session that runs out of time
 * should have spent it on those rather than on recognition.
 */
export function orderForRecall(cards = []) {
  const ready = [];
  const rest = [];
  for (const card of cards) (readyForRecall(card) ? ready : rest).push(card);
  return [...ready, ...rest];
}
