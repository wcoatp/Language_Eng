/* Microphone capture for shadowing. Audio never leaves the device. */

let stream = null;

async function getStream() {
  if (stream && stream.active) return stream;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  return stream;
}

export const recorderSupported = () =>
  !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

function pickMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return types.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
}

/**
 * Start recording.
 * @returns {Promise<{stop: () => Promise<Blob>, cancel: () => void}>}
 */
export async function record() {
  const s = await getStream();
  const mime = pickMime();
  const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.start();

  return {
    stop() {
      return new Promise(resolve => {
        rec.onstop = () => resolve(new Blob(chunks, { type: mime || 'audio/webm' }));
        if (rec.state !== 'inactive') rec.stop();
        else resolve(new Blob(chunks, { type: mime || 'audio/webm' }));
      });
    },
    cancel() {
      try { if (rec.state !== 'inactive') rec.stop(); } catch { /* ignore */ }
    },
  };
}

/** Release the mic so the browser's recording indicator goes away. */
export function releaseMic() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
}

let playing = null;

export function playBlob(blob, rate = 1) {
  return new Promise((resolve, reject) => {
    stopPlayback();
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    a.playbackRate = rate;
    a.preservesPitch = true;
    playing = a;
    const cleanup = () => { URL.revokeObjectURL(url); playing = null; };
    a.onended = () => { cleanup(); resolve(); };
    a.onerror = () => { cleanup(); reject(new Error('playback failed')); };
    a.play().catch(e => { cleanup(); reject(e); });
  });
}

export function stopPlayback() {
  if (playing) {
    playing.pause();
    playing.onended = playing.onerror = null;
    playing = null;
  }
}
