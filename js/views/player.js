/* Continuous listening: play a whole lesson or any individually selected lines. */

import { getLesson, loadIndex } from "../content.js";
import { settings, setSetting, logTime } from "../store.js";
import { voiceIdForLesson } from "../voices.js";
import {
  say,
  cancel as cancelSpeech,
  unlock,
  pause as pauseSpeech,
  resume as resumeSpeech,
} from "../tts.js";
import {
  PLAYBACK_GAPS,
  PLAYBACK_RATES,
  playbackSequence,
  nextLessonFor,
} from "../playback.js";
import {
  setNowPlaying,
  setHandlers,
  setPlaybackState,
  clearNowPlaying,
  keepAwake,
  releaseAwake,
  mediaSessionSupported,
} from "../handsfree.js";
import { openControls, closeControls, currentVoiceLabel } from "../controls.js";
import { el, toast, backButton, sleep, mount } from "../ui.js";
import { kvGet, kvSet } from "../db.js";
import {
  completesDailyPlayback,
  isDailyComplete,
  STORY_BEATS,
} from "../daily.js";

let ctx = null;

export function destroy() {
  if (!ctx) return;
  ctx.run++;
  cancelSpeech();
  logElapsed(ctx);
  clearNowPlaying();
  releaseAwake();
  closeControls();
  ctx = null;
}

export async function render(root, lessonId) {
  const [lesson, cfg, index, completions] = await Promise.all([
    getLesson(lessonId),
    settings(),
    loadIndex(),
    kvGet("dailyCompletions", {}),
  ]);
  const nextDaily = lesson.daily
    ? index.find(
        (item) =>
          item.daily?.seriesId === lesson.daily.seriesId &&
          item.daily.day === lesson.daily.day + 1,
      )
    : null;
  ctx = {
    root,
    lesson,
    cfg,
    mode: "all",
    selected: new Set(lesson.sentences.map((sentence) => sentence.id)),
    rate: cfg.normalRate || 1,
    gap: 500,
    playing: false,
    currentId: null,
    run: 0,
    startedAt: 0,
    completed: isDailyComplete(lesson, null, completions),
    nextDaily,
    index,
    handsFree: cfg.autoAdvance !== false,
    paused: false,
    autoQueued: 0,
    preview: 0,
  };
  wireRemoteControls();
  paint();
}

/* ---------- hands-free ---------- */

/* An unattended queue should not run all night. Twelve lessons is roughly two
   hours of listening, which is longer than any commute and short of a
   forgotten phone playing until the battery dies. */
const MAX_AUTO_LESSONS = 12;

function wireRemoteControls() {
  setHandlers({
    play: () => {
      if (ctx?.paused) togglePause();
      else if (!ctx?.playing) play();
    },
    pause: () => {
      if (ctx?.playing && !ctx.paused) togglePause();
    },
    stop: () => stop(),
    previoustrack: () => jump(-1),
    nexttrack: () => jump(1),
  });
}

/* Skip within the lesson. The loop is awaiting say(), so cancelling it lets
   the current iteration fall through, and the index moves under it. */
function jump(delta) {
  const state = ctx;
  if (!state?.playing) return;
  const sequence = chosen(state);
  const at = sequence.findIndex((s) => s.id === state.currentId);
  const to = at + delta;
  if (to < 0 || to >= sequence.length) return;
  state.seekTo = to;
  cancelSpeech();
}

function togglePause() {
  const state = ctx;
  if (!state?.playing) return;
  if (state.paused) {
    state.paused = false;
    resumeSpeech();
    state.startedAt = performance.now();
    setPlaybackState("playing");
  } else {
    state.paused = true;
    pauseSpeech();
    logElapsed(state); // bank the time; a pause may last all afternoon
    setPlaybackState("paused");
  }
  paint();
}

function announce(state, sentence, position, total) {
  setNowPlaying({
    title: sentence.text,
    lesson: state.lesson.title,
    detail: `${position} / ${total} · ${state.lesson.titleZh || ""}`.trim(),
  });
}

