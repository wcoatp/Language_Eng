/* SDD-002: optional, audio-first vocabulary preparation. */
import { el, mount, backButton } from '../ui.js';
import { getLesson } from '../content.js';
import { say, cancel, unlock } from '../tts.js';
import { prepareQueue, progressFor, wordStatus } from '../learning.js';
import { getLearningProgress, saveLearning } from '../learning-store.js';
import { openLookup } from '../word-lookup.js';

let ctx = null;
let epoch = 0;
export function destroy() { epoch++; ctx = null; cancel(); }

export async function render(root, id) {
  const token = ++epoch;
  const lesson = await getLesson(id);
  if (token !== epoch) return;
  if (!lesson.learning) {
    mount(root, backButton('回課程', `#/lesson/${encodeURIComponent(id)}`), el('h1', { text: '這課尚未編輯字詞預習' }),
      el('a', { class: 'btn', href: `#/listen/${encodeURIComponent(id)}` }, ['直接開始精聽']));
    return;
  }
  let progress;
  let error = '';
  try { progress = await getLearningProgress(lesson); }
  catch { progress = progressFor(lesson); error = '裝置紀錄無法讀取；仍可預習，儲存結果可能失敗。'; }
  if (token !== epoch) return;
  ctx = { root, lesson, progress, queue: prepareQueue(lesson, progress), at: 0, error, mode: 'remaining', run: 0 };
  resetCard(); paint(false);
}

function resetCard() {
  cancel(); ctx.run++; ctx.revealed = false; ctx.heard = null;
  ctx.played = false; ctx.speaking = false; ctx.saving = false; ctx.lookupOpened = false;
}

function lookupWord(word) {
  const state = ctx;
  if (!state) return;
  const sentence = state.lesson.sentences.find(item => item.id === word.sentenceIds?.[0]);
  const trigger = state.root.querySelector('[data-preparation-lookup]');
  openLookup(word.surface, { lessonId: state.lesson.id, sentenceId: sentence?.id || '',
    lessonTitle: state.lesson.title, text: sentence?.text || '', zh: sentence?.zh || '' }, { trigger,
    onResolved: () => {
      if (ctx !== state || state.queue[state.at]?.id !== word.id) return;
      state.lookupOpened = true; paint(false);
    } });
}

async function play(text) {
  const state = ctx;
  if (!state || state.speaking) return;
  unlock(); cancel();
  const run = ++state.run;
  state.speaking = true; state.error = ''; paint(false);
  try {
    // No lesson/sentence IDs: this must never play a full sentence clip.
    await say(text, { langCode: 'en-US', rate: 0.85 });
    if (ctx === state && state.run === run) state.played = true;
  } catch {
    if (ctx === state && state.run === run) state.error = '目前無法播放裝置英語語音；可直接看字，不會記作聽懂。';
  } finally {
    if (ctx === state && state.run === run) { state.speaking = false; paint(false); }
  }
}

function reveal(heard) {
  const state = ctx;
  state.run++; cancel(); state.speaking = false;
  state.heard = state.played ? heard : 'unavailable'; state.revealed = true; paint();
}

async function rate(read) {
  const state = ctx;
  if (!state || state.saving || !state.revealed) return;
  const word = state.queue[state.at];
  state.saving = true; state.error = ''; paint(false);
  try {
    const progress = await saveLearning(state.lesson, 'vocabulary', word.id, { heard: state.heard, read });
    if (ctx !== state) return;
    state.progress = progress; state.at++; resetCard(); paint();
  } catch {
    if (ctx === state) { state.saving = false; state.error = '這一項尚未儲存，請重試；也可直接開始精聽。'; paint(); }
  }
}

function restart(mode) {
  ctx.mode = mode; ctx.queue = prepareQueue(ctx.lesson, ctx.progress, mode); ctx.at = 0;
  ctx.error = ''; resetCard(); paint();
}

