/* YouTube as a training surface.

   Nothing is downloaded. The official player is embedded and driven through the
   IFrame API, so the video is served by YouTube and its creator still gets the
   view. We only store the video id, a transcript and your progress.

   The catch is iOS: YouTube's docs say setPlaybackRate "does not guarantee that
   the playback rate will actually change", and on iOS it frequently does not.
   rateWorks() below reports the truth so the UI can say so plainly instead of
   pretending the slow-speed step happened. */

let apiReady = null;

/** Load the IFrame API once, lazily — it is only needed on this screen. */
export function loadApi() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    tag.onerror = () =>
      reject(new Error("無法載入 YouTube 播放器(可能被網路擋住)"));
    document.head.append(tag);
    setTimeout(() => reject(new Error("YouTube 播放器載入逾時")), 15000);
  });
  return apiReady;
}

/** Accepts a full URL in any of YouTube's shapes, or a bare id. */
export function parseVideoId(input) {
  const s = String(input || "").trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (/(^|\.)youtu\.be$/.test(u.hostname)) {
    const id = u.pathname.slice(1, 12);
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) {
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(embed|shorts|live|v)\/([\w-]{11})/);
    if (m) return m[2];
  }
  return null;
}

/**
 * Parse a transcript copied out of YouTube's own transcript panel.
 * Handles both "0:12\ntext" over two lines and "0:12 text" on one.
 * @returns {{start:number, text:string}[]}
 */
export function parseTranscript(raw) {
  const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/;
  const INLINE = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?\s+(.*)$/;

  const cues = [];
  let pending = null;

  for (const line of String(raw).split("\n")) {
    const t = line.trim();
    if (!t) continue;

    const inline = t.match(INLINE);
    const alone = t.match(TIME);

    if (alone) {
      // A bare timestamp: the text is on the next line.
      pending = toSeconds(alone);
      continue;
    }
    if (inline) {
      cues.push({ start: toSeconds(inline), text: inline[4].trim() });
      pending = null;
      continue;
    }
    if (pending != null) {
      cues.push({ start: pending, text: t });
      pending = null;
    } else if (cues.length) {
      // Continuation of the previous cue's text.
      cues[cues.length - 1].text += " " + t;
    }
  }

  return cues
    .map((c) => ({ ...c, text: c.text.replace(/\s+/g, " ").trim() }))
    .filter((c) => c.text && !/^\[.*\]$/.test(c.text));
}

const toSeconds = (m) =>
  Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);

/**
 * Group raw cues into sentence-ish segments with an end time.
 * YouTube cues are line-wrapped for display, not split by sentence.
 */
export function cuesToSegments(cues, videoDuration = Infinity) {
  const out = [];
  let buf = null;

  for (const [i, c] of cues.entries()) {
    /* A cue normally ends where the next one starts — but transcripts have gaps
       (silence, music, an untranscribed stretch), and inheriting the far side of
       a gap stretches one line across a minute of mostly nothing. Cap the end at
       how long the words could plausibly take to say. */
    const spoken =
      (c.text.split(/\s+/).filter(Boolean).length / 130) * 60 + 1.5;
    const nextStart = Math.min(
      cues[i + 1]?.start ?? videoDuration,
      c.start + spoken,
    );
    if (!buf) buf = { start: c.start, end: nextStart, text: c.text };
    else {
      buf.end = nextStart;
      buf.text = `${buf.text} ${c.text}`;
    }

    const ends = /[.!?]["')\]]?$/.test(buf.text);
    const long = buf.end - buf.start > 14;
    if (ends || long) {
      out.push(buf);
      buf = null;
    }
  }
  if (buf) out.push(buf);

  return out
    .map((s, i) => ({
      id: `s${i + 1}`,
      ...s,
      text: s.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((s) => s.text.split(" ").length >= 2);
}

/* ---------- player wrapper ---------- */

export class YtPlayer {
  constructor(player) {
    this.p = player;
    this.timer = null;
    this._rateWorks = null;
  }

  static async create(host, videoId, { onReady, onError } = {}) {
    const YT = await loadApi();
    return new Promise((resolve) => {
      const player = new YT.Player(host, {
        videoId,
        playerVars: {
          playsinline: 1, // required or iOS takes over with its own fullscreen player
          rel: 0,
          modestbranding: 1,
          controls: 1,
        },
        events: {
          onReady: () => {
            onReady?.();
            resolve(new YtPlayer(player));
          },
          onError: (e) => onError?.(e),
        },
      });
    });
  }

  /**
   * Does this device honour playback-rate changes?
   * Checked by asking for a rate and reading back what the player actually took.
   */
  rateWorks() {
    if (this._rateWorks != null) return this._rateWorks;
    try {
      const original = this.p.getPlaybackRate();
      const target = original === 0.75 ? 0.5 : 0.75;
      this.p.setPlaybackRate(target);
      const got = this.p.getPlaybackRate();
      this.p.setPlaybackRate(original);
      this._rateWorks = Math.abs(got - target) < 0.01;
    } catch {
      this._rateWorks = false;
    }
    return this._rateWorks;
  }

  availableRates() {
    try {
      return this.p.getAvailablePlaybackRates() || [1];
    } catch {
      return [1];
    }
  }

  /** Play one segment and resolve when it ends. */
  playSegment(start, end, rate = 1) {
    this.stop();
    return new Promise((resolve) => {
      try {
        this.p.setPlaybackRate(rate);
        this.p.seekTo(start, true);
        this.p.playVideo();
      } catch {
        return resolve();
      }
      // The API has no "play until" — poll and pause at the boundary.
      this.timer = setInterval(() => {
        let t;
        try {
          t = this.p.getCurrentTime();
        } catch {
          return (this.stop(), resolve());
        }
        if (t >= end) {
          this.stop();
          try {
            this.p.pauseVideo();
          } catch {}
          resolve();
        }
      }, 80);
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  pause() {
    this.stop();
    try {
      this.p.pauseVideo();
    } catch {
      /* ignore */
    }
  }

  duration() {
    try {
      return this.p.getDuration() || 0;
    } catch {
      return 0;
    }
  }

  destroy() {
    this.stop();
    try {
      this.p.destroy();
    } catch {
      /* ignore */
    }
  }
}
