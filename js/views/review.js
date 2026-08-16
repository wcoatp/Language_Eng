/* 複習 — spaced repetition over the sentences you struggled with.

   Two modes over the same queue. Recognition (the original) plays the sentence
   and asks whether you understood it. Retrieval asks you to produce it from
   the meaning before you hear it, which is the one thing the rest of the app
   never requires — see js/recall.js for why the cue is shaped the way it is. */

import { el, emptyState, toast, backButton, sleep, mount } from "../ui.js";
import { dueCards, grade, gradePreview } from "../srs.js";
import { getLesson } from "../content.js";
import { voiceIdForLesson } from "../voices.js";
import { settings, setSetting, stopwatch } from "../store.js";
import { say, cancel as cancelSpeech, unlock, voicesForLesson } from "../tts.js";
import { rotateVoice, byId } from "../voices.js";
import { keepAwake, releaseAwake } from "../handsfree.js";
import {
  record,
  playBlob,
  stopPlayback,
  releaseMic,
  recorderSupported,
} from "../recorder.js";
import { listen as listenASR, asrSupported, scoreAttempt } from "../asr.js";
import {
  SCAFFOLD_STEPS,
  orderForRecall,
  readyForRecall,
  recallCue,
  thinkingMs,
} from "../recall.js";

let ctx = null;

export function destroy() {
  cancelSpeech();
  stopPlayback();
  releaseMic();
  ctx?.rec?.cancel();
  ctx?.asr?.abort();
  releaseAwake();
  ctx?.watch?.stop();
  ctx = null;
}

export async function render(root) {
  const [cards, cfg] = await Promise.all([dueCards(30), settings()]);

  if (!cards.length) {
    mount(
      root,
      el("h1", { text: "複習" }),
      emptyState("目前沒有到期的句子", "練完課程後,沒掌握的句子會排進這裡"),
      el("a", { class: "btn btn-block", href: "#/library" }, ["去練新課"]),
    );
    return;
  }

  // Cards store their own text, so a review never needs the lesson file —
  // but load what we can so audio clips and speaker context still work.
  const lessons = new Map();
  const voices = new Map();
  for (const id of new Set(cards.map((c) => c.lessonId))) {
    try {
      lessons.set(id, await getLesson(id));
      voices.set(id, await voicesForLesson(id));
    } catch {
      /* imported lesson deleted */
    }
  }

  ctx = {
    cards: cfg.recallMode ? orderForRecall(cards) : cards,
    cfg,
    lessons,
    voices,
    i: 0,
    stage: "cue",
    done: 0,
    attempt: null,
    blob: null,
    busy: false,
    watch: stopwatch("review"),
  };
  mount(root, el("div", { id: "rev" }));
  keepAwake();
  begin();
}

function card() {
  return ctx.cards[ctx.i];
}

function sentenceOf(c) {
  const lesson = ctx.lessons.get(c.lessonId);
  return (
    lesson?.sentences.find((s) => s.id === c.sentenceId) || {
      id: c.sentenceId,
      text: c.text || "",
    }
  );
}

/* Retrieval needs a meaning to aim at. Without a translation there is nothing
   to retrieve *from*, so those cards stay on the recognition path. */
function isRecall(c = card()) {
  return !!ctx.cfg.recallMode && readyForRecall(c) && !!sentenceOf(c).zh;
}

function begin() {
  ctx.stage = isRecall() ? "cue" : "listen";
  ctx.attempt = null;
  ctx.blob = null;
  paint();
  if (ctx.stage === "listen") play();
  else countdown();
}

/* The silent gap is the drill. Ending it early, or filling it with the model
   answer, trains the learner to wait rather than to reach for the words. */
async function countdown() {
  const c = card();
  const token = c;
  const total = thinkingMs(sentenceOf(c).text);
  const started = Date.now();
  for (;;) {
    if (!ctx || card() !== token || ctx.stage !== "cue") return;
    const left = total - (Date.now() - started);
    const bar = document.getElementById("think-bar");
    if (bar) bar.style.width = `${Math.max(0, (left / total) * 100)}%`;
    if (left <= 0) break;
    await sleep(100);
  }
  if (ctx && card() === token && ctx.stage === "cue") {
    ctx.stage = "produce";
    paint();
  }
}

/* Which voice this repetition should use.

   Spaced repetition brings the same sentence back over weeks, and every one of
   those meetings currently sounds like the same person. Varying the speaker
   across repetitions is the cheap half of high-variability training, and the
   clips are already on disk. Falls back to the learner's own choice whenever
   the lesson has no alternatives or the setting is off. */
function voiceForCard(c, lesson) {
  const chosen = voiceIdForLesson(ctx.cfg, lesson);
  if (!ctx.cfg.accentRotation || lesson?.realAudio) return chosen;
  const pool = ctx.voices.get(c.lessonId) || [];
  if (pool.length < 2) return chosen;
  return rotateVoice(pool, c.reps || 0) || chosen;
}