function paint(focus = true) {
  const s = ctx;
  if (!s) return;
  const focusedText = s.root.contains(document.activeElement) ? document.activeElement.textContent : null;
  const word = s.queue[s.at];
  const core = s.lesson.learning.vocabulary.filter(w => !w.optional);
  const counts = core.reduce((out, w) => { out[wordStatus(s.progress.vocabulary[w.id])]++; return out; },
    { heard: 0, reading: 0, practice: 0, unseen: 0 });
  mount(s.root,
    backButton('回課程', `#/lesson/${encodeURIComponent(s.lesson.id)}`),
    el('h1', { text: '課前字詞預習', tabindex: '-1' }),
    el('p', { class: 'sub', text: s.lesson.titleZh || s.lesson.title }),
    el('p', { class: 'learning-objective', text: s.lesson.learning.objectiveZh }),
    s.lesson.learning.automatic ? el('p', { class: 'hint', text: '這份清單由本機規則自動挑選，未經逐詞人工編輯；不會上傳課文。內建詞可直接看解釋，其餘請按查詞確認。' }) : null,
    el('p', { class: 'hint', text: '可隨時跳過，約 2–3 分鐘。結果是自評，不會改變句子熟練度。發音使用裝置語音；離線是否有聲取決於已安裝的英語語音。' }),
    s.error ? el('p', { class: 'learning-error', role: 'alert', text: s.error }) : null,
    word ? el('section', { class: 'card preparation-card', 'aria-label': '字詞卡' }, [
      el('p', { class: 'stage-hint', text: `${s.mode === 'extra' ? '補充' : '核心'} ${s.at + 1} / ${s.queue.length}` }),
      !s.revealed ? [
        el('h2', { text: '先聽，再想意思' }),
        el('button', { class: 'btn btn-primary btn-block', disabled: s.speaking,
          onclick: () => play(word.surface) }, [s.speaking ? '播放中…' : '▶ 播放字詞']),
        el('div', { class: 'learning-actions' }, [
          el('button', { class: 'btn', disabled: !s.played || s.speaking, onclick: () => reveal('yes') }, ['先聽就懂']),
          el('button', { class: 'btn', disabled: !s.played || s.speaking, onclick: () => reveal('hint') }, ['需要文字提示']),
        ]),
        el('button', { class: 'btn btn-ghost btn-block', onclick: () => reveal('unavailable') }, ['直接看字 · 不記聽辨']),
      ] : [
        el('h2', { class: 'preparation-term', text: word.surface }),
        word.term !== word.surface ? el('p', { class: 'hint', text: `原形：${word.term}` }) : null,
        el('p', { class: 'preparation-meaning', text: word.zh }),
        el('p', { text: word.en }),
        el('div', { class: 'learning-example' }, [el('b', { text: word.example }), el('p', { text: word.exampleZh })]),
        el('div', { class: 'learning-actions' }, [
          el('button', { class: 'btn', disabled: s.speaking, onclick: () => play(word.surface) }, ['▶ 再聽字詞']),
          el('button', { class: 'btn', disabled: s.speaking, onclick: () => play(word.example) }, ['▶ 聽搭配']),
        ]),
        word.automatic ? el('button', { class: 'btn btn-block', 'data-preparation-lookup': '',
          onclick: () => lookupWord(word) }, [word.lookupRequired ? '查英中／英英後再自評' : '查看完整英中／英英查詞']) : null,
        word.lookupRequired && !s.lookupOpened ? el('p', { class: 'hint', text: '這個自動候選尚無內建詞義；請在查詞視窗取得解釋後，再記錄文字理解。' }) : null,
        el('p', { class: 'hint', text: '試著跟讀一次，再記錄看到文字後是否理解。這裡不播放故事來源句。' }),
        el('div', { class: 'learning-actions' }, [
          el('button', { class: 'btn btn-primary', disabled: s.saving || (word.lookupRequired && !s.lookupOpened), onclick: () => rate('known') }, ['看字也懂 · 下一項']),
          el('button', { class: 'btn', disabled: s.saving || (word.lookupRequired && !s.lookupOpened), onclick: () => rate('practice') }, ['仍需練習 · 下一項']),
        ]),
      ],
    ].flat()) : el('section', { class: 'card' }, [
      el('h2', { text: '暖身紀錄' }),
      el('p', { text: `核心 ${core.length} 項：先聽就懂 ${counts.heard} · 看字才懂／未測聽辨 ${counts.reading} · 仍需練習 ${counts.practice} · 尚未作答 ${counts.unseen}` }),
      el('p', { class: 'hint', text: '這是字詞自評，不等於課文已聽懂。已保存的項目可隨時重練。' }),
      el('div', { class: 'learning-actions' }, [
        el('button', { class: 'btn', onclick: () => restart('review') }, ['重練尚未聽熟的詞']),
        el('button', { class: 'btn', onclick: () => restart('all') }, ['重練全部核心詞']),
        s.lesson.learning.vocabulary.some(w => w.optional)
          ? el('button', { class: 'btn', onclick: () => restart('extra') }, [`加練補充 ${s.lesson.learning.vocabulary.filter(w => w.optional).length} 詞`]) : null,
      ]),
    ]),
    el('a', { class: 'btn btn-primary btn-block', href: `#/listen/${encodeURIComponent(s.lesson.id)}` }, [word ? '跳過其餘 · 開始精聽' : '開始精聽課文']),
  );
  if (focus || focusedText) {
    const control = !focus && [...s.root.querySelectorAll('button,a')].find(node => node.textContent === focusedText && !node.disabled);
    (control || s.root.querySelector('h1'))?.focus({ preventScroll: true });
  }
}
