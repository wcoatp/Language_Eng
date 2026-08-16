/* The training loop.

   Per sentence:  盲聽(原速) → 慢速 → 回原速 → 對答案 → 跟讀 → 評分
   The "back to normal speed" step is the point of the whole thing: it makes the
   ear map what it decoded slowly onto the real stream. */

import { el, toast, backButton, sleep, mount } from "../ui.js";
import { getLesson, wpmFor } from "../content.js";
import { voiceIdForLesson, byId } from "../voices.js";
import { speechRates } from "../playback.js";
import { keepAwake, releaseAwake } from "../handsfree.js";
import { openControls, closeControls, currentVoiceLabel } from "../controls.js";
import { rotateVoice } from "../voices.js";
import { voicesForLesson } from "../tts.js";
import { say, cancel as cancelSpeech, unlock } from "../tts.js";
import { settings } from "../store.js";
import { stopwatch } from "../store.js";
import { grade, getCard, gradePreview } from "../srs.js";
import {
  record,
  playBlob,
  stopPlayback,
  releaseMic,
  recorderSupported,
} from "../recorder.js";
import { listen as listenASR, asrSupported, scoreAttempt } from "../asr.js";

let ctx = null;

export function destroy() {
  if (!ctx) return;
  cancelSpeech();
  stopPlayback();
  releaseMic();
  ctx.rec?.cancel();
  ctx.asr?.abort();
  releaseAwake();
  closeControls();
  document.removeEventListener("keydown", ctx.onKey);
  ctx.watch?.stop();
  ctx = null;
}

export async function render(root, lessonId) {
  const [lesson, cfg] = await Promise.all([getLesson(lessonId), settings()]);

  ctx = {
    lesson,
    cfg,
    i: 0,
    stage: "blind",
    slowStep: 0,
    busy: false,
    attempt: null,
    blob: null,
    card: null,
    watch: stopwatch("listen", lesson.id),
    quiz: null,
    onKey: null,
    lessonWpm: medianWpm(lesson.sentences),
    voices: [],        // voice sets this lesson actually has, for 三種口音
    compareAt: 0,      // where the accent tour has got to
  };

  ctx.onKey = (e) => {
    // A target without matches() throws here and takes every shortcut with it.
    if (e.target?.matches?.("input, textarea")) return;
    if (e.code === "Space") {
      e.preventDefault();
      replay();
    }
    // Deliberately a skip rather than an advance: this used to call next()
    // straight out of 對答案, moving on without ever grading the sentence.
    if (e.code === "ArrowRight") {
      e.preventDefault();
      skip();
    }
  };
  document.addEventListener("keydown", ctx.onKey);
  voicesForLesson(lesson.id).then((v) => { if (ctx) { ctx.voices = v; paint(); } });
  // A lesson is minutes of listening with no taps; the screen must not sleep.
  keepAwake();

  mount(root, el("div", { class: "trainer", id: "trainer" }));
  paint();
  // Autoplay is blocked until the user has interacted; the tap that opened the
  // lesson counts, so this normally just works.
  play();
}

/* ---------- helpers ---------- */

const sentences = () => ctx.lesson.sentences;
const cur = () => sentences()[ctx.i];

/** Middle delivery speed of the sentences that carry a measured one. */
function medianWpm(rows = []) {
  const paces = rows
    .map((s) => s.wpm)
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (!paces.length) return 0;
  const mid = paces.length >> 1;
  return paces.length % 2 ? paces[mid] : (paces[mid - 1] + paces[mid]) / 2;
}

/* Rates for the sentence on screen. Both halves of this used to be wrong: the
   normal rate was scaled against a flat 150 wpm even though the engines render
   anywhere from 114 to 170, and the slow steps were multiplied on top of that
   already-reduced rate, so L1 played at 76 wpm and its slowest step reached 34
   — far under the pace where time-stretching stops helping. */
function rates() {
  const s = cur();
  const real = !!ctx.lesson.realAudio;
  return speechRates({
    targetWpm: wpmFor(ctx.lesson.level),
    // Looked up per call: the learner can change voice mid-lesson, and a
    // snapshot taken at render would keep scaling to the previous engine's
    // pace — a Kokoro rate applied to edge-tts plays 22% slow.
    sourceWpm:
      (real ? s?.wpm || ctx.lessonWpm : byId(voiceIdForLesson(ctx.cfg, ctx.lesson))?.wpm) ||
      150,
    normalRate: ctx.cfg.normalRate,
    slowRate: ctx.cfg.slowRate,
    rescale: !real,
  });
}

