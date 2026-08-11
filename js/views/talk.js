/* 對話 — two modes.

   角色扮演 : app plays one speaker of a dialogue lesson, you play the other.
              Works offline, no API key, no cost.
   自由對話 : real open-ended conversation through whichever LLM you configured.
              Needs your own API key; the key and the transcript stay on-device. */

import { el, toast, backButton, emptyState, sleep, mount } from "../ui.js";
import { settings, stopwatch } from "../store.js";
import { allLessons, getLesson } from "../content.js";
import { say, cancel as cancelSpeech, unlock } from "../tts.js";
import { listen as listenASR, asrSupported, scoreAttempt } from "../asr.js";
import { chat, tutorSystem, parseTurn, LlmError } from "../llm.js";

let ctx = null;

export function destroy() {
  cancelSpeech();
  ctx?.asr?.abort();
  ctx?.abort?.abort();
  ctx?.watch?.stop();
  ctx = null;
}

export async function render(root, mode) {
  if (!mode) return menu(root);
  if (mode === "free") return free(root);
  if (mode.startsWith("rp:")) return roleplay(root, mode.slice(3));
  location.hash = "#/talk";
}

/* ---------------- menu ---------------- */

const SCENARIOS = [
  {
    id: "cafe",
    icon: "☕️",
    title: "在咖啡廳點餐",
    en: "You are a barista at a busy cafe. The learner is a customer ordering.",
  },
  {
    id: "smalltalk",
    icon: "👋",
    title: "閒聊認識新朋友",
    en: "You just met the learner at a friend's party. Make small talk.",
  },
  {
    id: "hotel",
    icon: "🏨",
    title: "飯店入住與問題",
    en: "You are a hotel front-desk clerk. The learner is checking in and has a request.",
  },
  {
    id: "interview",
    icon: "💼",
    title: "英文工作面試",
    en: "You are a hiring manager interviewing the learner for a job they care about.",
  },
  {
    id: "doctor",
    icon: "🩺",
    title: "看醫生描述症狀",
    en: "You are a doctor. The learner is a patient describing symptoms.",
  },
  {
    id: "debate",
    icon: "💭",
    title: "聊聊想法與觀點",
    en: "Discuss an everyday topic and gently push back so the learner has to defend a view.",
  },
];

async function menu(root) {
  const [cfg, lessons] = await Promise.all([settings(), allLessons()]);
  const dialogues = lessons.filter((l) => l.type === "dialogue").slice(0, 8);
  const ready = !!cfg.apiKey;

  mount(
    root,
    el("h1", { text: "對話" }),
    el("p", { class: "sub", text: "從跟著唸,到自己開口。" }),

    el("h2", { style: "margin-top:8px", text: "角色扮演" }),
    el("p", { class: "muted", style: "margin-top:-4px" }, [
      "app 唸一個角色,你唸另一個。完全離線、不用 API。",
    ]),
    ...(dialogues.length
      ? dialogues.map((l) =>
          el(
            "a",
            {
              class: "card card-tap",
              href: `#/talk/rp:${encodeURIComponent(l.id)}`,
            },
            [
              el("div", { class: "lesson-head" }, [
                el("span", {
                  class: `badge badge-l${l.level}`,
                  text: `L${l.level}`,
                }),
                el("span", { class: "lesson-title", text: l.title }),
              ]),
              el("div", { class: "lesson-zh", text: l.titleZh || "" }),
            ],
          ),
        )
      : [emptyState("還沒有對話課程")]),

    el("h2", { text: "自由對話" }),
    el("p", { class: "muted", style: "margin-top:-4px" }, [
      ready
        ? "真人般的即興對話,講錯會告訴你怎麼說更自然。"
        : "需要先在設定裡填入你自己的 API key。語音辨識與朗讀仍然免費。",
    ]),

    ready
      ? el(
          "div",
          {},
          SCENARIOS.map((s) =>
            el(
              "a",
              {
                class: "card card-tap",
                href: "#/talk/free",
                onclick: () => sessionStorage.setItem("scenario", s.id),
              },
              [
                el(
                  "div",
                  { style: "display:flex;gap:11px;align-items:center" },
                  [
                    el("span", { style: "font-size:22px", text: s.icon }),
                    el("span", { class: "lesson-title", text: s.title }),
                  ],
                ),
              ],
            ),
          ),
        )
      : el("a", { class: "btn btn-block", href: "#/settings" }, [
          "前往設定 API key",
        ]),
  );
}

