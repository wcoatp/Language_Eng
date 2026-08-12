/* Service worker — offline-first app shell, network-first content.
   Bump CACHE when shipping a release so clients pick up new files. */

const CACHE = 'echo-v3';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/ui.js',
  './js/db.js',
  './js/store.js',
  './js/tts.js',
  './js/asr.js',
  './js/recorder.js',
  './js/srs.js',
  './js/content.js',
  './js/difficulty.js',
  './js/storage.js',
  './js/pack.js',
  './js/youtube.js',
  './js/llm.js',
  './js/views/home.js',
  './js/views/library.js',
  './js/views/lesson.js',
  './js/views/listen.js',
  './js/views/review.js',
  './js/views/talk.js',
  './js/views/import.js',
  './js/views/yt.js',
  './js/views/settings.js',
  './js/views/progress.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Fetch individually so one missing file cannot fail the whole install.
    await Promise.all(SHELL.map(u => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never touch API traffic or anything cross-origin.
  if (url.origin !== self.location.origin) return;

  // Lesson JSON and audio: prefer the network, fall back to cache when offline.
  if (url.pathname.includes('/content/')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
        return res;
      } catch {
        const hit = await caches.match(req);
        if (hit) return hit;
        throw new Error('offline');
      }
    })());
    return;
  }

  // App shell: serve from cache, refresh in the background.
  e.respondWith((async () => {
    const hit = await caches.match(req);
    const net = fetch(req).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => null);

    if (hit) return hit;
    const res = await net;
    if (res) return res;
    // A navigation with nothing cached still needs a document.
    if (req.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    return new Response('offline', { status: 503, statusText: 'offline' });
  })());
});