function slowSteps() {
  return rates().slow;
}

function currentRate() {
  const r = rates();
  if (ctx.stage !== "slow") return r.normal;
  return (r.slow[ctx.slowStep] || r.slow.at(-1) || { rate: r.normal }).rate;
}

async function play() {
  const s = cur();
  if (!s) return;
  unlock();
  cancelSpeech();
  setWave(true);
  try {
    await say(s.text, {
      lessonId: ctx.lesson.id,
      sentenceId: s.id,
      langCode: ctx.cfg.accentLang,
      voiceURI: ctx.cfg.accent,
      voiceId: voiceIdForLesson(ctx.cfg, ctx.lesson),
      rate: currentRate(),
      realAudio: !!ctx.lesson.realAudio,
      blob: s.audio || null,
    });
  } catch (e) {
    toast("播放失敗:" + (e.message || "瀏覽器沒有可用的語音"));
  }
  setWave(false);
}

function setWave(on) {
  document.getElementById("wave")?.classList.toggle("is-on", on);
}

function replay() {
  if (ctx && !ctx.busy) play();
}

/* ---------- listening controls ---------- */

function openSheet() {
  openControls({
    cfg: ctx.cfg,
    lesson: ctx.lesson,
    onChange: (next, changed) => {
      // setSetting returns a fresh object; keeping the old reference is how a
      // control ends up looking like it did nothing.
      ctx.cfg = next;
      paint();
      // Switching voice mid-sentence is only useful if you hear it on the
      // sentence you are on — waiting for the next one makes comparison
      // impossible, which is the whole point of switching.
      if (changed === "voice" && !ctx.busy && ctx.stage !== "compare") play();
    },
  });
}

function voiceChip() {
  return el("button", {
    class: "voice-chip",
    onclick: openSheet,
    title: "口音 · 聲音 · 語速",
  }, [
    el("span", { class: "voice-chip-dot" }),
    currentVoiceLabel(ctx.cfg, ctx.lesson),
  ]);
}

/* Play the same sentence through several voice sets, back to back.

   Placed after the answer is revealed on purpose: before that the job is to
   decode it once, and hearing three versions would just make the first pass
   easier rather than harder. Afterwards it is a stress test of the
   representation the learner has just built. Rotates through the sets this
   lesson actually has, so over weeks all eight accents get heard rather than
   the same three. Does not touch the learner's setting. */
async function accentTour() {
  if (!ctx || ctx.busy) return;
  const pool = ctx.voices;
  if (ctx.lesson.realAudio || pool.length < 2) {
    toast("這課只有一種聲音");
    return;
  }
  const s = cur();
  const token = s;
  ctx.busy = true;
  paint();
  for (let n = 0; n < 3; n++) {
    if (!ctx || cur() !== token) break;
    const id = rotateVoice(pool, ctx.compareAt + n);
    ctx.tourVoice = byId(id)?.label || id;
    paint();
    setWave(true);
    try {
      await say(s.text, {
        lessonId: ctx.lesson.id,
        sentenceId: s.id,
        langCode: ctx.cfg.accentLang,
        voiceURI: ctx.cfg.accent,
        voiceId: id,
        rate: rates().normal,
        realAudio: false,
        blob: s.audio || null,
      });
    } catch {
      break;
    }
    setWave(false);
    if (!ctx || cur() !== token) break;
    if (n < 2) await sleep(450);
  }
  if (!ctx) return;
  ctx.compareAt += 3;
  ctx.tourVoice = null;
  ctx.busy = false;
  paint();
}

/* ---------- stage transitions ---------- */

function goto(stage) {
  ctx.stage = stage;
  cancelSpeech();
  paint();
  if (stage === "blind" || stage === "slow" || stage === "again") play();
}

function harder() {
  const steps = slowSteps();
  if (!steps.length) {
    toast("這句已經是最慢了 — 再慢下去會聽不清楚");
    return;
  }
  if (ctx.stage !== "slow") {
    ctx.slowStep = 0;
    goto("slow");
    return;
  }
  if (ctx.slowStep < steps.length - 1) {
    ctx.slowStep++;
    paint();
    play();
  } else toast("已經是最慢了");
}

