/* Speech output. Hybrid: pre-generated audio when available, browser TTS otherwise.
   Both paths are free and work offline once cached. */

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
let current = null; // active HTMLAudioElement

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

/** Does a pre-generated clip exist for this sentence + accent? */
export async function hasAudio(lessonId, sentenceId, langCode) {
  const m = await getManifest();
  if (!m) return false;
  const list = m.lessons?.[lessonId]?.[accentShort(langCode)];
  return Array.isArray(list) && list.includes(sentenceId);
}

function stopAudio() {
  if (current) {
    current.pause();
    current.onended = current.onerror = null;
    current = null;
  }
}

function playFile(url, rate) {
  return new Promise((resolve, reject) => {
    stopAudio();
    const a = new Audio(url);
    a.playbackRate = rate;
    a.preservesPitch = true; // keep the voice natural when slowed
    a.mozPreservesPitch = true;
    a.webkitPreservesPitch = true;
    current = a;
    a.onended = () => {
      current = null;
      resolve();
    };
    a.onerror = () => {
      current = null;
      reject(new Error("audio failed"));
    };
    a.play().catch(reject);
  });
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
  const {
    lessonId,
    sentenceId,
    langCode = "en-US",
    rate = 1,
    voiceURI = "",
  } = opts;
  if (
    lessonId &&
    sentenceId &&
    (await hasAudio(lessonId, sentenceId, langCode))
  ) {
    const url = `./content/audio/${accentShort(langCode)}/${lessonId}/${sentenceId}.mp3`;
    try {
      return await playFile(url, rate);
    } catch {
      /* fall through to TTS */
    }
  }
  return speakTTS(text, { rate, langCode, voiceURI });
}

export function ttsSupported() {
  return !!synth;
}
