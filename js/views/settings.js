/* 設定 — voice/accent, training preferences, conversation API, data. */

import { el, toast, confirmBox, mount } from "../ui.js";
import { settings, setSetting, DEFAULTS } from "../store.js";
import {
  loadVoices,
  voicesFor,
  ACCENTS,
  say,
  hasAudio,
  cancel as cancelSpeech,
  unlock,
  ttsSupported,
  voiceCoverage,
} from "../tts.js";
import { forLang, pickVoice, describeAuto, AUTO } from "../voices.js";
import { asrSupported } from "../asr.js";
import { recorderSupported } from "../recorder.js";
import {
  PROVIDERS,
  modelsFor,
  defaultModelFor,
  testKey,
  LlmError,
} from "../llm.js";
import { kvGet, wipeAll } from "../db.js";
import {
  estimate,
  offlineSize,
  clearOffline,
  isPersisted,
  requestPersistence,
  fmtBytes,
  needsHomeScreenPrompt,
  isIos,
  isStandalone,
  cacheSupported,
} from "../storage.js";

export function destroy() {
  cancelSpeech();
}

const SAMPLE = "The quick brown fox jumps over the lazy dog.";
const SAMPLE_LESSON_TEXT = "Hi there, I'm Ben. Are you new here?";

export async function render(root) {
  const cfg = await settings();
  await loadVoices();

  mount(
    root,
    el("h1", { text: "設定" }),

    el("h2", { text: "語音" }),
    await accentSection(cfg),

    el("h2", { text: "訓練" }),
    trainingSection(cfg),

    el("h2", { text: "自由對話" }),
    apiSection(cfg),

    el("h2", { text: "裝置支援" }),
    supportSection(),

    el("h2", { text: "離線與儲存" }),
    storageSection(),

    el("h2", { text: "資料" }),
    dataSection(),

    el("p", { class: "muted center", style: "margin-top:28px" }, [
      "Echo · 所有紀錄與 API key 只存在這台裝置",
    ]),
  );
}

/* ---------- voice ---------- */

async function accentSection(cfg) {
  const box = el("div", { class: "card" });

  /* A voice set only exists for a lesson if it was pre-generated, so the picker
     shows what is actually there rather than a matrix of plausible-looking
     combinations. Accents with no generated set still work — they fall back to
     whatever voice the device itself has. */
  const accentRow = el(
    "div",
    { class: "chips" },
    ACCENTS.map((a) => {
      const sets = forLang(a.code);
      const deviceOnly = sets.length === 0;
      return el(
        "button",
        {
          class: `chip ${cfg.accentLang === a.code ? "is-on" : ""}`,
          style: deviceOnly ? "opacity:.55" : "",
          title: deviceOnly
            ? "沒有預生成音檔,會用裝置內建語音"
            : `${sets.length} 種聲音`,
          onclick: async () => {
            const next = { accentLang: a.code, accent: "" };
            // A voice belongs to one accent; switching accent invalidates it.
            if (
              cfg.voice !== AUTO &&
              !forLang(a.code).some((v) => v.id === cfg.voice)
            ) {
              next.voice = AUTO;
            }
            await setSetting(next);
            toast(`已切換到${a.label}`);
            render(document.getElementById("view"));
          },
        },
        [
          a.label,
          deviceOnly
            ? el("span", { style: "opacity:.6", text: " ·裝置" })
            : null,
        ],
      );
    }),
  );

  const sets = forLang(cfg.accentLang);
  const { total, counts } = await voiceCoverage();
  const deviceVoices = voicesFor(cfg.accentLang);

  const picker = el(
    "select",
    {
      onchange: async (e) => {
        await setSetting({ voice: e.target.value });
        preview();
      },
    },
    [
      el("option", { value: AUTO, selected: cfg.voice === AUTO }, [
        "自動(依課程難度)",
      ]),
      ...sets.map((v) =>
        el(
          "option",
          {
            value: v.id,
            selected: cfg.voice === v.id,
          },
          [`${v.label} — ${v.engine} · ${v.wpm} wpm${packNote(v.id, counts, total)}`],
        ),
      ),
    ],
  );

  const chosen = sets.find((v) => v.id === cfg.voice);

  const preview = async () => {
    const c = await settings();
    const voice = pickVoice(c.voice, c.accentLang, 3);
    unlock();
    cancelSpeech();
    try {
      // Sample a real lesson clip so you hear the actual voice set, not the
      // device's stand-in reading a pangram.
      const ok = voice && (await hasAudio("l1-01", "s1", voice.id));
      await say(ok ? SAMPLE_LESSON_TEXT : SAMPLE, {
        lessonId: ok ? "l1-01" : undefined,
        sentenceId: ok ? "s1" : undefined,
        voiceId: voice?.id || "",
        langCode: c.accentLang,
        voiceURI: c.accent,
        rate: c.normalRate,
      });
    } catch {
      toast("這個語音無法播放");
    }
  };

  box.append(
    el("div", { class: "field" }, [el("label", { text: "口音" }), accentRow]),

    el("div", { class: "field" }, [
      el("label", { text: "聲音" }),
      picker,
      el("div", { class: "hint" }, [
        cfg.voice === AUTO
          ? describeAuto(cfg.accentLang)
          : chosen?.note ||
            `${chosen?.engine || ""} · ${chosen?.wpm || ""} wpm`,
      ]),
      sets.length === 0
        ? el("div", { class: "hint", style: "color:var(--warn)" }, [
            "這個口音沒有預生成音檔,會使用裝置內建語音。" +
              (deviceVoices.length
                ? ""
                : "而這台裝置也沒有這個口音的語音,請改選其他口音。"),
          ])
        : null,
    ]),

    el("button", { class: "btn btn-block", onclick: preview }, ["🔊 試聽"]),

    el("p", { class: "hint", style: "margin-top:12px" }, [
      "真人錄音的課程不受這裡影響 —— 那是實際的錄音,沒有另一個版本可以選。",
    ]),
  );
  return box;
}