async function next() {
  if (!ctx || ctx.busy) return;
  cancelSpeech();
  stopPlayback();
  ctx.blob = null;
  ctx.attempt = null;
  ctx.slowStep = 0;
  ctx.card = null;

  if (ctx.i >= sentences().length - 1) {
    if (ctx.lesson.questions?.length) {
      ctx.stage = "quiz";
      ctx.quiz = { at: 0, picked: null, right: 0 };
      paint();
    } else finish();
    return;
  }
  ctx.i++;
  goto("blind");
}

async function scoreAndNext(g) {
  const s = cur();
  await grade(ctx.lesson.id, s.id, g, {
    text: s.text,
    level: ctx.lesson.level,
  });
  next();
}

/* Move on without touching the schedule. This used to grade 2 — the same score
   as 掌握了 — so tapping through a lesson silently filed every sentence in it
   as mastered and pushed the next review weeks out. A skip is not an answer. */
function skip() {
  if (!ctx || ctx.busy || ctx.stage === "quiz" || ctx.stage === "done") return;
  next();
}

async function finish() {
  const secs = await ctx.watch?.stop();
  ctx.watch = null;
  ctx.stage = "done";
  ctx.doneSeconds = secs || 0;
  paint();
}

/* ---------- shadowing ---------- */

async function startShadow() {
  if (!recorderSupported()) {
    toast("這個瀏覽器不支援錄音");
    return;
  }
  ctx.busy = true;
  ctx.blob = null;
  ctx.attempt = null;
  paint();

  try {
    ctx.rec = await record();
  } catch {
    // Without this the stage stays on 跟讀, whose only content is the label
    // 「準備麥克風…」 — no button, no way on, and the lesson is a dead end.
    ctx.busy = false;
    ctx.stage = "reveal";
    toast("沒有麥克風權限,可以先跳過這句");
    paint();
    return;
  }

  // Recognition runs alongside the recording so one take gives both a
  // playback for A/B comparison and a rough word-match score.
  if (asrSupported()) {
    ctx.asr = listenASR({ lang: ctx.cfg.accentLang });
    ctx.asr.promise.catch(() => "");
  }
  ctx.stage = "recording";
  paint();
}

async function stopShadow() {
  const rec = ctx.rec;
  const asr = ctx.asr;
  ctx.rec = null;
  ctx.asr = null;
  if (!rec) return;

  ctx.blob = await rec.stop();
  releaseMic();

  if (asr) {
    asr.stop();
    const heard = await Promise.race([
      asr.promise.catch(() => ""),
      sleep(2500).then(() => ""),
    ]);
    if (heard) ctx.attempt = scoreAttempt(cur().text, heard);
  }

  // Its existing schedule decides what each grade button is about to promise.
  ctx.card = await getCard(ctx.lesson.id, cur().id);

  ctx.busy = false;
  ctx.stage = "compare";
  paint();
}

async function playOriginal() {
  stopPlayback();
  await play();
}

async function playMine() {
  if (!ctx.blob) return;
  cancelSpeech();
  setWave(true);
  try {
    await playBlob(ctx.blob);
  } catch {
    toast("播放失敗");
  }
  setWave(false);
}

async function playBoth() {
  await playOriginal();
  await sleep(350);
  await playMine();
}

/* ---------- rendering ---------- */

function paint() {
  const host = document.getElementById("trainer");
  if (!host || !ctx) return;
  mount(
    host,
    header(),
    ctx.stage === "quiz"
      ? quizStage()
      : ctx.stage === "done"
        ? doneStage()
        : stage(),
    ctx.stage === "quiz" || ctx.stage === "done" ? "" : actions(),
  );
}

function header() {
  const total = sentences().length;
  const dots = el("div", { class: "step-dots" });
  for (let n = 0; n < total; n++) {
    dots.append(
      el("i", { class: n < ctx.i ? "done" : n === ctx.i ? "now" : "" }),
    );
  }
  return el("div", {}, [
    el("div", { class: "trainer-top" }, [
      backButton("結束", `#/lesson/${encodeURIComponent(ctx.lesson.id)}`),
      el("div", { class: "muted", style: "font-variant-numeric:tabular-nums" }, [
        `${Math.min(ctx.i + 1, total)} / ${total}`,
      ]),
      voiceChip(),
    ]),
    dots,
  ]);
}

