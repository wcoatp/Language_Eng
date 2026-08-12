/* Difficulty scoring — pure functions, no browser or Node APIs.
   Imported by the app (content.js) and by the offline tools, so a lesson gets
   the same level whether it was graded in the browser or on the command line. */

/* The ~300 most frequent English words. A sentence built only from these is L1;
   the further its vocabulary strays, the higher the level. */
const COMMON = new Set(
  `the be to of and a in that have i it for not on with he as you do at this
but his by from they we say her she or an will my one all would there their what so up out if about
who get which go me when make can like time no just him know take people into year your good some
could them see other than then now look only come its over think also back after use two how our
work first well way even new want because any these give day most us is are was were been has had
did does going got am very much many little own right still where why here too more thing man world
life hand part child eye woman place week case point government company number group problem fact
be able need feel seem let put mean keep begin help talk turn start show hear play run move live
believe bring happen write sit stand lose pay meet include continue set learn change lead understand
watch follow stop create speak read allow add spend grow open walk win offer remember love consider
appear buy wait serve die send expect build stay fall cut reach kill remain today tomorrow yesterday
morning night hello hi yes ok okay thanks thank please sorry really actually maybe sure great nice
old long high small large next early young important few public bad same able every another last
great big different such best better free`
    .split(/\s+/)
    .filter(Boolean),
);

const CONTRACTION = /'(s|t|re|ve|ll|d|m)$/;

/** Words in a sentence, lowercased, apostrophes kept. */
export function words(text) {
  return (
    String(text)
      .toLowerCase()
      .match(/[a-z']+/g) || []
  );
}

/**
 * Grade a set of sentences 1-5 from average length and vocabulary rarity.
 * @param {(string|{text:string})[]} sentences
 */
export function scoreDifficulty(sentences) {
  const texts = sentences
    .map((s) => (typeof s === "string" ? s : s.text))
    .filter(Boolean);
  if (!texts.length) return 1;

  let total = 0,
    rare = 0;
  for (const t of texts) {
    for (const w of words(t)) {
      total++;
      if (!COMMON.has(w.replace(CONTRACTION, ""))) rare++;
    }
  }
  const avgLen = total / texts.length;
  const rareRatio = total ? rare / total : 0;

  // Roughly: 9-word common-vocabulary sentences -> 1; 24-word rare-heavy -> 5.
  const lenScore = Math.min(5, Math.max(1, (avgLen - 6) / 3.6));
  const vocabScore = Math.min(5, Math.max(1, rareRatio / 0.11));
  return Math.max(
    1,
    Math.min(5, Math.round(lenScore * 0.55 + vocabScore * 0.45)),
  );
}

/**
 * How hard a sentence is to *catch*, from how fast it is delivered.
 * ~105 wpm is deliberate teaching pace; ~185 wpm is unhosted native speech.
 */
export function speedScore(wpm) {
  if (!wpm) return null;
  return Math.max(1, Math.min(5, (wpm - 85) / 20));
}

/** Middle value of a list, robust to the odd mistimed sentence. */
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Level for a lesson with real recorded speech.
 *
 * Text difficulty alone badly misjudges this material: graded news is written
 * in a small vocabulary but delivered at full speed, so a native-pace interview
 * scores as beginner text while being some of the hardest listening there is.
 * Weight what the ear has to do as much as what the words are.
 *
 * @param {{text:string, wpm?:number|null}[]} sentences
 */
export function scoreListening(sentences) {
  const text = scoreDifficulty(sentences);
  const pace = median(sentences.map((s) => s.wpm).filter(Boolean));
  const speed = speedScore(pace);
  if (speed == null) return text;
  return Math.max(1, Math.min(5, Math.round(speed * 0.5 + text * 0.5)));
}

/** Target words-per-minute for a level. */
export function wpmFor(level) {
  return [0, 100, 115, 130, 145, 160][level] || 130;
}

/** Playback rate multiplier so a level's audio lands near its target WPM. */
export function rateFor(level) {
  return Math.round((wpmFor(level) / 150) * 100) / 100;
}

/** Actual delivery speed of a spoken sentence, when its duration is known. */
export function measuredWpm(text, seconds) {
  if (!seconds || seconds <= 0) return null;
  return Math.round((words(text).length / seconds) * 60);
}