/* ---------- training ---------- */

function trainingSection(cfg) {
  const box = el("div", { class: "card" });

  const slider = (label, key, min, max, step, fmt) => {
    const out = el("span", { class: "muted", text: fmt(cfg[key]) });
    return el("div", { class: "field" }, [
      el("label", {}, [label, " ", out]),
      el("input", {
        type: "range",
        min,
        max,
        step,
        value: cfg[key],
        oninput: (e) => {
          out.textContent = fmt(+e.target.value);
        },
        onchange: async (e) => {
          await setSetting({ [key]: +e.target.value });
        },
      }),
    ]);
  };

  box.append(
    slider(
      "正常語速",
      "normalRate",
      0.7,
      1.3,
      0.05,
      (v) => `${Math.round(v * 100)}%`,
    ),
    slider(
      "慢速",
      "slowRate",
      0.4,
      0.9,
      0.05,
      (v) => `${Math.round(v * 100)}%`,
    ),
    slider("每日目標", "dailyGoalMin", 5, 120, 5, (v) => `${v} 分鐘`),
    toggle("顯示中文翻譯", "對答案時一起顯示中文", cfg.showZh, (v) =>
      setSetting({ showZh: v }),
    ),
  );
  return box;
}

function toggle(label, sub, value, onChange) {
  const input = el("input", {
    type: "checkbox",
    checked: value,
    onchange: async (e) => {
      await onChange(e.target.checked);
    },
  });
  return el("div", { class: "switch-row" }, [
    el("div", { class: "lbl" }, [
      label,
      sub ? el("small", { text: sub }) : null,
    ]),
    el("label", { class: "switch" }, [input, el("span")]),
  ]);
}

/* ---------- conversation API ---------- */

