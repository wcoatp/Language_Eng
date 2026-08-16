/* Speech output. Hybrid: pre-generated audio when available, browser TTS otherwise.
   Both paths are free and work offline once cached. */

import { fallbackChain, orderVoices } from "./voices.js";

const synth = window.speechSynthesis;

export const ACCENTS = [
  { code: "en-US", label: "美式", short: "us" },
  { code: "en-GB", label: "英式", short: "gb" },
  { code: "en-AU", label: "澳洲", short: "au" },
  { code: "en-IN", label: "印度", short: "in" },
  { code: "en-IE", label: "愛爾蘭", short: "ie" },
  { code: "en-ZA", label: "南非", short: "za" },
  { code: "en-CA", label: "加拿大", short: "ca" },
  { code: "en-NZ", label: "紐西蘭", short: "nz" },
];

let voices = [];
let voicesReady = null;
let unlocked = false;
let speechEpoch = 0;

/* macOS/iOS ship novelty voices (singing, robots, sound effects) alongside the
   real ones. They are useless for language practice and clutter the picker. */
const NOVELTY = new Set([
  "albert",
  "bad news",
  "bahh",
  "bells",
  "boing",
  "bubbles",
  "cellos",
  "deranged",
  "good news",
  "hysterical",
  "jester",
  "organ",
  "pipe organ",
  "superstar",
  "trinoids",
  "whisper",
  "wobble",
  "zarvox",
  "bruce",
  "junior",
  "kathy",
  "fred",
  "princess",
  "ralph",
  "grandma",
  "grandpa",
  "rocko",
  "sandy",
  "shelley",
  "eddy",
  "flo",
  "reed",
  "bubbles (english (uk))",
]);

const isNovelty = (v) => {
  const name = v.name
    .toLowerCase()
    .replace(/\s*\(.*\)\s*$/, "")
    .trim();
  return NOVELTY.has(name);
};

/** Natural/enhanced/premium voices sound dramatically better — surface them first. */
const voiceRank = (v) =>
  /natural|neural/i.test(v.name)
    ? 0
    : /enhanced|premium/i.test(v.name)
      ? 1
      : /siri|google/i.test(v.name)
        ? 2
        : 3;

/** Voice lists populate asynchronously on most browsers (and lazily on Safari). */
export function loadVoices() {
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((resolve) => {
    const grab = () => {
      voices = (synth?.getVoices() || [])
        .filter((v) => /^en/i.test(v.lang) && !isNovelty(v))
        .sort(
          (a, b) => voiceRank(a) - voiceRank(b) || a.name.localeCompare(b.name),
        );
      return voices.length > 0;
    };
    if (grab()) return resolve(voices);
    let tries = 0;
    const tick = () => {
      if (grab() || ++tries > 20) return resolve(voices);
      setTimeout(tick, 150);
    };
    if (synth)
      synth.onvoiceschanged = () => {
        if (grab()) resolve(voices);
      };
    tick();
  });
  return voicesReady;
}

export function englishVoices() {
  return voices;
}

export function voicesFor(langCode) {
  const base = langCode.slice(0, 2);
  const exact = voices.filter((v) => v.lang.replace("_", "-") === langCode);
  return exact.length
    ? exact
    : voices.filter((v) => v.lang.toLowerCase().startsWith(base));
}

/** Prefer a natural/enhanced voice when the platform offers one. */
export function pickVoice(langCode, preferredURI) {
  if (preferredURI) {
    const hit = voices.find((v) => v.voiceURI === preferredURI);
    if (hit) return hit;
  }
  const pool = voicesFor(langCode);
  if (!pool.length) return null;
  const nice = pool.find((v) =>
    /natural|enhanced|premium|siri|neural|google/i.test(v.name),
  );
  return nice || pool.find((v) => v.localService) || pool[0];
}

/** iOS/Safari require a speech call inside a user gesture before audio will play. */
export function unlock() {
  if (unlocked || !synth) return;
  try {
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    synth.speak(u);
    unlocked = true;
  } catch {
    /* non-fatal */
  }
}