async function play() {
  const c = card();
  if (!c) return;
  const s = sentenceOf(c);
  const lesson = ctx.lessons.get(c.lessonId);
  if (!s.text) return;
  unlock();
  cancelSpeech();
  document.getElementById("revwave")?.classList.add("is-on");
  try {
    await say(s.text, {
      lessonId: c.lessonId,
      sentenceId: c.sentenceId,
      langCode: ctx.cfg.accentLang,
      voiceURI: ctx.cfg.accent,
      rate: ctx.cfg.normalRate,
      voiceId: voiceForCard(c, lesson),
      realAudio: !!lesson?.realAudio,
      blob: s.audio || null,
    });
  } catch {
    /* silent — the text is still on screen */
  }
  document.getElementById("revwave")?.classList.remove("is-on");
}

/* ---------- speaking ---------- */

async function startSpeaking() {
  if (!recorderSupported()) {
    reveal();
    return;
  }
  ctx.busy = true;
  ctx.blob = null;
  ctx.attempt = null;
  ctx.stage = "recording";
  paint();
  try {
    ctx.rec = await record();
  } catch {
    // No microphone is not a reason to lose the rep — say it out loud anyway.
    ctx.busy = false;
    ctx.stage = "produce";
    toast("沒有麥克風權限,可以直接唸出來再看答案");
    paint();
    return;
  }
  if (asrSupported()) {
    ctx.asr = listenASR({ lang: ctx.cfg.accentLang });
    ctx.asr.promise.catch(() => "");
  }
  paint();
}

async function stopSpeaking() {
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
    if (heard) ctx.attempt = scoreAttempt(sentenceOf(card()).text, heard);
  }
  ctx.busy = false;
  reveal();
}

function reveal() {
  ctx.stage = "answer";
  paint();
  play();
}

async function playMine() {
  if (!ctx.blob) return;
  cancelSpeech();
  try {
    await playBlob(ctx.blob);
  } catch {
    toast("播放失敗");
  }
}

/* ---------- grading ---------- */

async function answer(g) {
  const c = card();
  await grade(c.lessonId, c.sentenceId, g);
  ctx.done++;
  if (ctx.i >= ctx.cards.length - 1) return finish();
  ctx.i++;
  begin();
}

async function finish() {
  const secs = await ctx.watch.stop();
  ctx.watch = null;
  releaseAwake();
  const host = document.getElementById("rev");
  host &&
    mount(
      host,
      el("div", { class: "hero", style: "text-align:center" }, [
        el("div", { style: "font-size:38px" }, ["✅"]),
        el("h1", { style: "margin-top:6px", text: "複習完成" }),
        el("p", { style: "margin:0" }, [
          `${ctx.done} 個句子 · ${Math.max(1, Math.round(secs / 60))} 分鐘`,
        ]),
      ]),
      el("a", { class: "btn btn-primary btn-lg btn-block", href: "#/library" }, [
        "去練新課",
      ]),
      el(
        "a",
        { class: "btn btn-ghost btn-block", href: "#/", style: "margin-top:9px" },
        ["回到今天"],
      ),
    );
  toast("複習紀錄已更新");
}

/* ---------- rendering ---------- */

const HINTS = {
  cue: "想想看怎麼說 — 先不要看答案",
  produce: "現在說出來",
  recording: "錄音中",
  answer: "對答案",
  listen: "這句在說什麼?",
};

function paint() {
  const host = document.getElementById("rev");
  if (!host || !ctx) return;
  const c = card();
  const s = sentenceOf(c);
  const lesson = ctx.lessons.get(c.lessonId);
  const recall = isRecall(c);
  const shown = ctx.stage === "answer";

  const wave = el("div", { class: "wave", id: "revwave" });
  for (let n = 0; n < 8; n++) wave.append(el("i"));

  mount(
    host,
    el("div", { class: "trainer-top" }, [
      backButton("離開", "#/"),
      el("div", { class: "muted", text: `${ctx.i + 1} / ${ctx.cards.length}` }),
    ]),
    modeRow(),
    el("div", { class: "stage" }, [
      el("div", { class: "stage-hint", text: HINTS[ctx.stage] || "" }),
      recall && !shown ? cueBlock(s) : null,
      el("p", {
        class: `sentence ${shown ? "" : "is-hidden"}`,
        text: s.text,
      }),
      shown && ctx.cfg.showZh && s.zh
        ? el("p", { class: "sentence-zh", text: s.zh })
        : null,
      shown && s.note
        ? el("div", { class: "sentence-note", text: s.note })
        : null,
      ctx.attempt && shown ? scoreBar(ctx.attempt) : null,
      wave,
      shown && lesson
        ? el("div", {
            class: "muted center",
            style: "margin-top:10px",
            text: rotationNote(c, lesson),
          })
        : null,
    ]),
    actions(recall),
  );
}