function chosen(state = ctx) {
  return playbackSequence(state.lesson.sentences, state.mode, state.selected);
}

function logElapsed(state) {
  if (!state.startedAt) return;
  const seconds = (performance.now() - state.startedAt) / 1000;
  state.startedAt = 0;
  logTime(seconds, "listen", state.lesson.id).catch(() => {});
}

function stop() {
  if (!ctx) return;
  ctx.run++;
  ctx.playing = false;
  ctx.paused = false;
  ctx.currentId = null;
  ctx.seekTo = null;
  ctx.autoQueued = 0;
  cancelSpeech();
  logElapsed(ctx);
  setPlaybackState("none");
  releaseAwake();
  paint();
}

async function play() {
  const state = ctx;
  if (!state) return;
  if (state.playing) {
    stop();
    return;
  }

  const sequence = chosen(state);
  if (!sequence.length) {
    toast("請至少選一句");
    return;
  }

  unlock();
  state.playing = true;
  state.paused = false;
  state.seekTo = null;
  state.startedAt = performance.now();
  const token = ++state.run;
  let failed = false;
  setPlaybackState("playing");
  // Only while the learner is watching. In a pocket the screen should sleep —
  // the audio keeps going either way, and the lock is refused when hidden.
  if (!document.hidden) keepAwake();
  paint();

  for (let i = 0; i < sequence.length; i++) {
    if (ctx !== state || state.run !== token) return;
    const sentence = sequence[i];
    state.currentId = sentence.id;
    announce(state, sentence, i + 1, sequence.length);
    paint(true);
    try {
      await say(sentence.text, {
        lessonId: state.lesson.id,
        sentenceId: sentence.id,
        langCode: state.cfg.accentLang,
        voiceURI: state.cfg.accent,
        voiceId: voiceIdForLesson(state.cfg, state.lesson),
        rate: state.rate,
        realAudio: !!state.lesson.realAudio,
        blob: sentence.audio || null,
      });
    } catch (error) {
      if (ctx === state && state.run === token)
        toast(error.message || "播放失敗");
      failed = true;
      break;
    }
    if (ctx !== state || state.run !== token) return;

    // A skip cancels the clip above, which lands here rather than throwing.
    if (state.seekTo != null) {
      i = state.seekTo - 1;
      state.seekTo = null;
      continue;
    }
    // Pause holds the loop here instead of unwinding it, so resuming carries
    // on with the same sentence list rather than restarting the lesson.
    while (state.paused && ctx === state && state.run === token)
      await sleep(200);
    if (ctx !== state || state.run !== token) return;
    if (state.gap && i < sequence.length - 1) await sleep(state.gap);
  }

  if (ctx !== state || state.run !== token) return;
  state.playing = false;
  state.currentId = null;
  logElapsed(state);
  const dailyComplete =
    !failed && completesDailyPlayback(state.lesson, sequence);
  if (dailyComplete) {
    const completions = await kvGet("dailyCompletions", {});
    completions[state.lesson.id] = Date.now();
    await kvSet("dailyCompletions", completions);
    state.completed = true;
  }
  if (ctx !== state || state.run !== token) return;

  if (!failed && state.handsFree && state.mode === "all") {
    if (await advance(state, token)) return;
  }
  setPlaybackState("none");
  releaseAwake();
  paint();
  if (!failed) toast(dailyComplete ? "今日課程完成" : "播放完成");
}

/* Roll on to the next lesson without a tap. Everything is reloaded rather than
   navigated to, because a hash change would tear down the view and with it the
   audio — which is exactly what hands-free is trying to avoid. */
