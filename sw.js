/* Service worker — offline-first app shell, network-first content.
   Bump CACHE when shipping a release so clients pick up new files.

   Only the app shell is versioned. Lesson JSON and audio go in their own
   unversioned cache, because activate() deletes every cache it does not
   recognise: with content living in the versioned bucket, shipping a release
   wiped every clip the learner had already played, and a phone had to fetch
   them again over mobile data. */

const CACHE = "echo-v9";
const CONTENT_CACHE = "echo-content";
const OFFLINE_CACHE = "echo-offline";
const KEEP = [CACHE, CONTENT_CACHE, OFFLINE_CACHE];

const isContent = (pathname) => pathname.includes("/content/");

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/app.js",
  "./js/ui.js",
  "./js/db.js",
  "./js/store.js",
  "./js/tts.js",
  "./js/asr.js",
  "./js/recorder.js",
  "./js/srs.js",
  "./js/content.js",
  "./js/difficulty.js",
  "./js/storage.js",
  "./js/pack.js",
  "./js/youtube.js",
  "./js/voices.js",
  "./js/llm.js",
  "./js/playback.js",
  "./js/handsfree.js",
  "./js/daily.js",
  "./js/views/home.js",
  "./js/views/daily.js",
  "./js/views/library.js",
  "./js/views/lesson.js",
  "./js/views/listen.js",
  "./js/views/player.js",
  "./js/views/review.js",
  "./js/views/talk.js",
  "./js/views/import.js",
  "./js/views/yt.js",
  "./js/views/settings.js",
  "./js/views/progress.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

async function cacheDailyLessons(cache) {
  try {
    const response = await fetch("./content/index.json", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.clone().json();
    await cache.put("./content/index.json", response);
    const urls = (data.lessons || [])
      .filter((lesson) => lesson.daily)
      .map(
        (lesson) => `./content/lessons/${encodeURIComponent(lesson.id)}.json`,
      );
    await Promise.all(urls.map((url) => precache(cache, url)));
  } catch {
    /* daily lessons remain network-available if precaching fails */
  }
}

/* cache.add() fetches through the HTTP cache, and hosting serves the app's
   JavaScript with max-age=3600. That quietly defeated the whole versioning
   scheme: bumping CACHE built the new cache out of the previous release's
   files, so a deploy took an hour to reach anyone and could leave a client
   running a mix of old and new modules until the version was bumped again.
   Going around the HTTP cache on install is what makes a bump mean something. */
async function precache(cache, url) {
  try {
    const res = await fetch(url, { cache: "reload" });
    if (res.ok) await cache.put(url, res);
  } catch {
    /* one missing file must not fail the whole install */
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(SHELL.map((u) => precache(cache, u)));
      // Daily stories are small and should open offline before their first read.
      await cacheDailyLessons(await caches.open(CONTENT_CACHE));
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const stale = (await caches.keys()).filter((k) => !KEEP.includes(k));

      // Earlier versions kept lesson audio in the versioned bucket. Rescue it
      // on the way past, so this is the last release that costs a re-download.
      const content = await caches.open(CONTENT_CACHE);
      for (const key of stale) {
        const old = await caches.open(key);
        for (const req of await old.keys()) {
          if (!isContent(new URL(req.url).pathname)) continue;
          if (await content.match(req)) continue;
          const hit = await old.match(req);
          if (hit) await content.put(req, hit);
        }
      }

      // Keep pinned lessons and cached content; only retire old app shells.
      await Promise.all(stale.map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Never touch API traffic or anything cross-origin.
  if (url.origin !== self.location.origin) return;

  // Lesson JSON and audio: prefer the network, fall back to cache when offline.
  if (isContent(url.pathname)) {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) (await caches.open(CONTENT_CACHE)).put(req, res.clone());
          return res;
        } catch {
          const hit = await caches.match(req);
          if (hit) return hit;
          throw new Error("offline");
        }
      })(),
    );
    return;
  }

  // App shell: serve from cache, refresh in the background.
  e.respondWith(
    (async () => {
      const hit = await caches.match(req);
      const net = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => null);

      if (hit) return hit;
      const res = await net;
      if (res) return res;
      // A navigation with nothing cached still needs a document.
      if (req.mode === "navigate") {
        const shell = await caches.match("./index.html");
        if (shell) return shell;
      }
      return new Response("offline", { status: 503, statusText: "offline" });
    })(),
  );
});
