/* Offline audio and storage budget.

   Real-recording lessons are much heavier than synthetic ones, so the app never
   pre-downloads everything. Clips arrive as you play them, and you can pin a
   lesson for offline use deliberately. */

import { clipUrls } from './tts.js';

/* A cache of its own, so clearing downloads never touches the app shell.
   sw.js falls back to caches.match(), which searches every cache in the
   origin, so anything stored here is served when the network is gone. */
const OFFLINE_CACHE = 'echo-offline';

export const cacheSupported = () => 'caches' in self;

/* ---------- quota ---------- */

export async function estimate() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota, pct: quota ? (usage / quota) * 100 : 0 };
}

export async function isPersisted() {
  return navigator.storage?.persisted ? navigator.storage.persisted() : false;
}

/**
 * Ask the browser not to evict our data under pressure.
 * Chrome grants it silently for installed apps; Safari ignores it, which is
 * why the home-screen prompt below matters more on iOS than this call does.
 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function fmtBytes(n) {
  if (!n) return '0 MB';
  const mb = n / 1048576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/* ---------- per-lesson offline ---------- */

async function urlsFor(lesson, langCode) {
  return clipUrls(lesson.id, langCode, !!lesson.realAudio);
}

/** Are all of this lesson's clips already stored? */
export async function isLessonOffline(lesson, langCode) {
  if (!cacheSupported()) return false;
  const urls = await urlsFor(lesson, langCode);
  if (!urls.length) return false;
  const cache = await caches.open(OFFLINE_CACHE);
  // Checking every clip is slow for long lessons; the ends are enough to tell
  // a completed download from an interrupted one.
  const probes = urls.length <= 4 ? urls : [urls[0], urls[urls.length >> 1], urls.at(-1)];
  for (const u of probes) {
    if (!(await cache.match(u))) return false;
  }
  return true;
}

/**
 * Store every clip of a lesson for offline use.
 * @param {(done:number,total:number)=>void} [onProgress]
 */
export async function downloadLesson(lesson, langCode, onProgress) {
  if (!cacheSupported()) throw new Error('這個瀏覽器不支援離線儲存');
  const urls = await urlsFor(lesson, langCode);
  if (!urls.length) throw new Error('這課沒有可下載的音檔');

  const cache = await caches.open(OFFLINE_CACHE);
  let done = 0;

  // A few at a time: enough to be quick, not so many that a phone on mobile
  // data stalls every other request in the app.
  const LANES = 4;
  const queue = [...urls];
  await Promise.all(Array.from({ length: Math.min(LANES, queue.length) }, async () => {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      if (!(await cache.match(url))) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`下載失敗 (${res.status})`);
        await cache.put(url, res);
      }
      onProgress?.(++done, urls.length);
    }
  }));

  return urls.length;
}

export async function removeLesson(lesson, langCode) {
  if (!cacheSupported()) return 0;
  const urls = await urlsFor(lesson, langCode);
  const cache = await caches.open(OFFLINE_CACHE);
  let n = 0;
  for (const u of urls) if (await cache.delete(u)) n++;
  return n;
}

export async function offlineSize() {
  if (!cacheSupported()) return { count: 0, bytes: 0 };
  const cache = await caches.open(OFFLINE_CACHE);
  const keys = await cache.keys();
  let bytes = 0;
  for (const k of keys) {
    const res = await cache.match(k);
    const len = res?.headers.get('content-length');
    if (len) bytes += Number(len);
    else if (res) bytes += (await res.clone().blob()).size;
  }
  return { count: keys.length, bytes };
}

export async function clearOffline() {
  if (!cacheSupported()) return;
  await caches.delete(OFFLINE_CACHE);
}

/* ---------- iOS eviction ---------- */

export const isIos = () =>
  /iP(hone|ad|od)/.test(navigator.platform || '') ||
  (/Mac/.test(navigator.platform || '') && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.navigator.standalone === true ||
  window.matchMedia?.('(display-mode: standalone)').matches === true;

/**
 * On iOS, script-writable storage for a *website* is wiped after seven days
 * without interaction. Web apps launched from the home screen are exempt and
 * keep their own counter — so on iOS, installing is what protects the data,
 * not a nicety. Chrome and Android have no such rule.
 */
export const needsHomeScreenPrompt = () => isIos() && !isStandalone();
