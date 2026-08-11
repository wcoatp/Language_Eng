/* Settings + practice-time accounting. */

import { db, kvGet, kvSet } from './db.js';

export const DEFAULTS = {
  accent: '',            // preferred voice URI; '' = auto-pick for accentLang
  accentLang: 'en-US',
  slowRate: 0.7,
  normalRate: 1.0,
  showZh: true,
  autoAdvance: true,
  dailyGoalMin: 20,
  // Conversation (Phase 3) — key never leaves this device.
  provider: 'anthropic',
  apiKey: '',
  model: '',
  baseUrl: '',
  talkLevel: 3,
  corrections: true,
};

let cache = null;

export async function settings() {
  if (!cache) cache = { ...DEFAULTS, ...(await kvGet('settings', {})) };
  return cache;
}

export async function setSetting(patch) {
  const s = await settings();
  cache = { ...s, ...patch };
  await kvSet('settings', cache);
  return cache;
}

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Log practice seconds. This is the app's core metric — the "1000 hours" counter.
 * Rounded up to whole seconds; sub-second slivers are dropped.
 */
export async function logTime(seconds, mode = 'listen', lessonId = null) {
  const s = Math.round(seconds);
  if (s < 1) return;
  await db.put('sessions', { day: todayKey(), seconds: s, mode, lessonId, at: Date.now() });
}

/** A running stopwatch that logs on stop. Ignores time while the tab is hidden. */
export function stopwatch(mode, lessonId) {
  let acc = 0;
  let start = document.hidden ? 0 : performance.now();

  const onVis = () => {
    if (document.hidden) {
      if (start) { acc += performance.now() - start; start = 0; }
    } else if (!start) {
      start = performance.now();
    }
  };
  document.addEventListener('visibilitychange', onVis);

  return {
    async stop() {
      document.removeEventListener('visibilitychange', onVis);
      if (start) acc += performance.now() - start;
      await logTime(acc / 1000, mode, lessonId);
      return acc / 1000;
    },
  };
}

export async function stats() {
  const rows = await db.all('sessions');
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

  return { totalSeconds: total, todaySeconds: today, streak, days: byDay.size, byDay };
}

export function fmtDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h && m) return `${h} 小時 ${m} 分`;
  if (h) return `${h} 小時`;
  return `${m} 分`;
}