async function advance(state, token) {
  if (state.autoQueued >= MAX_AUTO_LESSONS) {
    toast(`已連續播放 ${MAX_AUTO_LESSONS} 課,先停下來`);
    return false;
  }
  const next = nextLessonFor(state.index, state.lesson);
  if (!next) return false;

  let lesson;
  try {
    lesson = await getLesson(next.id);
  } catch {
    return false;
  }
  if (ctx !== state || state.run !== token) return true;

  state.lesson = lesson;
  state.selected = new Set(lesson.sentences.map((s) => s.id));
  state.completed = false;
  state.autoQueued++;
  state.playing = false;
  state.nextDaily = lesson.daily
    ? state.index.find(
        (item) =>
          item.daily?.seriesId === lesson.daily.seriesId &&
          item.daily.day === lesson.daily.day + 1,
      )
    : null;
  // Keep the address bar honest so a reload lands on what is actually playing.
  history.replaceState(null, "", `#/play/${encodeURIComponent(lesson.id)}`);
  toast(`接著播放「${lesson.title}」`);
  play();
  return true;
}

/* Play one line on demand.

   Two different jobs depending on what is happening. Mid-lesson it is a seek:
   the loop is already awaiting say(), so moving its cursor and cancelling the
   clip lands it on the tapped sentence and carries on from there. Idle it is a
   one-off preview, which must not flip the card into its playing state — you
   tapped a line, you did not start the lesson. */
async function playSentence(sentence) {
  const state = ctx;
  if (!state) return;

  if (state.playing) {
    const at = chosen(state).findIndex((s) => s.id === sentence.id);
    if (at >= 0) {
      state.seekTo = at;
      cancelSpeech();
      return;
    }
    // Not in the current selection: fall through and preview it instead.
  }

  const token = ++state.preview;
  unlock();
  cancelSpeech();
  state.currentId = sentence.id;
  paint();
  try {
    await say(sentence.text, {
      lessonId: state.lesson.id,
      sentenceId: sentence.id,
      langCode: state.cfg.accentLang,
      voiceURI: state.cfg.accent,
      voiceId: voiceIdForLesson(state.cfg, state.lesson),
      rate: state.rate,
      realAudio: !!state.lesson.realAudio,
      blob: sentence.audio || null,
    });
  } catch (error) {
    if (ctx === state && state.preview === token) toast(error.message || "播放失敗");
  }
  if (ctx !== state || state.preview !== token || state.playing) return;
  state.currentId = null;
  paint();
}

function setMode(mode) {
  if (!ctx || ctx.playing) return;
  ctx.mode = mode;
  paint();
}

function toggle(id, checked) {
  if (!ctx) return;
  if (checked) ctx.selected.add(id);
  else ctx.selected.delete(id);
  paint();
}

function setAll(selected) {
  if (!ctx) return;
  ctx.selected = new Set(
    selected ? ctx.lesson.sentences.map((sentence) => sentence.id) : [],
  );
  paint();
}