export function cancel() {
  speechEpoch++;
  stopCurrent();
}

/* Pause holds the current clip where it is, unlike cancel, which abandons it.
   Hands-free needs this: a lock-screen or headphone pause has to resume the
   same sentence rather than restart the lesson. */
export function pause() {
  if (current) {
    current.audio.pause();
    return true;
  }
  try {
    if (synth?.speaking && !synth.paused) {
      synth.pause();
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Nudge the speed of the clip already playing.
 *
 * A factor rather than an absolute rate, because callers hold a speed
 * *preference* while the element holds the playback rate that was computed
 * from it and from the voice's own pace — passing the preference straight
 * through would throw that calculation away.
 *
 * Only the pre-generated path can do this: a SpeechSynthesisUtterance fixes
 * its rate when it starts, so the device voice changes on the next sentence.
 * Returns whether the change was immediate.
 */
export function scaleRate(factor) {
  if (!current || !(factor > 0) || factor === 1) return false;
  const next = current.audio.playbackRate * factor;
  current.audio.playbackRate = Math.min(2, Math.max(0.5, next));
  return true;
}

export function resume() {
  if (current) {
    current.audio.play().catch(() => {});
    return true;
  }
  try {
    if (synth?.paused) {
      synth.resume();
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function stopCurrent() {
  try {
    synth?.cancel();
  } catch {
    /* ignore */
  }
  stopAudio();
}

/* ---------- pre-generated audio ---------- */

let manifest = null;
let manifestTried = false;
let current = null; // { audio: HTMLAudioElement, finish: () => void }

async function getManifest() {
  if (manifestTried) return manifest;
  manifestTried = true;
  try {
    const res = await fetch("./content/audio/manifest.json", {
      cache: "no-cache",
    });
    if (res.ok) manifest = await res.json();
  } catch {
    manifest = null;
  }
  return manifest;
}

function accentShort(langCode) {
  return ACCENTS.find((a) => a.code === langCode)?.short || "us";
}

/* Lessons cut from a real recording live under one folder and ignore the
   accent setting entirely — the recording is whatever accent the speaker had,
   and there is no other take to choose from. */
export const REAL = "real";

/* A lesson's clips live in one folder: the chosen voice set, or "real" when
   the lesson is a human recording and there is nothing to choose. */
function folderFor(voiceId, realAudio) {
  return realAudio ? REAL : voiceId;
}

/** Does a stored clip exist for this sentence? */
export async function hasAudio(
  lessonId,
  sentenceId,
  voiceId,
  realAudio = false,
) {
  const m = await getManifest();
  if (!m) return false;
  const list = m.lessons?.[lessonId]?.[folderFor(voiceId, realAudio)];
  return Array.isArray(list) && list.includes(sentenceId);
}

/**
 * How many lessons each voice set actually covers.
 * The accent packs are generated on demand, so the picker has to say which of
 * them are complete instead of offering eleven and quietly substituting.
 * @returns {Promise<{total:number, counts:Map<string,number>}>}
 */
export async function voiceCoverage() {
  const m = await getManifest();
  const counts = new Map();
  let total = 0;
  for (const byVoice of Object.values(m?.lessons || {})) {
    const ids = Object.keys(byVoice);
    if (ids.includes(REAL)) continue; // human recordings have no voice choice
    total++;
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return { total, counts };
}

/** Which voice sets actually have clips for this lesson, catalogue order. */
export async function voicesForLesson(lessonId) {
  const m = await getManifest();
  const ids = Object.keys(m?.lessons?.[lessonId] || {}).filter(
    (id) => id !== REAL,
  );
  return orderVoices(ids);
}

/** Where a lesson's clips live, for offline download and cache checks. */
export async function clipUrls(lessonId, voiceId, realAudio = false) {
  const m = await getManifest();
  const folder = folderFor(voiceId, realAudio);
  const ids = m?.lessons?.[lessonId]?.[folder];
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => `./content/audio/${folder}/${lessonId}/${id}.mp3`);
}

function stopAudio() {
  if (!current) return;
  const active = current;
  active.audio.pause();
  active.finish();
}

function playFile(url, rate) {
  return new Promise((resolve, reject) => {
    stopAudio();
    const a = new Audio(url);
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      a.onended = a.onerror = null;
      if (current?.audio === a) current = null;
      if (error) reject(error);
      else resolve();
    };
    a.playbackRate = rate;
    a.preservesPitch = true; // keep the voice natural when slowed
    a.mozPreservesPitch = true;
    a.webkitPreservesPitch = true;
    current = { audio: a, finish };
    a.onended = () => finish();
    a.onerror = () => finish(new Error("audio failed"));
    a.play().catch(finish);
  });
}

/** Play audio held in memory, as imported lesson packs are. */
function playBlobUrl(blob, rate) {
  const url = URL.createObjectURL(blob);
  return playFile(url, rate).finally(() => URL.revokeObjectURL(url));
}

/* ---------- browser TTS ---------- */

function speakTTS(text, { rate = 1, langCode = "en-US", voiceURI = "" } = {}) {
  return new Promise((resolve, reject) => {
    if (!synth) return reject(new Error("no speechSynthesis"));
    synth.cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.rate = Math.max(0.1, Math.min(2, rate));
    u.pitch = 1;
    u.lang = langCode;
    const v = pickVoice(langCode, voiceURI);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }

    // Chrome desktop silently stops long utterances after ~15s unless nudged.
    const keepalive = setInterval(() => {
      if (synth.speaking) synth.resume();
      else clearInterval(keepalive);
    }, 8000);

    const done = () => {
      clearInterval(keepalive);
      resolve();
    };
    u.onend = done;
    u.onerror = (e) => {
      clearInterval(keepalive);
      // A cancel() during playback surfaces as an error; treat it as a normal stop.
      if (e.error === "canceled" || e.error === "interrupted") resolve();
      else reject(new Error(e.error || "tts failed"));
    };
    synth.speak(u);
  });
}

/**
 * Speak one sentence. Uses the pre-generated clip when the lesson has one,
 * falling back to browser TTS (so user-imported articles work immediately).
 */
export async function say(text, opts = {}) {
  const epoch = ++speechEpoch;
  // A new request always supersedes the previous sentence, including requests
  // still waiting for the audio manifest to load.
  stopCurrent();
  const {
    lessonId,
    sentenceId,
    langCode = "en-US",
    rate = 1,
    voiceURI = "",
    voiceId = "",
    realAudio = false,
    blob = null,
  } = opts;

  // Imported packs carry their audio with them rather than fetching a URL.
  if (blob) {
    try {
      return await playBlobUrl(blob, rate);
    } catch {
      if (epoch !== speechEpoch) return;
      /* fall through */
    }
  }

  if (epoch !== speechEpoch) return;
  if (lessonId && sentenceId) {
    // Accent packs are generated on demand, so the chosen voice may have no
    // clip for this lesson. Another accent is a much smaller loss than
    // dropping to the device's robot voice, so try the core sets first.
    const chain = realAudio ? [voiceId] : fallbackChain(voiceId, langCode);
    for (const id of chain) {
      if (epoch !== speechEpoch) return;
      if (!(await hasAudio(lessonId, sentenceId, id, realAudio))) continue;
      if (epoch !== speechEpoch) return;
      const folder = folderFor(id, realAudio);
      try {
        return await playFile(
          `./content/audio/${folder}/${lessonId}/${sentenceId}.mp3`,
          rate,
        );
      } catch {
        if (epoch !== speechEpoch) return;
        /* try the next voice, then fall through to TTS */
      }
    }
  }

  if (epoch !== speechEpoch) return;

  // A real recording has no synthetic stand-in worth substituting: reading a
  // transcript aloud in a robot voice is not the lesson the learner chose.
  if (realAudio) throw new Error("這課的真人錄音還沒下載");

  return speakTTS(text, { rate, langCode, voiceURI });
}

export function ttsSupported() {
  return !!synth;
}
