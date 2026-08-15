/* Settings + practice-time accounting. */

import { db, kvGet, kvSet } from "./db.js";

export const DEFAULTS = {
  accent: "", // device voice URI, used only for the browser fallback
  accentLang: "en-US", // accent; also the speech-recognition language
  voice: "auto", // a voice id from js/voices.js, or 'auto' to follow level
  slowRate: 0.7,
  normalRate: 1.0,
  showZh: true,
  autoAdvance: true,
  dailyGoalMin: 20,
  // Conversation (Phase 3) — key never leaves this device.
  provider: "anthropic",
  apiKey: "",
  model: "",
  baseUrl: "",
  talkLevel: 3,
  corrections: true,
};

let cache = null;

export async function settings() {
  if (!cache) cache = { ...DEFAULTS, ...(await kvGet("settings", {})) };
  return cache;
}

export async function setSetting(patch) {
  const s = await settings();
  cache = { ...s, ...patch };
  await kvSet("settings", cache);
  return cache;
}

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Log practice seconds. This is the app's core metric — the "1000 hours" counter.
 * Rounded up to whole seconds; sub-second slivers are dropped.
 */
export async function logTime(seconds, mode = "listen", lessonId = null) {
  const s = Math.round(seconds);
  if (s < 1) return;
  await db.put("sessions", {
    day: todayKey(),
    seconds: s,
    mode,
    lessonId,
    at: Date.now(),
  });
}

/* Bank practice time at least this often. The counter is the one number the
   whole app is built around, and it is not reconstructible after the fact. */
const FLUSH_MS = 120_000;

/**
 * A running stopwatch that logs practice time. Ignores time while the tab is
 * hidden, and banks what it has whenever the app goes away — closing the tab
 * never calls stop(), and iOS terminates backgrounded web apps without notice,
 * so waiting until the end of the lesson used to throw the session away.
 */
export function stopwatch(mode, lessonId) {
  let unbanked = 0; // ms measured but not yet written
  let total = 0; // ms this session, for the summary screen
  let start = document.hidden ? 0 : performance.now();

  const gather = () => {
    if (!start) return;
    const ms = performance.now() - start;
    unbanked += ms;
    total += ms;
    start = 0;
  };

  const flush = async () => {
    const running = !!start;
    gather();
    const secs = unbanked / 1000;
    unbanked = 0;
    if (running && !document.hidden) start = performance.now();
    if (secs >= 1) await logTime(secs, mode, lessonId);
  };

  const onVis = () => {
    if (document.hidden) flush();
    else if (!start) start = performance.now();
  };
  const timer = setInterval(flush, FLUSH_MS);
  document.addEventListener("visibilitychange", onVis);
  // Desktop browsers close without ever hiding the page first.
  window.addEventListener("pagehide", flush);

  return {
    async stop() {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
      await flush();
      return total / 1000;
    },
  };
}

export async function stats() {
  const rows = await db.all("sessions");
  const byDay = new Map();
  let total = 0;
  for (const r of rows) {
    total += r.seconds;
    byDay.set(r.day, (byDay.get(r.day) || 0) + r.seconds);
  }

  const today = byDay.get(todayKey()) || 0;

  // Streak: consecutive days ending today (or yesterday, if today is untouched).
  let streak = 0;
  const d = new Date();
  if (!byDay.get(todayKey(d))) d.setDate(d.getDate() - 1);
  for (;;) {
    if (!byDay.get(todayKey(d))) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }

  return {
    totalSeconds: total,
    todaySeconds: today,
    streak,
    days: byDay.size,
    byDay,
  };
}

export function fmtDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h && m) return `${h} 小時 ${m} 分`;
  if (h) return `${h} 小時`;
  return `${m} 分`;
}