function paint(scrollCurrent = false) {
  const state = ctx;
  if (!state) return;
  const sequence = chosen(state);
  const currentIndex = state.currentId
    ? sequence.findIndex((sentence) => sentence.id === state.currentId)
    : -1;
  const rates = [
    ...new Set([state.cfg.normalRate || 1, ...PLAYBACK_RATES]),
  ].sort((a, b) => a - b);

  mount(
    state.root,
    el("div", { class: "trainer-top" }, [
      backButton("課程", `#/lesson/${encodeURIComponent(state.lesson.id)}`),
      el("span", {
        class: "muted",
        text: state.playing
          ? `${currentIndex + 1} / ${sequence.length}`
          : `${sequence.length} 句`,
      }),
    ]),
    el("h1", { text: state.lesson.daily ? "每日課程閱讀" : "連續播放" }),
    el("p", {
      class: "sub",
      text: `${state.lesson.title} · ${state.lesson.titleZh || ""}`,
    }),

    el(
      "div",
      { class: `player-controls card ${state.playing ? "is-playing" : ""}` },
      state.playing ? livePanel(state) : idlePanel(state, sequence, rates),
    ),

    state.completed && !state.playing
      ? el("section", { class: "card daily-player-complete" }, [
          el("div", { class: "badge badge-done", text: "今日完成" }),
          el("h2", { text: "故事已完整聽完" }),
          el("p", {
            text: state.nextDaily
              ? `接著閱讀「${state.nextDaily.title}」,看看故事如何發展。`
              : "你已完成這個主題的最後一日。",
          }),
          state.nextDaily
            ? el(
                "a",
                {
                  class: "btn btn-primary btn-block",
                  href: `#/lesson/${encodeURIComponent(state.nextDaily.id)}`,
                },
                [`前往第 ${state.nextDaily.daily.day} 日`],
              )
            : el("a", { class: "btn btn-block", href: "#/daily" }, [
                "回到每日課表",
              ]),
        ])
      : null,

    state.mode === "custom"
      ? el("div", { class: "player-selection-bar" }, [
          el("span", {
            class: "muted",
            text: `已選 ${state.selected.size} / ${state.lesson.sentences.length}`,
          }),
          el("div", { style: "display:flex;gap:8px" }, [
            el(
              "button",
              {
                class: "btn btn-ghost player-small-btn",
                disabled: state.playing,
                onclick: () => setAll(true),
              },
              ["全選"],
            ),
            el(
              "button",
              {
                class: "btn btn-ghost player-small-btn",
                disabled: state.playing,
                onclick: () => setAll(false),
              },
              ["清除"],
            ),
          ]),
        ])
      : null,

    el("div", { class: "player-list" }, playerRows(state)),
  );

  if (scrollCurrent && state.currentId) {
    requestAnimationFrame(() =>
      document
        .getElementById(`player-${state.currentId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }
}

function playerRows(state) {
  const starts = state.lesson.storyArc
    ? new Map(STORY_BEATS.map((beat) => [state.lesson.storyArc[beat.id], beat]))
    : new Map();
  const out = [];
  state.lesson.sentences.forEach((sentence, index) => {
    const beat = starts.get(sentence.id);
    if (beat) {
      out.push(
        el("div", { class: "story-beat player-story-beat" }, [
          el("span", { text: beat.label }),
          el("b", { text: beat.description }),
        ]),
      );
    }
    const selected = state.mode === "all" || state.selected.has(sentence.id);
    const current = state.currentId === sentence.id;
    out.push(
      el(
        "div",
        {
          id: `player-${sentence.id}`,
          class: `player-row card is-tappable${current ? " is-playing" : ""}${selected ? "" : " is-muted"}`,
          // Tapping a line plays it. While the lesson is running this seeks
          // rather than interrupting, because a reading you are following is
          // the one time you most want to jump back a sentence.
          onclick: () => playSentence(sentence),
        },
        [
          state.mode === "custom"
            ? el(
                "label",
                {
                  class: "player-pick",
                  // The checkbox owns its own tap target; everything else on
                  // the row plays, so selecting and hearing never fight.
                  onclick: (event) => event.stopPropagation(),
                },
                [
                  el("input", {
                    type: "checkbox",
                    checked: state.selected.has(sentence.id),
                    onchange: (event) => toggle(sentence.id, event.target.checked),
                  }),
                ],
              )
            : el("span", { class: "player-number", text: String(index + 1) }),
          el("div", { class: "player-copy" }, [
            el("div", { style: "display:flex;gap:8px;align-items:baseline" }, [
              sentence.speaker
                ? el("span", { class: "badge", text: sentence.speaker })
                : null,
              el("span", { text: sentence.text }),
            ]),
            state.cfg.showZh && sentence.zh
              ? el("div", {
                  class: "muted",
                  style: "margin-top:4px",
                  text: sentence.zh,
                })
              : null,
          ]),
        ],
      ),
    );
  });
  return out;
}

/* The one control that turns this from a player into something you can use on
   a walk: keep going into the next lesson, and answer the headphone button. */
function handsFreeRow(state) {
  const input = el("input", {
    type: "checkbox",
    checked: state.handsFree,
    onchange: async (e) => {
      state.handsFree = e.target.checked;
      state.autoQueued = 0;
      await setSetting({ autoAdvance: state.handsFree });
      paint();
    },
  });
  return el("div", { class: "switch-row", style: "margin:4px 0 12px" }, [
    el("div", { class: "lbl" }, [
      "免持模式",
      el("small", {
        text: state.handsFree
          ? mediaSessionSupported()
            ? "播完自動接下一課,可用耳機和鎖定畫面控制"
            : "播完自動接下一課(這個瀏覽器沒有鎖定畫面控制)"
          : "播完就停在這一課",
      }),
    ]),
    el("label", { class: "switch" }, [input, el("span")]),
  ]);
}

/* Playing: the card is sticky, so this is what stays on screen for the whole
   lesson. Mode and selection are meaningless once started and would only be
   dead weight up there; speed and voice are exactly what gets reached for. */
function livePanel(state) {
  return [
    el("div", { class: "live-row" }, [
      el("button", { class: "btn btn-primary live-play", onclick: togglePause }, [
        state.paused ? "▶" : "❚❚",
      ]),
      el("button", { class: "btn live-stop", onclick: stop }, ["■"]),
      el("button", { class: "voice-chip live-voice", onclick: () => openSheet(state) }, [
        el("span", { class: "voice-chip-dot" }),
        currentVoiceLabel(state.cfg, state.lesson),
      ]),
      el("button", { class: "chip live-rate", onclick: () => openSheet(state) }, [
        `${state.cfg.normalRate}x`,
      ]),
    ]),
    handsFreeRow(state),
  ];
}

function idlePanel(state, sequence, rates) {
  return [
    el("div", { class: "chips player-mode-row", style: "margin-bottom:12px" }, [
      chip("完整課文", state.mode === "all", () => setMode("all")),
      chip("自訂選擇", state.mode === "custom", () => setMode("custom")),
    ]),
    // The sheet has to be reachable before playback too: this screen spends
    // most of its life idle, and choosing the accent is something you do
    // before you press play, not after.
    el("div", { class: "player-setting" }, [
      el("span", { class: "muted", text: "聲音" }),
      el("button", { class: "voice-chip", onclick: () => openSheet(state) }, [
        el("span", { class: "voice-chip-dot" }),
        currentVoiceLabel(state.cfg, state.lesson),
      ]),
    ]),
    el("div", { class: "player-setting" }, [
      el("span", { class: "muted", text: "速度" }),
      ...rates.map((rate) =>
        chip(`${rate}x`, Math.abs(state.rate - rate) < 0.001, () => {
          state.rate = rate;
          paint();
        }),
      ),
    ]),
    el("div", { class: "player-setting" }, [
      el("span", { class: "muted", text: "句間" }),
      ...PLAYBACK_GAPS.map((gap) =>
        chip(gap ? `${gap / 1000} 秒` : "不停頓", state.gap === gap, () => {
          state.gap = gap;
          paint();
        }),
      ),
    ]),
    handsFreeRow(state),
    el(
      "button",
      {
        class: "btn btn-primary btn-lg btn-block",
        disabled: !sequence.length,
        onclick: play,
      },
      [sequence.length ? `▶ 播放 ${sequence.length} 句` : "請先選擇句子"],
    ),
  ];
}

function openSheet(state) {
  openControls({
    cfg: state.cfg,
    lesson: state.lesson,
    onChange: (next, changed) => {
      // setSetting hands back a new object; holding the old one is how a
      // control ends up looking like it did nothing.
      state.cfg = next;
      // The player carries its own rate, so keep it in step rather than
      // letting two speeds disagree about what is playing.
      if (changed === "rate") state.rate = next.normalRate;
      paint();
    },
  });
}

function chip(label, active, onclick, disabled = false) {
  return el(
    "button",
    {
      class: `chip ${active ? "is-on" : ""}`,
      disabled,
      onclick,
    },
    [label],
  );
}
