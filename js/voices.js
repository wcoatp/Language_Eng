/* The voice catalogue — one entry per pre-generated audio set.

   Each id is also the folder under content/audio/, so adding a voice is a
   matter of generating its clips and listing it here.

   Two things vary between engines and both matter to a learner:

     pace  — synthetic speech has a fixed delivery. edge-tts lands near 114 wpm
             (deliberate teaching pace, very clear); Kokoro near 146 wpm, which
             is where real conversation actually sits. That difference is what
             makes one sound like reading aloud and the other like talking.
     reach — only edge-tts covers many English-speaking countries. Kokoro has
             American and British and nothing else; Chatterbox is one voice. */

export const VOICES = [
  // Natural conversational pace. The default for anything past beginner.
  {
    id: "kokoro-us",
    core: true,
    engine: "Kokoro",
    lang: "en-US",
    label: "美式 · 自然",
    wpm: 146,
    note: "對話節奏,接近真人講話速度",
  },
  {
    id: "kokoro-gb",
    core: true,
    engine: "Kokoro",
    lang: "en-GB",
    label: "英式 · 自然",
    wpm: 146,
    note: "對話節奏,接近真人講話速度",
  },

  // Deliberate teaching pace, and the only engine with real accent coverage.
  {
    id: "edge-us",
    core: true,
    engine: "edge-tts",
    lang: "en-US",
    label: "美式 · 清晰",
    wpm: 114,
    note: "每個字都很清楚,適合剛開始",
  },
  {
    id: "edge-gb",
    core: true,
    engine: "edge-tts",
    lang: "en-GB",
    label: "英式 · 清晰",
    wpm: 114,
  },
  { id: "edge-au", engine: "edge-tts", lang: "en-AU", label: "澳洲", wpm: 114 },
  { id: "edge-in", engine: "edge-tts", lang: "en-IN", label: "印度", wpm: 114 },
  {
    id: "edge-ie",
    engine: "edge-tts",
    lang: "en-IE",
    label: "愛爾蘭",
    wpm: 114,
  },
  { id: "edge-za", engine: "edge-tts", lang: "en-ZA", label: "南非", wpm: 114 },
  {
    id: "edge-ca",
    engine: "edge-tts",
    lang: "en-CA",
    label: "加拿大",
    wpm: 114,
  },
  {
    id: "edge-nz",
    engine: "edge-tts",
    lang: "en-NZ",
    label: "紐西蘭",
    wpm: 114,
  },

  // One voice, no accent choice — it is a delivery style rather than a region.
  {
    id: "chatterbox-us",
    engine: "Chatterbox",
    lang: "en-US",
    label: "美式 · 表現力",
    wpm: 170,
    note: "語氣起伏最大,語速偏快",
  },
];

export const AUTO = "auto";

export const byId = (id) => VOICES.find((v) => v.id === id) || null;

/** Voices sharing an accent, so "auto" can stay in the accent the learner chose. */
export const forLang = (lang) => VOICES.filter((v) => v.lang === lang);

/**
 * Which voice to use for a lesson, honouring the learner's choice.
 *
 * In auto mode the pace steps up with the level: a beginner gets the clearest
 * delivery available, and from L2 the natural conversational pace, because the
 * whole point is to end up understanding people who talk at normal speed.
 * When an accent has no natural voice (only US and GB do), auto stays on the
 * clear one rather than silently switching the learner's accent.
 */
export function pickVoice(setting, lang, level) {
  if (setting && setting !== AUTO) {
    const exact = byId(setting);
    if (exact) return exact;
  }
  const pool = forLang(lang);
  if (!pool.length) return null;
  const clear = pool.find((v) => v.engine === "edge-tts") || pool[0];
  const natural = pool.find((v) => v.engine === "Kokoro");
  return level <= 1 ? clear : natural || clear;
}

/** Human-readable summary of what auto will do for this accent. */
export function describeAuto(lang) {
  const pool = forLang(lang);
  const clear = pool.find((v) => v.engine === "edge-tts");
  const natural = pool.find((v) => v.engine === "Kokoro");
  if (!clear && !natural) return "這個口音沒有預生成音檔,會使用裝置內建語音";
  if (!natural) return `所有難度都用「${clear.label}」(這個口音只有這個聲音)`;
  return `L1 用「${clear.label}」(${clear.wpm} wpm),L2 以上用「${natural.label}」(${natural.wpm} wpm)`;
}

/* Core sets are generated for every lesson and ship with the app; the accent
   packs are generated on demand, because eleven sets of a week of stories is
   about 90 MB and two hours of synthesis for accents that mostly go unheard.
   Anything missing falls back through here rather than to the device voice —
   a different accent is a far smaller loss than a robot reading. */
export const CORE_VOICES = VOICES.filter((v) => v.core).map((v) => v.id);

export const isCore = (id) => !!byId(id)?.core;

/**
 * Voice ids to try, in order, for a lesson that may not have every set.
 * The chosen voice first, then core voices in the same accent, then any core
 * voice. Returns ids only, so it stays pure and testable.
 */
export function fallbackChain(voiceId, lang) {
  const wanted = byId(voiceId);
  const sameLang = VOICES.filter(
    (v) => v.core && v.lang === (wanted?.lang || lang),
  );
  const seen = new Set();
  return [voiceId, ...sameLang.map((v) => v.id), ...CORE_VOICES].filter(
    (id) => id && !seen.has(id) && seen.add(id),
  );
}

/** Resolve the voice a lesson should play in, from the learner's settings. */
export function voiceForLesson(cfg, lesson) {
  return pickVoice(cfg.voice, cfg.accentLang, lesson?.level ?? 3);
}

/** The folder id to read clips from, or '' when nothing is pre-generated. */
export function voiceIdForLesson(cfg, lesson) {
  return voiceForLesson(cfg, lesson)?.id || "";
}
