/* Service worker — offline-first app shell, network-first content.
   Bump the shared version file when shipping a release.

   Only the app shell is versioned. Lesson JSON and audio go in their own
   unversioned cache, because activate() deletes every cache it does not
   recognise: with content living in the versioned bucket, shipping a release
   wiped every clip the learner had already played, and a phone had to fetch
   them again over mobile data. */

importScripts("./js/version.js");

const VERSION = self.ECHO_VERSION.cache;
const APP_VERSION = self.ECHO_VERSION.app;
const CACHE = `echo-${VERSION}`;
const CONTENT_CACHE = "echo-content";
const OFFLINE_CACHE = "echo-offline";
const KEEP = [CACHE, CONTENT_CACHE, OFFLINE_CACHE];

const isContent = (pathname) => pathname.includes("/content/");

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/version.js",
  "./js/pwa-update.js",
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
  "./js/recall.js",
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

function versionMessage(type = "ECHO_VERSION") {
  return { type, version: APP_VERSION, cache: VERSION };
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "ECHO_GET_VERSION") {
    const target = event.ports && event.ports[0];
    if (target) target.postMessage(versionMessage());
    else if (event.source) event.source.postMessage(versionMessage());
  }
  if (data.type === "ECHO_SKIP_WAITING") self.skipWaiting();
});

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
async function precache(cache, url, required = false) {
  try {
    const res = await fetch(url, { cache: "reload" });
    if (!res.ok) throw new Error(`precache failed: ${url} (${res.status})`);
    await cache.put(url, res);
  } catch (error) {
    if (required) throw error;
    /* A missing optional daily lesson must not fail the app shell install. */
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Do not activate a partial release: every shell file is required.
      await Promise.all(SHELL.map((u) => precache(cache, u, true)));
      // Daily stories are small and should open offline before their first read.
      await cacheDailyLessons(await caches.open(CONTENT_CACHE));

      // v10 predates the actionable update manager. Without this one-time
      // bridge it can leave the new worker waiting forever because the old
      // page has no ECHO_SKIP_WAITING button. activate() immediately reloads
      // those legacy clients after the complete shell is ready.
      if ((await caches.keys()).includes("echo-v10")) self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const stale = (await caches.keys()).filter((k) => !KEEP.includes(k));
      const legacyUpgrade = stale.includes("echo-v10");

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

      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (legacyUpgrade) {
        await Promise.all(
          clients.map((client) =>
            typeof client.navigate === "function"
              ? client.navigate(client.url).catch(() => null)
              : null,
          ),
        );
      } else {
        clients.forEach((client) =>
          client.postMessage(versionMessage("ECHO_UPDATE_READY")),
        );
      }
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

  // App shell generations are immutable. Only a newly installed worker may
  // populate a new versioned cache; the active worker never mixes network
  // files from a later release into the page that is currently running.
  e.respondWith(
    (async () => {
      // Match this worker's exact shell generation. A newer worker may already
      // be waiting with its own cache, but it must not leak modules into the
      // still-running page until the learner accepts the update.
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req, { cache: "no-cache" });
        if (res) return res;
      } catch {
        /* fall through to the offline navigation shell */
      }
      // A navigation with nothing cached still needs a document.
      if (req.mode === "navigate") {
        const shell = await cache.match("./index.html");
        if (shell) return shell;
      }
      return new Response("offline", { status: 503, statusText: "offline" });
    })(),
  );
});
