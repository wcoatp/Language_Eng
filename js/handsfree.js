/* Hands-free playback: lock-screen controls and keeping the screen awake.

   The 1000-hour goal is the reason this exists. Without a media session every
   one of those hours has to be spent looking at the screen with a thumb on the
   glass, which rules out the commute, the walk, and the washing-up — the hours
   a learner actually has. With one, the phone can be in a pocket and the
   headphone button still works.

   Both APIs are progressive: Safari has had MediaSession since 15, and the
   Wake Lock API is Chrome-and-Safari-17. Everything here is a no-op where the
   API is missing, so callers never need to feature-detect. */

const session = () => ("mediaSession" in navigator ? navigator.mediaSession : null);

export const mediaSessionSupported = () => !!session();
export const wakeLockSupported = () => "wakeLock" in navigator;

/* ---------- lock screen ---------- */

/**
 * Describe what is playing, for the lock screen and the car stereo.
 * @param {{title:string, lesson?:string, detail?:string}} meta
 */
export function setNowPlaying({ title, lesson = "Echo", detail = "" } = {}) {
  const s = session();
  if (!s || !("MediaMetadata" in window)) return;
  try {
    s.metadata = new window.MediaMetadata({
      title,
      artist: lesson,
      album: detail || "Echo 英語聽力訓練",
      artwork: [
        { src: "./icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "./icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
  } catch {
    /* metadata is decoration; never let it break playback */
  }
}

/**
 * Wire the hardware and lock-screen buttons.
 * Pass null for an action to disable that button.
 * @param {Record<string, (() => void)|null>} handlers
 */
export function setHandlers(handlers = {}) {
  const s = session();
  if (!s?.setActionHandler) return;
  for (const [action, fn] of Object.entries(handlers)) {
    try {
      s.setActionHandler(action, fn || null);
    } catch {
      /* the browser does not offer this button; the others still work */
    }
  }
}

/** 'playing' | 'paused' | 'none' — drives the lock-screen play/pause icon. */
export function setPlaybackState(state) {
  const s = session();
  if (!s) return;
  try {
    s.playbackState = state;
  } catch {
    /* ignore */
  }
}

export function clearNowPlaying() {
  const s = session();
  if (!s) return;
  setPlaybackState("none");
  try {
    s.metadata = null;
  } catch {
    /* ignore */
  }
  setHandlers({
    play: null, pause: null, stop: null,
    previoustrack: null, nexttrack: null,
  });
}

/* ---------- screen wake lock ---------- */

let lock = null;
let wanted = false;

/* The lock is dropped whenever the tab is hidden and is not restored on its
   own, so re-take it when the learner comes back rather than leaving the
   screen free to sleep mid-lesson. */
const onVisible = () => {
  if (wanted && !document.hidden) acquire();
};

async function acquire() {
  if (!wakeLockSupported() || lock) return;
  try {
    lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => { lock = null; });
  } catch {
    lock = null; // denied, or the battery is too low — not worth surfacing
  }
}

/** Keep the screen on. Safe to call repeatedly. */
export async function keepAwake() {
  if (wanted) return;
  wanted = true;
  document.addEventListener("visibilitychange", onVisible);
  await acquire();
}

export function releaseAwake() {
  wanted = false;
  document.removeEventListener("visibilitychange", onVisible);
  const held = lock;
  lock = null;
  held?.release?.().catch(() => {});
}

/** Is the screen currently being held awake? For the UI to report honestly. */
export const isAwake = () => !!lock;
