#!/usr/bin/env python3
"""Generate one dialogue lesson with every available TTS engine, for listening tests.

The point is not benchmark numbers — it is to put the same script through each
engine so you can pick with your ears. Every engine renders the WHOLE dialogue
in one file, because turn-taking and intonation carry-over between lines are
exactly what separates "two people talking" from "someone reading a list".

Target style is natural but clear: conversational rhythm and intonation, no
laughter or hesitation. A beginner needs to catch every word.

    .venv-tts/bin/python tools/tts_bakeoff.py --lesson l1-02
    .venv-tts/bin/python tools/tts_bakeoff.py --lesson l1-02 --engines kokoro,dia

Output: bakeoff/<engine>.wav plus bakeoff/index.html to A/B them.
"""

import argparse, json, os, subprocess, sys, time, wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "bakeoff"
SAMPLE_RATE = 24000

# A beat between turns, so speakers do not run into each other.
TURN_GAP = 0.35


def load_lesson(lesson_id):
    p = ROOT / "content" / "lessons" / f"{lesson_id}.json"
    if not p.exists():
        sys.exit(f"lesson not found: {p}")
    return json.loads(p.read_text())


def write_wav(path, samples, rate=SAMPLE_RATE):
    """Write float32 [-1,1] samples as 16-bit PCM without pulling in scipy."""
    import numpy as np
    data = np.clip(np.asarray(samples, dtype="float32"), -1.0, 1.0)
    pcm = (data * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def silence(seconds, rate=SAMPLE_RATE):
    import numpy as np
    return np.zeros(int(seconds * rate), dtype="float32")


# --------------------------------------------------------------------------
# engines: each returns (float32 samples, sample_rate) for the whole dialogue
# --------------------------------------------------------------------------

def gen_kokoro(lesson, speakers):
    """Kokoro renders per sentence; we stitch turns together ourselves."""
    import numpy as np
    from kokoro import KPipeline

    # Two clearly distinct American voices, one per speaker.
    voices = {speakers[0]: "af_heart", speakers[1]: "am_michael"}
    pipe = KPipeline(lang_code="a")

    chunks = []
    for s in lesson["sentences"]:
        voice = voices.get(s.get("speaker"), "af_heart")
        audio = []
        for _, _, block in pipe(s["text"], voice=voice, speed=1.0):
            audio.append(block)
        if audio:
            chunks.append(np.concatenate(audio))
            chunks.append(silence(TURN_GAP))
    return np.concatenate(chunks), 24000


def gen_chatterbox(lesson, speakers):
    """Chatterbox with exaggeration held low — clarity over drama."""
    import numpy as np, torch
    from chatterbox.tts import ChatterboxTTS

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = ChatterboxTTS.from_pretrained(device=device)

    chunks = []
    for s in lesson["sentences"]:
        wav = model.generate(
            s["text"],
            exaggeration=0.35,   # low: natural delivery, not theatrical
            cfg_weight=0.5,
        )
        chunks.append(wav.squeeze().detach().cpu().numpy().astype("float32"))
        chunks.append(silence(TURN_GAP, model.sr))
    return np.concatenate(chunks), model.sr


def gen_dia(lesson, speakers):
    """Dia is dialogue-native: the whole conversation goes in as one script."""
    import numpy as np, torch
    from dia.model import Dia

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    # The original Dia-1.6B checkpoint ships the pre-0.2 config schema and no
    # longer loads with current code; -0626 is the same model re-published with
    # the encoder_config/decoder_config layout the library now expects.
    model = Dia.from_pretrained("nari-labs/Dia-1.6B-0626", device=device)

    # [S1]/[S2] mark the turns. No (laughs) or (sighs): we want clear, not chatty.
    lines = []
    for s in lesson["sentences"]:
        tag = "[S1]" if s.get("speaker") == speakers[0] else "[S2]"
        lines.append(f"{tag} {s['text']}")
    script = " ".join(lines)

    audio = model.generate(script, use_torch_compile=False, verbose=False)
    return np.asarray(audio, dtype="float32"), 44100


def gen_edge(lesson, speakers):
    """The engine currently shipping, as the control."""
    import numpy as np, soundfile as sf
    voices = {speakers[0]: "en-US-AriaNeural", speakers[1]: "en-US-GuyNeural"}
    edge = ROOT / ".venv" / "bin" / "edge-tts"
    if not edge.exists():
        raise RuntimeError("edge-tts not installed in .venv")

    tmp = OUT / "_edge_tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    chunks = []
    for i, s in enumerate(lesson["sentences"]):
        mp3 = tmp / f"{i}.mp3"
        wav = tmp / f"{i}.wav"
        subprocess.run([str(edge), "--voice", voices.get(s.get("speaker"), voices[speakers[0]]),
                        "--text", s["text"], "--write-media", str(mp3)],
                       check=True, capture_output=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp3),
                        "-ar", str(SAMPLE_RATE), "-ac", "1", str(wav)], check=True)
        data, _ = sf.read(str(wav), dtype="float32")
        chunks.append(data)
        chunks.append(silence(TURN_GAP))
    return np.concatenate(chunks), SAMPLE_RATE