const HINTS = {
  blind: "原速 · 先不看字",
  slow: "慢速 · 抓出每個字",
  again: "再回原速 · 把它接起來",
  reveal: "對答案",
  shadow: "跟讀",
  recording: "錄音中",
  compare: "比對",
};

function stage() {
  const s = cur();
  const hidden =
    ctx.stage === "blind" || ctx.stage === "slow" || ctx.stage === "again";
  const showZh = ctx.cfg.showZh && !hidden;

  const wave = el("div", { class: "wave", id: "wave" });
  for (let n = 0; n < 8; n++) wave.append(el("i"));

  return el("div", { class: "stage" }, [
    el("div", { class: "stage-hint", text: HINTS[ctx.stage] || "" }),
    s.speaker ? el("div", { class: "speaker-tag", text: s.speaker }) : null,
    el("p", { class: `sentence ${hidden ? "is-hidden" : ""}`, text: s.text }),
    showZh ? el("p", { class: "sentence-zh", text: s.zh || "" }) : null,
    !hidden && s.note
      ? el("div", { class: "sentence-note", text: s.note })
      : null,
    ctx.attempt ? scoreBar(ctx.attempt) : null,
    wave,
    ctx.stage === "slow" ? slowReadout() : null,
  ]);
}

/* Words per minute, not a percentage: a percentage of an unknown starting pace
   tells the learner nothing, and the starting pace differs by engine. */
function slowReadout() {
  const r = rates();
  const step = r.slow[ctx.slowStep] || r.slow.at(-1);
  if (!step) return null;
  return el("div", {
    class: "muted center",
    style: "margin-top:8px",
    text: `每分鐘 ${step.wpm} 字 · 原速 ${r.normalWpm}`,
  });
}

function scoreBar(a) {
  const tone =
    a.score >= 80
      ? "var(--good)"
      : a.score >= 55
        ? "var(--warn)"
        : "var(--bad)";
  return el("div", { style: "margin-top:14px;text-align:center" }, [
    el("div", {
      style: `font-size:30px;font-weight:700;color:${tone}`,
      text: `${a.score}`,
    }),
    el("div", { class: "muted", text: "語音辨識比對分數(僅供參考)" }),
    el(
      "div",
      { style: "margin-top:10px;font-size:14px;line-height:1.9" },
      a.words.map((w) =>
        el("span", {
          style: `padding:2px 5px;margin:0 1px;border-radius:5px;${
            w.ok
              ? ""
              : "background:color-mix(in srgb,var(--bad) 22%,transparent);color:var(--bad)"
          }`,
          text: w.w,
        }),
      ),
    ),
  ]);
}

/* Each button says when the sentence will actually come back. The labels used
   to be fixed text — 勉強 promised 「明天複習」 while scheduling twelve days out
   once a card was a few reps old, which made the middle button unusable on
   purpose without ever saying so. */
function gradeRow() {
  const [again, hard, good] = gradePreview(ctx.card);
  const opt = (g, label, when, primary = false) =>
    el(
      "button",
      {
        class: primary ? "btn btn-primary" : "btn",
        onclick: () => scoreAndNext(g),
      },
      [
        el("b", { text: label }),
        primary
          ? el("span", { style: "opacity:.75", text: when })
          : el("span", { class: "muted", text: when }),
      ],
    );
  return el("div", { class: "rate-row" }, [
    opt(0, "沒聽懂", again),
    opt(1, "勉強", hard),
    opt(2, "掌握了", good, true),
  ]);
}

