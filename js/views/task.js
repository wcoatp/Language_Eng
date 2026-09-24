/* SDD-002: fixed role cards, progressively revealed hints and honest self-rating. */
import { el, mount, backButton } from '../ui.js';
import { getLesson } from '../content.js';
import { say, cancel, unlock } from '../tts.js';
import { getLearningProgress, saveLearning } from '../learning-store.js';

let ctx = null;
let epoch = 0;
export function destroy() { epoch++; ctx = null; cancel(); }

export async function render(root, id) {
  const token = ++epoch;
  const lesson = await getLesson(id);
  if (token !== epoch) return;
  if (!lesson.learning?.task) {
    mount(root, backButton('回課程', `#/lesson/${encodeURIComponent(id)}`), el('h1', { text: '這課尚未編輯換條件任務' })); return;
  }
  let previous;
  try { previous = (await getLearningProgress(lesson)).tasks[lesson.learning.task.id]; } catch { /* saving errors remain explicit */ }
  if (token !== epoch) return;
  ctx = { root, lesson, at: 0, support: 'none', prompted: false, sample: false, run: 0, previous };
  paint(false);
}

async function play(text) {
  const state = ctx;
  if (state.speaking) return;
  const run = ++state.run;
  state.speaking = true; state.error = ''; unlock(); cancel(); paint(false);
  try { await say(text, { langCode: 'en-US', rate: 0.85 }); }
  catch { if (ctx === state && state.run === run) state.error = '裝置語音暫不可用，仍可讀搭檔台詞或請同伴朗讀。'; }
  finally { if (ctx === state && state.run === run) { state.speaking = false; paint(false); } }
}

async function rate(rating) {
  const state = ctx;
  if (state.saving) return;
  state.saving = true; state.error = ''; paint(false);
  try {
    const progress = await saveLearning(state.lesson, 'task', state.lesson.learning.task.id, { rating, prompted: state.prompted });
    if (ctx !== state) return;
    state.previous = progress.tasks[state.lesson.learning.task.id]; state.saved = true;
  } catch { if (ctx === state) state.error = '這次自評尚未儲存，請再試一次。'; }
  finally { if (ctx === state) { state.saving = false; paint(); } }
}

const labels = { independent: '獨立完成', prompted: '看提示完成', practice: '還需練習' };
function paint(focus = true) {
  const s = ctx;
  if (!s) return;
  const focusedText = s.root.contains(document.activeElement) ? document.activeElement.textContent : null;
  const task = s.lesson.learning.task;
  const step = task.steps[s.at];
  mount(s.root,
    backButton('回課程', `#/lesson/${encodeURIComponent(s.lesson.id)}`),
    el('h1', { text: task.titleZh, tabindex: '-1' }),
    el('p', { class: 'sub', text: task.roleZh }),
    el('p', { class: 'learning-objective', text: task.setupZh }),
    el('p', { class: 'hint', text: '固定角色卡自練，不是 AI 對話。請自己開口，說完再按下一步；App 不會錄音、辨識或判斷你說得對不對。意思正確的其他說法也可以。搭檔使用裝置語音。' }),
    s.previous ? el('p', { class: 'hint', text: `最近一次自評：${labels[s.previous.rating] || '尚未記錄'}` }) : null,
    s.error ? el('p', { class: 'learning-error', role: 'alert', text: s.error }) : null,
    step ? el('section', { class: 'card' }, [
      el('p', { class: 'stage-hint', text: `第 ${s.at + 1} / ${task.steps.length} 回合` }),
      el('h2', { text: '店員說' }),
      el('p', { class: 'task-partner', text: step.partner }),
      el('button', { class: 'btn', disabled: s.speaking, onclick: () => play(step.partner) }, ['▶ 聽店員']),
      el('h2', { text: '換你說' }),
      el('p', { text: step.promptZh }),
      el('div', { class: 'learning-actions', role: 'group', 'aria-label': '提示程度' },
        [['none', '只有任務'], ['keywords', '看關鍵字'], ['frame', '看句架']].map(([mode, label]) =>
          el('button', { class: `chip ${s.support === mode ? 'is-on' : ''}`, 'aria-pressed': String(s.support === mode), onclick: () => {
            s.support = mode; if (mode !== 'none') s.prompted = true; paint();
          } }, [label]))),
      s.support !== 'none' ? el('p', { class: 'learning-example', text: step[s.support] }) : null,
      s.sample ? el('div', { class: 'learning-example' }, [el('p', { text: `一種說法：${step.sample}` }),
        el('button', { class: 'btn', disabled: s.speaking, onclick: () => play(step.sample) }, ['▶ 聽示例'])])
        : el('button', { class: 'btn btn-ghost', onclick: () => { s.sample = true; s.prompted = true; paint(); } }, ['卡住了 · 看一種說法']),
      el('button', { class: 'btn btn-primary btn-block', onclick: () => {
        cancel(); s.run++; s.speaking = false; s.at++; s.sample = false; paint();
      } }, [s.at === task.steps.length - 1 ? '我說完了 · 看成功條件' : '我說完了 · 下一回合']),
    ]) : el('section', { class: 'card' }, [
      el('h2', { text: s.saved ? '自評已儲存' : '回想剛才的溝通' }),
      el('ul', {}, task.success.map(text => el('li', { text }))),
      el('p', { class: 'hint', text: s.prompted ? '這輪看過提示或示例，完成時會記為「看提示完成」。重練時可再挑戰獨立完成。' : '請依實際表現自評；按過下一步不代表完成任務，也沒有自動口說評分。' }),
      !s.saved ? el('div', { class: 'learning-actions' }, Object.entries(labels).map(([value, label]) =>
        el('button', { class: 'btn', disabled: s.saving || (value === 'independent' && s.prompted), onclick: () => rate(value) }, [label])))
        : el('button', { class: 'btn', onclick: () => { s.at = 0; s.support = 'none'; s.prompted = false; s.saved = false; paint(); } }, ['換成不看提示再練一次']),
    ]),
    el('a', { class: 'btn btn-block', href: `#/talk/rp:${encodeURIComponent(s.lesson.id)}` }, ['需要更多支援 · 回原課角色扮演']),
  );
  if (focus || focusedText) {
    const control = !focus && [...s.root.querySelectorAll('button,a')].find(node => node.textContent === focusedText && !node.disabled);
    (control || s.root.querySelector('h1'))?.focus({ preventScroll: true });
  }
}