ENGINES = {
    "edge": ("edge-tts (目前使用中)", gen_edge),
    "kokoro": ("Kokoro-82M", gen_kokoro),
    "chatterbox": ("Chatterbox", gen_chatterbox),
    "dia": ("Dia 1.6B (對話原生)", gen_dia),
}


# --------------------------------------------------------------------------
# verification: generated audio must actually say the script
# --------------------------------------------------------------------------

def verify(wav_path, lesson):
    """Transcribe the result and score it against the script.

    Generative TTS can drop or reword text. The app compares a learner's
    shadowing against the written sentence, so audio that does not match the
    script is worse than a flat voice that does.
    """
    model = ROOT / "models" / "ggml-large-v3-turbo.bin"
    if not model.exists():
        return None
    pcm = wav_path.with_suffix(".16k.wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path),
                    "-ar", "16000", "-ac", "1", str(pcm)], check=True)
    base = wav_path.with_suffix("")
    subprocess.run(["whisper-cli", "-m", str(model), "-f", str(pcm), "-l", "en",
                    "-oj", "-of", str(base), "-nt"],
                   check=True, capture_output=True)
    doc = json.loads(Path(f"{base}.json").read_text())
    heard = " ".join(t["text"] for t in doc.get("transcription", []))
    pcm.unlink(missing_ok=True)

    def norm(t):
        return [w for w in "".join(c.lower() if (c.isalnum() or c.isspace()) else " "
                                   for c in t).split() if w]

    want, got = norm(" ".join(s["text"] for s in lesson["sentences"])), norm(heard)
    # Word-level edit distance, same measure the app uses for shadowing.
    prev = list(range(len(got) + 1))
    for i, a in enumerate(want, 1):
        cur = [i]
        for j, b in enumerate(got, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a != b)))
        prev = cur
    accuracy = max(0.0, 1 - prev[-1] / max(1, len(want)))
    return {"accuracy": round(accuracy * 100, 1), "words_expected": len(want), "words_heard": len(got)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lesson", default="l1-02")
    ap.add_argument("--engines", default=",".join(ENGINES))
    ap.add_argument("--skip-verify", action="store_true")
    args = ap.parse_args()

    lesson = load_lesson(args.lesson)
    speakers = list(dict.fromkeys(s.get("speaker") for s in lesson["sentences"] if s.get("speaker")))
    if len(speakers) < 2:
        speakers = (speakers + ["A", "B"])[:2]

    OUT.mkdir(parents=True, exist_ok=True)
    results = []

    for name in [e.strip() for e in args.engines.split(",") if e.strip()]:
        if name not in ENGINES:
            print(f"unknown engine {name}, skipping")
            continue
        label, fn = ENGINES[name]
        print(f"\n=== {label} ===")
        started = time.time()
        try:
            samples, rate = fn(lesson, speakers)
        except Exception as e:
            print(f"  unavailable: {type(e).__name__}: {str(e)[:160]}")
            results.append({"engine": name, "label": label, "error": str(e)[:200]})
            continue

        path = OUT / f"{name}.wav"
        write_wav(path, samples, rate)
        took = time.time() - started
        seconds = len(samples) / rate
        row = {
            "engine": name, "label": label, "file": path.name,
            "seconds": round(seconds, 1), "generated_in": round(took, 1),
            "realtime_x": round(seconds / took, 1) if took else None,
        }
        if not args.skip_verify:
            row["verify"] = verify(path, lesson)
        print(f"  {seconds:.1f}s audio in {took:.1f}s"
              + (f"  |  script accuracy {row['verify']['accuracy']}%" if row.get("verify") else ""))
        results.append(row)

    (OUT / "results.json").write_text(json.dumps(
        {"lesson": lesson["id"], "title": lesson["title"], "results": results}, indent=2))
    build_page(lesson, results)
    print(f"\nopen bakeoff/index.html to compare")


def build_page(lesson, results):
    rows = []
    for r in results:
        if r.get("error"):
            rows.append(f"""<div class="card"><h2>{r['label']}</h2>
              <p class="bad">無法執行:{r['error']}</p></div>""")
            continue
        v = r.get("verify")
        acc = ""
        if v:
            tone = "good" if v["accuracy"] >= 97 else "warn" if v["accuracy"] >= 90 else "bad"
            acc = (f'<p class="{tone}">腳本吻合度 {v["accuracy"]}% '
                   f'<span class="dim">({v["words_heard"]}/{v["words_expected"]} 字)</span></p>')
        rows.append(f"""<div class="card">
          <h2>{r['label']}</h2>
          <audio controls preload="none" src="{r['file']}"></audio>
          <p class="dim">{r['seconds']}s 音檔 · 生成花了 {r['generated_in']}s
             ({r['realtime_x']}x 即時)</p>
          {acc}
        </div>""")

    script = "".join(
        f'<p><b>{s.get("speaker","")}</b> {s["text"]}</p>' for s in lesson["sentences"])

    (OUT / "index.html").write_text(f"""<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<title>TTS 試聽比較 — {lesson['title']}</title>
<style>
 body {{ font-family: -apple-system, "PingFang TC", sans-serif; max-width: 780px;
        margin: 40px auto; padding: 0 20px; background:#0f1115; color:#e8eaef; line-height:1.6 }}
 h1 {{ letter-spacing:-.02em }}
 .card {{ background:#171a21; border:1px solid #2a2f3a; border-radius:14px;
          padding:18px; margin-bottom:14px }}
 h2 {{ font-size:17px; margin:0 0 10px }}
 audio {{ width:100% }}
 .dim {{ color:#6b7383; font-size:13px; margin:8px 0 0 }}
 .good {{ color:#4ade80; font-size:13px; margin:6px 0 0 }}
 .warn {{ color:#fbbf24; font-size:13px; margin:6px 0 0 }}
 .bad  {{ color:#f87171; font-size:13px; margin:6px 0 0 }}
 details {{ margin-top:26px; color:#9aa2b1 }}
 details p {{ margin:4px 0 }}
</style></head><body>
<h1>TTS 試聽比較</h1>
<p class="dim">課程:{lesson['title']} · 目標風格:自然但清晰(不加笑聲與猶豫)</p>
<p class="dim">用耳朵挑:哪一個聽起來像兩個人在講話,而不是有人在唸稿?
   「腳本吻合度」是把生成的音檔丟回 Whisper 轉錄,跟原稿比對的結果 —— 低於 97% 表示模型改了字,
   跟讀比對會對不上。</p>
{''.join(rows)}
<details><summary>對照原稿</summary>{script}</details>
</body></html>""")


if __name__ == "__main__":
    main()