function actions() {
  const box = el("div", { class: "actions" });
  const btn = (label, cls, fn) =>
    el("button", { class: `btn ${cls}`, onclick: fn }, [label]);

  switch (ctx.stage) {
    case "blind":
      box.append(
        btn("聽懂了", "btn-primary btn-lg", () => goto("reveal")),
        el("div", { class: "btn-row" }, [
          btn("再聽一次", "", replay),
          btn("聽不懂 · 放慢", "", harder),
        ]),
      );
      break;

    case "slow":
      box.append(
        btn("再回原速聽一次", "btn-primary btn-lg", () => goto("again")),
        el("div", { class: "btn-row" }, [
          btn("再聽一次", "", replay),
          btn("再慢一點", "", harder),
        ]),
      );
      break;

    case "again":
      box.append(
        btn("看答案", "btn-primary btn-lg", () => goto("reveal")),
        btn("再聽一次", "", replay),
      );
      break;

    case "reveal":
      box.append(
        btn("跟讀這句", "btn-primary btn-lg", () => {
          ctx.stage = "shadow";
          paint();
          startShadow();
        }),
        el("div", { class: "btn-row" }, [
          btn("再聽一次", "", replay),
          ctx.voices.length > 1 && !ctx.lesson.realAudio
            ? btn(ctx.busy ? `🌍 ${ctx.tourVoice || "…"}` : "🌍 三種口音", "", accentTour)
            : null,
        ]),
        btn("跳過 · 不計入複習", "btn-ghost", skip),
      );
      break;

    case "shadow":
      box.append(el("div", { class: "muted center" }, ["準備麥克風…"]));
      break;

    case "recording":
      box.append(
        btn("■ 錄好了", "btn-primary btn-lg", stopShadow),
        el("div", { class: "muted center", style: "margin-top:2px" }, [
          "照著剛剛聽到的唸一次,語調、連讀都模仿",
        ]),
      );
      break;

    case "compare": {
      box.append(
        el("div", { class: "btn-row" }, [
          btn("▶ 原音", "", playOriginal),
          btn("▶ 我的", "", playMine),
          btn("▶ 連續比對", "", playBoth),
        ]),
        el("div", { class: "muted center", style: "margin:8px 0 2px" }, [
          "這句你掌握得如何?",
        ]),
        gradeRow(),
        btn("重錄", "btn-ghost", startShadow),
      );
      break;
    }
  }
  return box;
}

/* ---------- quiz ---------- */

function quizStage() {
  const qs = ctx.lesson.questions;
  const q = qs[ctx.quiz.at];
  const picked = ctx.quiz.picked;

  const opts = q.options.map((text, idx) =>
    el(
      "button",
      {
        class: `q-opt ${picked == null ? "" : idx === q.answer ? "is-right" : idx === picked ? "is-wrong" : ""}`,
        disabled: picked != null,
        onclick: () => {
          ctx.quiz.picked = idx;
          if (idx === q.answer) ctx.quiz.right++;
          paint();
        },
      },
      [text],
    ),
  );

  return el("div", {}, [
    el("div", { class: "card" }, [
      el("div", {
        class: "stage-hint",
        style: "text-align:left",
        text: `理解測驗 ${ctx.quiz.at + 1} / ${qs.length}`,
      }),
      el("h3", { style: "font-size:17px;margin:6px 0 14px", text: q.q }),
      ...opts,
      picked != null
        ? el(
            "button",
            {
              class: "btn btn-primary btn-block",
              style: "margin-top:12px",
              onclick: () => {
                if (ctx.quiz.at >= qs.length - 1) finish();
                else {
                  ctx.quiz.at++;
                  ctx.quiz.picked = null;
                  paint();
                }
              },
            },
            [ctx.quiz.at >= qs.length - 1 ? "看結果" : "下一題"],
          )
        : null,
    ]),
  ]);
}

function doneStage() {
  const mins = Math.max(1, Math.round((ctx.doneSeconds || 0) / 60));
  const q = ctx.quiz;
  return el("div", {}, [
    el("div", { class: "hero", style: "text-align:center" }, [
      el("div", { style: "font-size:40px" }, ["🎧"]),
      el("h1", { style: "margin-top:6px", text: "這課完成了" }),
      el("p", { style: "margin-bottom:0" }, [
        `練習 ${mins} 分鐘${q ? ` · 理解測驗答對 ${q.right}/${ctx.lesson.questions.length}` : ""}`,
      ]),
    ]),
    el("p", { class: "muted center", style: "margin-bottom:18px" }, [
      "沒掌握的句子已經排進複習,明天會再出現。",
    ]),
    el("div", { class: "actions" }, [
      el(
        "a",
        { class: "btn btn-primary btn-lg btn-block", href: "#/library" },
        ["選下一課"],
      ),
      el(
        "a",
        {
          class: "btn btn-block",
          href: `#/listen/${encodeURIComponent(ctx.lesson.id)}`,
          onclick: () => setTimeout(() => location.reload(), 0),
        },
        ["再練一次這課"],
      ),
      el("a", { class: "btn btn-ghost btn-block", href: "#/" }, ["回到今天"]),
    ]),
  ]);
}