/* The meaning says which sentence; the English opening keeps the retrieval in
   English instead of turning the drill into translation practice. */
function cueBlock(s) {
  const cue = recallCue(s.text, ctx.cfg.recallScaffold ?? 2);
  return el("div", { class: "recall-cue" }, [
    el("p", { class: "recall-zh", text: s.zh }),
    cue.lead
      ? el("p", { class: "recall-lead" }, [
          el("b", { text: cue.lead }),
          el("span", { class: "muted", text: ` … 還有 ${cue.missing} 個字` }),
        ])
      : el("p", { class: "muted", text: `${cue.missing} 個字,沒有提示` }),
    ctx.stage === "cue"
      ? el("div", { class: "think-track" }, [
          el("i", { id: "think-bar", style: "width:100%" }),
        ])
      : null,
  ]);
}

/* Say who just spoke when it is not who the learner picked, so a sentence
   sounding different from last week reads as deliberate rather than broken. */
function rotationNote(c, lesson) {
  const id = voiceForCard(c, lesson);
  if (lesson.realAudio || id === voiceIdForLesson(ctx.cfg, lesson)) return lesson.title;
  return `${lesson.title} · ${byId(id)?.label || id}`;
}

function scoreBar(a) {
  const tone =
    a.score >= 80 ? "var(--good)" : a.score >= 55 ? "var(--warn)" : "var(--bad)";
  return el("div", { style: "margin-top:14px;text-align:center" }, [
    el("div", {
      style: `font-size:30px;font-weight:700;color:${tone}`,
      text: `${a.score}`,
    }),
    el("div", { class: "muted", text: "你說出來的比對分數(僅供參考)" }),
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

function modeRow() {
  if (ctx.stage !== "cue" && ctx.stage !== "listen") return null;
  return el("div", { class: "chips", style: "margin-bottom:10px" }, [
    chip("回想", !!ctx.cfg.recallMode, async () => {
      ctx.cfg = await setSetting({ recallMode: !ctx.cfg.recallMode });
      ctx.cards = ctx.cfg.recallMode ? orderForRecall(ctx.cards) : ctx.cards;
      begin();
    }),
    ...(ctx.cfg.recallMode
      ? SCAFFOLD_STEPS.map((n) =>
          chip(
            n ? `給 ${n} 個字` : "不給提示",
            (ctx.cfg.recallScaffold ?? 2) === n,
            async () => {
              ctx.cfg = await setSetting({ recallScaffold: n });
              paint();
            },
          ),
        )
      : []),
  ]);
}

function chip(label, on, onclick) {
  return el("button", { class: `chip ${on ? "is-on" : ""}`, onclick }, [label]);
}

function actions(recall) {
  const btn = (label, cls, fn) =>
    el("button", { class: `btn ${cls}`, onclick: fn }, [label]);

  switch (ctx.stage) {
    case "cue":
      return el("div", { class: "actions" }, [
        btn("我想好了", "btn-primary btn-lg", () => {
          ctx.stage = "produce";
          paint();
        }),
      ]);

    case "produce":
      return el("div", { class: "actions" }, [
        recorderSupported()
          ? btn("● 說出來", "btn-primary btn-lg", startSpeaking)
          : btn("看答案", "btn-primary btn-lg", reveal),
        recorderSupported()
          ? btn("直接看答案", "btn-ghost", reveal)
          : null,
      ]);

    case "recording":
      return el("div", { class: "actions" }, [
        btn("■ 說完了", "btn-primary btn-lg", stopSpeaking),
      ]);

    case "listen":
      return el("div", { class: "actions" }, [
        btn("顯示答案", "btn-primary btn-lg", reveal),
        btn("再聽一次", "", play),
      ]);

    default: {
      const [again, hard, good] = gradePreview(card());
      const rate = (g, label, when, primary) =>
        el(
          "button",
          {
            class: primary ? "btn btn-primary" : "btn",
            onclick: () => answer(g),
          },
          [
            el("b", { text: label }),
            primary
              ? el("span", { style: "opacity:.75", text: when })
              : el("span", { class: "muted", text: when }),
          ],
        );
      return el("div", {}, [
        el("div", { class: "btn-row", style: "margin-bottom:8px" }, [
          btn("▶ 原音", "", play),
          ctx.blob ? btn("▶ 我說的", "", playMine) : null,
        ]),
        el("div", { class: "muted center", style: "margin-bottom:6px" }, [
          recall ? "你想得出來嗎?" : "這句你掌握得如何?",
        ]),
        el("div", { class: "rate-row" }, [
          rate(0, "想不出來", again, false),
          rate(1, "勉強", hard, false),
          rate(2, "說得出來", good, true),
        ]),
      ]);
    }
  }
}