/* ---------------- 角色扮演 (offline) ---------------- */

async function roleplay(root, lessonId) {
  const [lesson, cfg] = await Promise.all([getLesson(lessonId), settings()]);
  const speakers = [
    ...new Set(lesson.sentences.map((s) => s.speaker).filter(Boolean)),
  ];
  if (speakers.length < 2) {
    toast("這課不是雙人對話");
    location.hash = "#/talk";
    return;
  }

  ctx = {
    kind: "rp",
    lesson,
    cfg,
    i: 0,
    mine: speakers[1],
    theirs: speakers[0],
    stage: "idle",
    heard: "",
    result: null,
    watch: stopwatch("talk", lesson.id),
  };

  mount(root, el("div", { id: "rp" }));
  paintRP();
  stepRP();
}

async function stepRP() {
  const { lesson } = ctx;
  const s = lesson.sentences[ctx.i];
  if (!s) return finishRP();

  if (s.speaker === ctx.theirs) {
    ctx.stage = "listening";
    paintRP();
    unlock();
    try {
      await say(s.text, {
        lessonId: lesson.id,
        sentenceId: s.id,
        langCode: ctx.cfg.accentLang,
        voiceURI: ctx.cfg.accent,
        rate: ctx.cfg.normalRate,
      });
    } catch {
      /* keep going even if audio fails */
    }
    if (!ctx) return;
    ctx.i++;
    return stepRP();
  }

  ctx.stage = "yourTurn";
  ctx.heard = "";
  ctx.result = null;
  paintRP();
}

async function speakMyLine() {
  if (!asrSupported()) {
    // No recognition available — let the learner self-assess instead of blocking.
    ctx.result = { score: -1, words: [] };
    ctx.stage = "checked";
    paintRP();
    return;
  }
  ctx.stage = "recording";
  ctx.heard = "";
  paintRP();

  ctx.asr = listenASR({
    lang: ctx.cfg.accentLang,
    interim: (t) => {
      ctx.heard = t;
      const n = document.getElementById("rpheard");
      if (n) n.textContent = t;
    },
  });

  let heard = "";
  try {
    heard = await ctx.asr.promise;
  } catch {
    heard = ctx.heard;
  }
  ctx.asr = null;
  if (!ctx) return;

  ctx.result = scoreAttempt(
    ctx.lesson.sentences[ctx.i].text,
    heard || ctx.heard,
  );
  ctx.stage = "checked";
  paintRP();
}

function nextRP() {
  ctx.i++;
  stepRP();
}

async function finishRP() {
  const secs = await ctx.watch.stop();
  ctx.watch = null;
  const host = document.getElementById("rp");
  if (!host) return;
  mount(
    host,
    el("div", { class: "hero", style: "text-align:center" }, [
      el("div", { style: "font-size:38px" }, ["🎭"]),
      el("h1", { style: "margin-top:6px", text: "對話走完了" }),
      el("p", {
        style: "margin:0",
        text: `${Math.max(1, Math.round(secs / 60))} 分鐘`,
      }),
    ]),
    el("a", { class: "btn btn-primary btn-lg btn-block", href: "#/talk" }, [
      "再挑一個",
    ]),
    el(
      "a",
      {
        class: "btn btn-ghost btn-block",
        href: "#/",
        style: "margin-top:9px",
      },
      ["回到今天"],
    ),
  );
}

