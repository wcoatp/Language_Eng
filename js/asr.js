/* Speech recognition — browser-native, free, no API key.
   Chrome/Edge/Safari expose it as webkitSpeechRecognition. Firefox does not. */

const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;

export const asrSupported = () => !!Impl;

/**
 * Listen once and resolve with the transcript.
 * @returns {{promise: Promise<string>, stop: () => void, abort: () => void}}
 */
export function listen({ lang = 'en-US', interim, continuous = false } = {}) {
  if (!Impl) {
    return {
      promise: Promise.reject(new Error('unsupported')),
      stop() {}, abort() {},
    };
  }

  const rec = new Impl();
  rec.lang = lang;
  rec.continuous = continuous;
  rec.interimResults = !!interim;
  rec.maxAlternatives = 1;

  let finalText = '';
  let settled = false;

  const promise = new Promise((resolve, reject) => {
    rec.onresult = e => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else live += r[0].transcript;
      }
      interim?.(finalText + live);
    };
    rec.onerror = e => {
      if (settled) return;
      settled = true;
      // "no-speech"/"aborted" are normal outcomes, not failures worth shouting about.
      if (e.error === 'no-speech' || e.error === 'aborted') resolve(finalText.trim());
      else reject(new Error(e.error || 'asr failed'));
    };
    rec.onend = () => {
      if (settled) return;
      settled = true;
      resolve(finalText.trim());
    };
  });

  try { rec.start(); } catch { /* already started */ }

  return {
    promise,
    stop() { try { rec.stop(); } catch { /* ignore */ } },
    abort() { settled = true; try { rec.abort(); } catch { /* ignore */ } },
  };
}

/* ---------- scoring a shadowing attempt ---------- */

const normalise = s => s.toLowerCase()
  .replace(/[^a-z0-9'\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Word-level edit distance, used to score how close a read-back was. */
function distance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  const cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur.slice();
  }
  return prev[n];
}

/**
 * Compare a transcript against the target sentence.
 * Recognition is imperfect, so treat this as a nudge, not a verdict.
 * @returns {{score: number, words: {w: string, ok: boolean}[]}}
 */
export function scoreAttempt(target, heard) {
  const t = normalise(target).split(' ').filter(Boolean);
  const h = normalise(heard).split(' ').filter(Boolean);
  if (!t.length) return { score: 0, words: [] };

  const score = Math.max(0, Math.round((1 - distance(t, h) / t.length) * 100));
  const heardSet = new Set(h);
  return { score, words: t.map(w => ({ w, ok: heardSet.has(w) })) };
}