function apiSection(cfg) {
  const box = el("div", { class: "card" });

  const modelField = el("div", { class: "field" });
  const keyInput = el("input", {
    type: "password",
    value: cfg.apiKey,
    placeholder: "貼上你的 API key",
    autocomplete: "off",
    spellcheck: "false",
    onchange: async (e) => {
      await setSetting({ apiKey: e.target.value.trim() });
    },
  });

  const baseField = el(
    "div",
    { class: "field", style: cfg.provider === "custom" ? "" : "display:none" },
    [
      el("label", { text: "API 網址" }),
      el("input", {
        type: "url",
        value: cfg.baseUrl,
        placeholder: "https://example.com",
        onchange: async (e) => {
          await setSetting({ baseUrl: e.target.value.trim() });
        },
      }),
      el("div", { class: "hint" }, [
        "需為 OpenAI 相容的 /v1/chat/completions 端點。",
      ]),
    ],
  );

  function paintModels(provider, current) {
    const list = modelsFor(provider);
    mount(
      modelField,
      el("label", { text: "模型" }),
      list.length
        ? el(
            "select",
            {
              onchange: async (e) => {
                await setSetting({ model: e.target.value });
              },
            },
            list.map((m) =>
              el(
                "option",
                {
                  value: m.id,
                  selected: (current || defaultModelFor(provider)) === m.id,
                },
                [`${m.label}${m.price !== "—" ? `  ${m.price}` : ""}`],
              ),
            ),
          )
        : el("input", {
            value: current,
            placeholder: "模型名稱",
            onchange: async (e) => {
              await setSetting({ model: e.target.value.trim() });
            },
          }),
      el("div", { class: "hint" }, [
        "價格為每百萬 token 的輸入 / 輸出費用。對話練習每次約幾分美金以下。",
      ]),
    );
  }
  paintModels(cfg.provider, cfg.model);

  const status = el("p", { class: "hint", style: "margin-top:10px" });

  box.append(
    el("p", { style: "margin-bottom:14px" }, [
      "自由對話需要你自己的 API key。金鑰只存在這台裝置,直接送到你選的服務商,不經過任何中間伺服器。",
    ]),

    el("div", { class: "field" }, [
      el("label", { text: "服務商" }),
      el(
        "select",
        {
          onchange: async (e) => {
            const p = e.target.value;
            const model = defaultModelFor(p);
            await setSetting({
              provider: p,
              model,
              baseUrl: p === "custom" ? cfg.baseUrl : "",
            });
            baseField.style.display = p === "custom" ? "" : "none";
            paintModels(p, model);
          },
        },
        Object.entries(PROVIDERS).map(([k, v]) =>
          el("option", { value: k, selected: cfg.provider === k }, [v.label]),
        ),
      ),
      PROVIDERS[cfg.provider]?.keyUrl
        ? el("div", { class: "hint" }, [
            "申請金鑰:",
            el(
              "a",
              {
                href: PROVIDERS[cfg.provider].keyUrl,
                target: "_blank",
                rel: "noopener",
                style: "color:var(--accent)",
              },
              [PROVIDERS[cfg.provider].keyUrl],
            ),
          ])
        : null,
    ]),

    baseField,
    el("div", { class: "field" }, [el("label", { text: "API key" }), keyInput]),
    modelField,

    el("div", { class: "field" }, [
      el("label", { text: "對話程度" }),
      el(
        "select",
        {
          onchange: async (e) => {
            await setSetting({ talkLevel: +e.target.value });
          },
        },
        [1, 2, 3, 4, 5].map((n) =>
          el(
            "option",
            {
              value: n,
              selected: cfg.talkLevel === n,
            },
            [
              `L${n} — ${["最簡單", "簡單", "自然", "流利", "母語速度"][n - 1]}`,
            ],
          ),
        ),
      ),
    ]),

    toggle("即時糾正", "講錯時附上一句中文提示", cfg.corrections, (v) =>
      setSetting({ corrections: v }),
    ),

    el(
      "button",
      {
        class: "btn btn-block",
        style: "margin-top:14px",
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = "測試中…";
          status.textContent = "";
          try {
            await testKey(await settings());
            status.style.color = "var(--good)";
            status.textContent = "✓ 連線成功,可以開始對話了。";
          } catch (err) {
            status.style.color = "var(--bad)";
            status.textContent =
              "✕ " +
              (err instanceof LlmError ? err.message : err.message || "失敗");
          }
          btn.disabled = false;
          btn.textContent = "測試連線";
        },
      },
      ["測試連線"],
    ),
    status,
  );
  return box;
}

/* ---------- capability report ---------- */

function supportSection() {
  const rows = [
    ["語音朗讀 (TTS)", ttsSupported(), "聽力訓練的核心"],
    ["語音辨識 (ASR)", asrSupported(), "跟讀評分與口說對話"],
    ["麥克風錄音", recorderSupported(), "跟讀 A/B 比對"],
  ];
  return el(
    "div",
    { class: "card" },
    rows.map(([name, ok, why]) =>
      el("div", { class: "switch-row" }, [
        el("div", { class: "lbl" }, [name, el("small", { text: why })]),
        el("span", {
          style: `color:${ok ? "var(--good)" : "var(--bad)"};font-size:19px`,
          text: ok ? "✓" : "✕",
        }),
      ]),
    ),
  );
}

/* ---------- storage ---------- */