function paintRP() {
  const host = document.getElementById("rp");
  if (!host || !ctx) return;
  const s = ctx.lesson.sentences[ctx.i];
  const total = ctx.lesson.sentences.length;

  const body = [];
  body.push(
    el("div", { class: "trainer-top" }, [
      backButton("離開", "#/talk"),
      el("div", {
        class: "muted",
        text: `${Math.min(ctx.i + 1, total)} / ${total}`,
      }),
    ]),
  );

  if (ctx.stage === "listening") {
    body.push(
      el("div", { class: "stage" }, [
        el("div", { class: "stage-hint", text: `對方 (${ctx.theirs})` }),
        el("p", { class: "sentence", text: s.text }),
        ctx.cfg.showZh && s.zh
          ? el("p", { class: "sentence-zh", text: s.zh })
          : null,
      ]),
    );
  } else if (ctx.stage === "yourTurn" || ctx.stage === "recording") {
    body.push(
      el("div", { class: "stage" }, [
        el("div", { class: "stage-hint", text: `換你 (${ctx.mine})` }),
        el("p", { class: "sentence", text: s.text }),
        ctx.cfg.showZh && s.zh
          ? el("p", { class: "sentence-zh", text: s.zh })
          : null,
        ctx.stage === "recording"
          ? el("p", {
              class: "muted center",
              id: "rpheard",
              style: "margin-top:14px",
              text: "聽你說…",
            })
          : null,
      ]),
    );
    body.push(
      el("div", { class: "actions" }, [
        ctx.stage === "recording"
          ? el(
              "button",
              {
                class: "btn btn-primary btn-lg",
                onclick: () => ctx.asr?.stop(),
              },
              ["■ 說完了"],
            )
          : el(
              "button",
              { class: "btn btn-primary btn-lg", onclick: speakMyLine },
              ["🎤 唸這一句"],
            ),
        el(
          "button",
          {
            class: "btn btn-ghost",
            onclick: async () => {
              unlock();
              try {
                await say(s.text, {
                  lessonId: ctx.lesson.id,
                  sentenceId: s.id,
                  langCode: ctx.cfg.accentLang,
                  voiceURI: ctx.cfg.accent,
                  rate: ctx.cfg.slowRate,
                });
              } catch {
                /* ignore */
              }
            },
          },
          ["先聽示範(慢速)"],
        ),
        el("button", { class: "btn btn-ghost", onclick: nextRP }, ["跳過"]),
      ]),
    );
  } else if (ctx.stage === "checked") {
    const r = ctx.result;
    const ok = r.score >= 70;
    body.push(
      el("div", { class: "stage" }, [
        el("div", {
          class: "stage-hint",
          text: r.score < 0 ? "你的台詞" : ok ? "很接近了" : "再試一次會更好",
        }),
        el("p", { class: "sentence", text: s.text }),
        r.score >= 0
          ? el("div", { style: "text-align:center;margin-top:12px" }, [
              el("div", {
                style: `font-size:30px;font-weight:700;color:${ok ? "var(--good)" : "var(--warn)"}`,
                text: String(r.score),
              }),
              el("div", { class: "muted", text: "辨識比對分數" }),
            ])
          : null,
      ]),
    );
    body.push(
      el("div", { class: "actions" }, [
        el("button", { class: "btn btn-primary btn-lg", onclick: nextRP }, [
          "繼續",
        ]),
        el("button", { class: "btn", onclick: speakMyLine }, ["再唸一次"]),
      ]),
    );
  }

  mount(host, ...body);
}

/* ---------------- 自由對話 (LLM) ---------------- */

async function free(root) {
  const cfg = await settings();
  if (!cfg.apiKey) {
    mount(
      root,
      backButton("對話", "#/talk"),
      emptyState("還沒設定 API key", "自由對話需要你自己的金鑰"),
      el("a", { class: "btn btn-primary btn-block", href: "#/settings" }, [
        "前往設定",
      ]),
    );
    return;
  }

  const scenarioId = sessionStorage.getItem("scenario") || "";
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);

  ctx = {
    kind: "free",
    cfg,
    scenario,
    msgs: [], // {role, content} sent to the model
    ui: [], // rendered bubbles
    busy: false,
    watch: stopwatch("talk"),
  };

  mount(
    root,
    el("div", { class: "trainer-top" }, [
      backButton("對話", "#/talk"),
      el("div", {
        class: "muted",
        text: scenario ? scenario.title : "自由聊天",
      }),
    ]),
    el("div", { class: "chat", id: "chat" }),
    composer(),
  );

  pushUI(
    "sys",
    scenario
      ? `情境:${scenario.title} · 用英文開口,聽不懂可以說 "say that again"`
      : "用英文跟我聊天吧。可以打字,也可以按麥克風說。",
  );

  // The tutor opens so the learner never faces a blank screen.
  send("__START__", true);
}

