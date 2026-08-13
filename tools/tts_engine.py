#!/usr/bin/env python3
"""Render clips with a neural TTS engine. Driven by tools/generate-voices.mjs.

Reads one JSON job spec on stdin and writes an mp3 per sentence:

    {"engine": "kokoro",
     "voices": {"A": "af_heart", "B": "am_michael"},
     "reference": {"B": "path/to/clip.mp3"},        # chatterbox only
     "jobs": [{"text": "...", "speaker": "A", "out": "path.mp3"}]}

Prints one line of progress per clip so the caller can report as it goes.
"""

import json, subprocess, sys, tempfile
from pathlib import Path


def to_mp3(samples, rate, out):
    """Write float32 audio straight to mp3 at the same settings as the rest of
    the library, so no lesson sounds louder or thinner than its neighbours."""
    import numpy as np, wave
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    data = np.clip(np.asarray(samples, dtype="float32"), -1.0, 1.0)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        with wave.open(tmp.name, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(int(rate))
            w.writeframes((data * 32767).astype("<i2").tobytes())
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name,
             "-ac", "1", "-ar", "24000", "-b:a", "48k", "-c:a", "libmp3lame", str(out)],
            check=True)
    Path(tmp.name).unlink(missing_ok=True)


def trim(samples, rate, threshold=0.012, pad=0.06):
    """Drop leading and trailing near-silence.

    Neural TTS pads its output unevenly; left alone, one clip starts instantly
    and the next has half a second of dead air, which is jarring when the
    trainer plays them one after another.
    """
    import numpy as np
    a = np.asarray(samples, dtype="float32")
    loud = np.where(np.abs(a) > threshold)[0]
    if loud.size == 0:
        return a
    pad_n = int(pad * rate)
    return a[max(0, loud[0] - pad_n): min(len(a), loud[-1] + pad_n)]


def run_kokoro(spec):
    from kokoro import KPipeline
    import numpy as np

    lang = spec.get("lang_code", "a")
    pipe = KPipeline(lang_code=lang)
    default = spec["voices"].get("A")

    for i, job in enumerate(spec["jobs"], 1):
        voice = spec["voices"].get(job.get("speaker"), default)
        blocks = [b for _, _, b in pipe(job["text"], voice=voice, speed=1.0)]
        if not blocks:
            print(f"SKIP {job['out']}", flush=True)
            continue
        audio = np.concatenate([np.asarray(b, dtype="float32") for b in blocks])
        to_mp3(trim(audio, 24000), 24000, job["out"])
        print(f"OK {i}", flush=True)


def run_chatterbox(spec):
    import torch
    from chatterbox.tts import ChatterboxTTS

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = ChatterboxTTS.from_pretrained(device=device)
    refs = spec.get("reference", {})

    for i, job in enumerate(spec["jobs"], 1):
        # Chatterbox is a single-voice model. To keep two speakers apart in a
        # dialogue we hand it a short reference clip for the second speaker and
        # let it carry that timbre; without one, both roles sound identical.
        ref = refs.get(job.get("speaker"))
        kwargs = {"exaggeration": 0.35, "cfg_weight": 0.5}
        if ref and Path(ref).exists():
            kwargs["audio_prompt_path"] = ref
        wav = model.generate(job["text"], **kwargs)
        audio = wav.squeeze().detach().cpu().numpy().astype("float32")
        to_mp3(trim(audio, model.sr), model.sr, job["out"])
        print(f"OK {i}", flush=True)


def main():
    spec = json.load(sys.stdin)
    engine = spec["engine"]
    if engine == "kokoro":
        run_kokoro(spec)
    elif engine == "chatterbox":
        run_chatterbox(spec)
    else:
        sys.exit(f"unknown engine: {engine}")
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