function storageSection() {
  const box = el("div", { class: "card" });
  const usageLine = el("p", {
    class: "hint",
    style: "margin:0",
    text: "計算中…",
  });
  const offlineLine = el("p", {
    class: "hint",
    style: "margin:6px 0 0",
    text: "",
  });

  async function refresh() {
    const [est, off, persisted] = await Promise.all([
      estimate(),
      cacheSupported() ? offlineSize() : { count: 0, bytes: 0 },
      isPersisted(),
    ]);
    usageLine.textContent = est
      ? `已使用 ${fmtBytes(est.usage)}${est.quota ? ` / 可用 ${fmtBytes(est.quota)}` : ""}`
      : "這個瀏覽器不提供儲存空間資訊";
    offlineLine.textContent = off.count
      ? `其中離線音檔 ${off.count} 段,約 ${fmtBytes(off.bytes)}`
      : "尚未下載任何離線音檔";
    persistLine.textContent = persisted
      ? "✓ 瀏覽器已承諾不會自動清除這個 app 的資料"
      : "⚠ 資料可能在儲存空間不足時被清除";
    persistLine.style.color = persisted ? "var(--good)" : "var(--warn)";
  }

  const persistLine = el("p", { class: "hint", style: "margin:10px 0 0" });

  box.append(
    el("p", { style: "margin-bottom:12px" }, [
      "課程音檔只在你播放或按下載時才會存到裝置,不會一次全部抓下來。",
    ]),
    usageLine,
    offlineLine,
    persistLine,

    el(
      "button",
      {
        class: "btn btn-block",
        style: "margin-top:14px",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          const ok = await requestPersistence();
          toast(
            ok
              ? "已申請持久化儲存"
              : "瀏覽器沒有授予持久化(iOS 請改用加入主畫面)",
          );
          e.currentTarget.disabled = false;
          refresh();
        },
      },
      ["申請持久化儲存"],
    ),

    el(
      "button",
      {
        class: "btn btn-block",
        style: "margin-top:10px",
        onclick: async () => {
          if (
            !(await confirmBox(
              "清除所有已下載的離線音檔?課程本身和學習紀錄都會保留。",
              "清除音檔",
            ))
          )
            return;
          await clearOffline();
          toast("已清除離線音檔");
          refresh();
        },
      },
      ["清除離線音檔"],
    ),

    isIos()
      ? el("p", { class: "hint", style: "margin-top:12px" }, [
          isStandalone()
            ? "✓ 這是從主畫面啟動的,iOS 不會在七天後清除你的紀錄。"
            : "⚠ 你正用 Safari 直接開啟。iOS 會在七天沒使用後清除網站資料 — 請用「分享 → 加入主畫面」安裝,才不會遺失練習紀錄。",
        ])
      : null,
  );

  refresh();
  return box;
}

/* ---------- data ---------- */

function dataSection() {
  return el("div", { class: "card" }, [
    el(
      "button",
      {
        class: "btn btn-block",
        onclick: async () => {
          const { db } = await import("../db.js");
          // settings() hands back the live module cache, so deleting the key off
          // the dump used to delete it off the running app too — the next setting
          // you touched wrote the key-less object back to IndexedDB, and exporting
          // a backup silently destroyed the very key it was protecting.
          const { apiKey, ...safeSettings } = await settings();
          const dump = {
            exportedAt: new Date().toISOString(),
            settings: safeSettings, // never write the key into a shareable file
            cards: await db.all("cards"),
            sessions: await db.all("sessions"),
            lessons: await db.all("lessons"),
            dailyCompletions: await kvGet("dailyCompletions", {}),
          };
          const blob = new Blob([JSON.stringify(dump, null, 2)], {
            type: "application/json",
          });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `echo-backup-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          toast("已匯出(不含 API key)");
        },
      },
      ["匯出學習紀錄"],
    ),

    el(
      "button",
      {
        class: "btn btn-danger btn-block",
        style: "margin-top:10px",
        onclick: async () => {
          if (
            !(await confirmBox(
              "清除所有學習紀錄、匯入的文章與設定?這個動作無法復原。",
              "全部清除",
            ))
          )
            return;
          await wipeAll();
          toast("已清除");
          location.hash = "#/";
          location.reload();
        },
      },
      ["清除所有資料"],
    ),

    el("p", { class: "hint", style: "margin-top:12px" }, [
      `預設每日目標 ${DEFAULTS.dailyGoalMin} 分鐘。學習紀錄存在瀏覽器的 IndexedDB;清除瀏覽器資料會一併刪除,建議偶爾匯出備份。`,
    ]),
  ]);
}

/* An accent pack is generated on demand, so it can be absent or cover only the
   lessons that existed when it was last run. Saying so beats letting the
   learner pick an accent and hear a different one. */
function packNote(voiceId, counts, total) {
  const have = counts.get(voiceId) || 0;
  if (!total || have >= total) return "";
  if (!have) return " · 尚未產生";
  return ` · 只有 ${have}/${total} 課`;
}