function composer() {
  const ta = el("textarea", {
    id: "input",
    rows: 1,
    placeholder: "用英文打字,或按麥克風說…",
    onkeydown: (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    oninput: (e) => {
      e.target.style.height = "auto";
      e.target.style.height = Math.min(130, e.target.scrollHeight) + "px";
    },
  });

  const mic = el("button", {
    class: "mic",
    id: "mic",
    title: "按住說話",
    onclick: toggleMic,
    html: '<svg viewBox="0 0 24 24"><path d="M12 3.5a2.6 2.6 0 0 1 2.6 2.6v5.4a2.6 2.6 0 1 1-5.2 0V6.1A2.6 2.6 0 0 1 12 3.5z"/><path d="M5.8 11a6.2 6.2 0 0 0 12.4 0"/><path d="M12 17.2V21"/></svg>',
  });

  return el("div", { class: "composer" }, [
    ta,
    mic,
    el("button", {
      class: "mic",
      style:
        "background:var(--accent);color:var(--accent-ink);border-color:var(--accent)",
      onclick: submit,
      title: "送出",
      html: '<svg viewBox="0 0 24 24"><path d="m4 12 16-7-7 16-2.2-6.8z"/></svg>',
    }),
  ]);
}

function submit() {
  const ta = document.getElementById("input");
  const text = ta.value.trim();
  if (!text || ctx.busy) return;
  ta.value = "";
  ta.style.height = "auto";
  send(text);
}

async function toggleMic() {
  if (!asrSupported()) {
    toast("這個瀏覽器不支援語音辨識,請用打字");
    return;
  }
  const mic = document.getElementById("mic");

  if (ctx.asr) {
    ctx.asr.stop();
    return;
  }

  cancelSpeech();
  mic.classList.add("is-rec");
  const ta = document.getElementById("input");
  ctx.asr = listenASR({
    lang: ctx.cfg.accentLang,
    interim: (t) => {
      ta.value = t;
    },
  });

  let heard = "";
  try {
    heard = await ctx.asr.promise;
  } catch {
    heard = ta.value;
  }
  ctx.asr = null;
  mic.classList.remove("is-rec");
  if (!ctx) return;

  ta.value = heard || ta.value;
  if (ta.value.trim()) submit();
}

function pushUI(kind, text, opts = {}) {
  const chatEl = document.getElementById("chat");
  if (!chatEl) return null;
  const node = el("div", { class: `msg msg-${kind}` }, [text]);
  if (kind === "ai" && opts.speakable) {
    node.append(
      el(
        "button",
        {
          class: "msg-play",
          onclick: () => speakAI(text),
        },
        ["🔊 再聽一次"],
      ),
    );
  }
  chatEl.append(node);
  node.scrollIntoView({ block: "end", behavior: "smooth" });
  return node;
}

async function speakAI(text) {
  unlock();
  cancelSpeech();
  try {
    await say(text, {
      langCode: ctx.cfg.accentLang,
      voiceURI: ctx.cfg.accent,
      rate: ctx.cfg.normalRate,
    });
  } catch {
    /* ignore */
  }
}

async function send(text, isOpener = false) {
  if (ctx.busy) return;
  ctx.busy = true;

  if (!isOpener) {
    pushUI("me", text);
    ctx.msgs.push({ role: "user", content: text });
  } else {
    ctx.msgs.push({
      role: "user",
      content: "Greet me and start the conversation.",
    });
  }

  const chatEl = document.getElementById("chat");
  const typing = el("div", {
    class: "msg msg-ai typing",
    html: "<i></i><i></i><i></i>",
  });
  chatEl?.append(typing);
  typing.scrollIntoView({ block: "end", behavior: "smooth" });

  ctx.abort = new AbortController();
  try {
    const raw = await chat_(ctx, ctx.abort.signal);
    typing.remove();
    const { reply, fix } = parseTurn(raw);

    ctx.msgs.push({ role: "assistant", content: raw });
    pushUI("ai", reply, { speakable: true });
    if (fix) pushUI("fix", `💡 ${fix}`);
    speakAI(reply);

    // Keep the request small; the model only needs recent context.
    if (ctx.msgs.length > 20) ctx.msgs = ctx.msgs.slice(-16);
  } catch (e) {
    typing.remove();
    if (e.name === "AbortError") return;
    const msg = e instanceof LlmError ? e.message : e.message || "請求失敗";
    pushUI("sys", `⚠️ ${msg}`);
    if (
      e instanceof LlmError &&
      (e.code === "auth" || e.code === "no-key" || e.code === "no-model")
    ) {
      const chatBox = document.getElementById("chat");
      chatBox?.append(
        el(
          "a",
          {
            class: "btn btn-block",
            href: "#/settings",
            style: "margin-top:6px",
          },
          ["去設定"],
        ),
      );
    }
  } finally {
    ctx.busy = false;
    ctx.abort = null;
  }
}

function chat_(c, signal) {
  return chat(c.cfg, {
    system: tutorSystem({
      level: c.cfg.talkLevel,
      corrections: c.cfg.corrections,
      scenario: c.scenario?.en || "",
    }),
    messages: c.msgs,
    signal,
  });
}
