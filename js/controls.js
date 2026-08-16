/* The listening controls sheet — accent, voice, speed, translation.

   These are the three things a learner reaches for *while* a lesson is
   playing, which is exactly when the settings screen is out of reach. Nothing
   that is set once belongs here: this is not a second settings page, and two
   places to change the same value is how they drift apart.

   One sheet serves the trainer and the continuous player. Both already have a
   container that never scrolls away — the trainer does not scroll at all, and
   the player's control card is sticky — so this opens from a chip in those,
   rather than adding a floating layer of its own. */

import { el, mount } from "./ui.js";
import { setSetting } from "./store.js";
import { ACCENTS, voicesForLesson, scaleRate } from "./tts.js";
import { AUTO, byId, forLang, describeAuto, pickVoice } from "./voices.js";

export const SPEED_STEPS = [0.8, 0.9, 1, 1.1, 1.25];

let sheet = null;

export function closeControls() {
  sheet?.remove();
  sheet = null;
  document.removeEventListener("keydown", onKey);
}

function onKey(e) {
  if (e.key === "Escape") closeControls();
}

/** Short label for the chip that opens this, e.g. 「美式 · 自然」. */
export function currentVoiceLabel(cfg, lesson) {
  if (lesson?.realAudio) return "真人錄音";
  const voice = pickVoice(cfg.voice, cfg.accentLang, lesson?.level ?? 3);
  if (!voice) return "裝置語音";
  return cfg.voice === AUTO ? `${voice.label} · 自動` : voice.label;
}

/**
 * Open the controls sheet.
 * @param {object}   o
 * @param {object}   o.cfg       current settings
 * @param {object}   o.lesson    lesson in play, for availability and real-audio
 * @param {(cfg:object, changed:string)=>void} o.onChange
 */
export async function openControls({ cfg, lesson, onChange }) {
  closeControls();
  // Which sets actually have this lesson: the accent packs are generated on
  // demand, so offering all eleven and quietly substituting would be a lie.
  const available = lesson?.realAudio ? [] : await voicesForLesson(lesson?.id);

  const backdrop = el("div", {
    class: "sheet-backdrop",
    onclick: closeControls,
  });
  const panel = el("div", {
    class: "sheet",
    onclick: (e) => e.stopPropagation(),
  });
  sheet = el("div", { class: "sheet-wrap" }, [backdrop, panel]);
  document.body.append(sheet);
  document.addEventListener("keydown", onKey);
  // Flush layout so the transition has a start state to animate from. A
  // requestAnimationFrame would be the usual trick, but it never fires while
  // the tab is hidden — and then the sheet stays parked off-screen forever.
  void sheet.offsetHeight;
  sheet.classList.add("is-on");

  const apply = async (patch, changed) => {
    cfg = await setSetting(patch);
    onChange?.(cfg, changed);
    paint();
  };

  function paint() {
    mount(
      panel,
      el("div", { class: "sheet-grip" }),
      lesson?.realAudio ? realAudioNote() : accentRow(),
      lesson?.realAudio ? null : voiceList(),
      speedRow(),
      zhRow(),
    );
  }

  function realAudioNote() {
    return el("div", { class: "sheet-note" }, [
      el("b", { text: "這課是真人錄音" }),
      el("span", {
        text: "只有這一個版本,沒有其他口音或聲音可以選。速度仍然可以調。",
      }),
    ]);
  }

  function accentRow() {
    return el("div", { class: "sheet-section" }, [
      el("div", { class: "sheet-label", text: "口音" }),
      el(
        "div",
        { class: "chips" },
        ACCENTS.map((a) =>
          el(
            "button",
            {
              class: `chip ${cfg.accentLang === a.code ? "is-on" : ""}`,
              onclick: () => {
                const patch = { accentLang: a.code };
                // A voice belongs to one accent; keep auto rather than a
                // selection that no longer exists in the new one.
                if (
                  cfg.voice !== AUTO &&
                  !forLang(a.code).some((v) => v.id === cfg.voice)
                ) {
                  patch.voice = AUTO;
                }
                apply(patch, "voice");
              },
            },
            [a.label],
          ),
        ),
      ),
    ]);
  }

  function voiceList() {
    const sets = forLang(cfg.accentLang);
    const rows = sets.map((v) => {
      const here = !available.length || available.includes(v.id);
      return el(
        "button",
        {
          class: `sheet-row ${cfg.voice === v.id ? "is-on" : ""}`,
          onclick: () => apply({ voice: v.id }, "voice"),
        },
        [
          el("div", { class: "sheet-row-main" }, [
            el("b", { text: v.label }),
            el("small", { text: `${v.engine} · ${v.wpm} wpm` }),
          ]),
          here
            ? el("span", {
                class: "sheet-tick",
                text: cfg.voice === v.id ? "✓" : "",
              })
            : el("small", { class: "muted", text: "這課沒有" }),
        ],
      );
    });
    return el("div", { class: "sheet-section" }, [
      el("div", { class: "sheet-label", text: "聲音" }),
      ...rows,
      el(
        "button",
        {
          class: `sheet-row ${cfg.voice === AUTO ? "is-on" : ""}`,
          onclick: () => apply({ voice: AUTO }, "voice"),
        },
        [
          el("div", { class: "sheet-row-main" }, [
            el("b", { text: "自動" }),
            el("small", { text: describeAuto(cfg.accentLang) }),
          ]),
          el("span", {
            class: "sheet-tick",
            text: cfg.voice === AUTO ? "✓" : "",
          }),
        ],
      ),
      sets.length === 0
        ? el("div", { class: "sheet-note" }, [
            el("span", { text: "這個口音沒有預生成音檔,會用其他口音代替。" }),
          ])
        : null,
    ]);
  }

  function speedRow() {
    const steps = [...new Set([...SPEED_STEPS, cfg.normalRate])].sort(
      (a, b) => a - b,
    );
    return el("div", { class: "sheet-section" }, [
      el("div", { class: "sheet-label", text: "語速" }),
      el(
        "div",
        { class: "chips" },
        steps.map((r) =>
          el(
            "button",
            {
              class: `chip ${Math.abs(cfg.normalRate - r) < 0.001 ? "is-on" : ""}`,
              onclick: () => {
                // Scale the clip already playing, so the change lands on the
                // sentence being struggled with rather than on the next one.
                // The element's rate was computed from this preference and the
                // voice's own pace, so it moves by the same ratio.
                scaleRate(r / (cfg.normalRate || 1));
                apply({ normalRate: r }, "rate");
              },
            },
            [`${r}x`],
          ),
        ),
      ),
    ]);
  }

  function zhRow() {
    const input = el("input", {
      type: "checkbox",
      checked: !!cfg.showZh,
      onchange: (e) => apply({ showZh: e.target.checked }, "showZh"),
    });
    return el("div", { class: "sheet-section switch-row" }, [
      el("div", { class: "lbl" }, [
        "中文翻譯",
        el("small", { text: "對答案時一起顯示" }),
      ]),
      el("label", { class: "switch" }, [input, el("span")]),
    ]);
  }

  paint();
}
