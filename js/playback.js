/* Pure helpers shared by the continuous-play view and unit tests. */

export const PLAYBACK_RATES = [0.75, 1, 1.25];
export const PLAYBACK_GAPS = [0, 500, 1000, 2000];

/** Resolve the ordered sentences for full-text or individual-selection mode. */
export function playbackSequence(sentences, mode, selectedIds = []) {
  const rows = Array.isArray(sentences) ? sentences : [];
  if (mode === "all") return [...rows];
  const selected =
    selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  return rows.filter((sentence) => selected.has(sentence.id));
}

/**
 * The lesson hands-free should roll on to when this one ends.
 *
 * A story series is the strongest thread — finishing day 1 and stopping is a
 * worse outcome than any library ordering. After that, the next published day,
 * and only then the next lesson of the same kind at a level the learner is
 * already working at, so an unattended queue cannot wander into L5.
 *
 * @param {object[]} index    lesson summaries, as content/index.json holds them
 * @param {object}   lesson   the one that just finished
 * @returns {object|null}
 */
export function nextLessonFor(index = [], lesson = null) {
  if (!lesson) return null;
  const rows = Array.isArray(index) ? index : [];
  const others = rows.filter((l) => l.id !== lesson.id);

  const meta = lesson.daily;
  if (meta) {
    const sameSeries = others.find(
      (l) =>
        l.daily?.seriesId === meta.seriesId && l.daily.day === meta.day + 1,
    );
    if (sameSeries) return sameSeries;

    const later = others
      .filter((l) => l.daily?.date && l.daily.date > meta.date)
      .sort((a, b) => a.daily.date.localeCompare(b.daily.date));
    return later[0] || null;
  }

  // Never step up more than one level unattended.
  const reachable = others
    .filter(
      (l) => !l.daily && l.type === lesson.type && l.level <= lesson.level + 1,
    )
    .sort(
      (a, b) => a.level - b.level || String(a.id).localeCompare(String(b.id)),
    );
  const after = reachable.filter(
    (l) => l.level > lesson.level || String(l.id) > String(lesson.id),
  );
  return after[0] || null;
}

/* ---------- training speeds ---------- */

/* Slowing speech down helps only up to a point. Past roughly this pace the
   time-stretcher smears the very consonants the learner is straining to hear,
   so every further step makes the sentence harder rather than easier. */
export const MIN_SLOW_WPM = 75;
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
export const SLOW_STEPS = 3;

/* Two steps that come out within this much of each other are the same sound;
   offering both would be a button that does nothing. */
const SAME_RATE = 0.03;

// Three decimals: rounding to two costs about 1% of the target pace, which is
// enough to miss the level's wpm by a word a minute for no benefit.
const clampRate = (r) =>
  Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, r)) * 1000) / 1000;

/**
 * Playback rates for one sentence: normal, plus the slow ladder under it.
 *
 * Rates are derived from the pace the audio was actually recorded at, not from
 * a fixed assumption. Engines differ by a lot — edge-tts lands near 114 wpm and
 * Kokoro near 146 — so the same multiplier produces two different speeds, and a
 * slow step stacked on top of an already-reduced rate compounds into a crawl.
 *
 * @param {object}  o
 * @param {number}  o.targetWpm  pace this level should sound like
 * @param {number}  o.sourceWpm  pace the audio was actually recorded at
 * @param {number} [o.normalRate] learner's normal-speed preference
 * @param {number} [o.slowRate]   learner's slow-speed preference
 * @param {boolean}[o.rescale]    false for human recordings, which keep their own pace
 * @returns {{normal:number, normalWpm:number, slow:{rate:number, wpm:number}[]}}
 */
export function speechRates({
  targetWpm,
  sourceWpm,
  normalRate = 1,
  slowRate = 0.7,
  rescale = true,
} = {}) {
  const source = sourceWpm > 0 ? sourceWpm : 150;
  // Rescaling a human speaker to hit a level target would misrepresent how
  // they actually talk, so real recordings only ever get slowed, never retuned.
  const wanted = (rescale && targetWpm > 0 ? targetWpm : source) * normalRate;
  const normal = clampRate(wanted / source);
  const normalWpm = Math.round(source * normal);

  const slow = [];
  for (let step = 0; step < SLOW_STEPS; step++) {
    const fraction = Math.max(0.35, slowRate - step * 0.1);
    const rate = clampRate(
      Math.max(MIN_SLOW_WPM, normalWpm * fraction) / source,
    );
    if (rate >= normal) break; // no room below
    if (slow.length && slow.at(-1).rate - rate < SAME_RATE) break; // floor reached
    slow.push({ rate, wpm: Math.round(source * rate) });
  }
  return { normal, normalWpm, slow };
}
