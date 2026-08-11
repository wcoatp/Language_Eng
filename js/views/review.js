/* 複習 — spaced repetition over the sentences you struggled with.
   Listening-first: the sentence is played before it is shown. */

import { el, emptyState, toast, backButton, mount } from "../ui.js";
import { dueCards, grade } from '../srs.js';
import { getLesson } from '../content.js';
import { settings, stopwatch } from '../store.js';
import { say, cancel as cancelSpeech, unlock } from '../tts.js';

let ctx = null;

export function destroy() {
  cancelSpeech();
  ctx?.watch?.stop();
  ctx = null;
}

export async function render(root) {
  const [cards, cfg] = await Promise.all([dueCards(30), settings()]);

  if (!cards.length) {
    mount(root, 
      el('h1', { text: '複習' }),
      emptyState('目前沒有到期的句子', '練完課程後,沒掌握的句子會排進這裡'),
      el('a', { class: 'btn btn-block', href: '#/library' }, ['去練新課']),
    );
    return;
  }

  // Cards store their own text, so a review never needs the lesson file —
  // but load what we can so audio clips and speaker context still work.
  const lessons = new Map();
  for (const id of new Set(cards.map(c => c.lessonId))) {
    try { lessons.set(id, await getLesson(id)); } catch { /* imported lesson deleted */ }
  }

  ctx = { cards, cfg, lessons, i: 0, shown: false, done: 0, watch: stopwatch('review') };
  mount(root, el('div', { id: 'rev' }));
  paint();
  play();
}

function card() { return ctx.cards[ctx.i]; }

function sentenceOf(c) {
  const lesson = ctx.lessons.get(c.lessonId);
  return lesson?.sentences.find(s => s.id === c.sentenceId) || { id: c.sentenceId, text: c.text || '' };
}

async function play() {
  const c = card();
  if (!c) return;
  const s = sentenceOf(c);
  if (!s.text) return;
  unlock();
  cancelSpeech();
  document.getElementById('revwave')?.classList.add('is-on');
  try {
    await say(s.text, {
      lessonId: c.lessonId, sentenceId: c.sentenceId,
      langCode: ctx.cfg.accentLang, voiceURI: ctx.cfg.accent, rate: ctx.cfg.normalRate,
    });
  } catch { /* silent — the text is still on screen */ }
  document.getElementById('revwave')?.classList.remove('is-on');
}

async function answer(g) {
  const c = card();
  await grade(c.lessonId, c.sentenceId, g);
  ctx.done++;
  ctx.shown = false;
  if (ctx.i >= ctx.cards.length - 1) return finish();
  ctx.i++;
  paint();
  play();
}

async function finish() {
  const secs = await ctx.watch.stop();
  ctx.watch = null;
  const host = document.getElementById('rev');
  host && mount(host, 
    el('div', { class: 'hero', style: 'text-align:center' }, [
      el('div', { style: 'font-size:38px' }, ['✅']),
      el('h1', { style: 'margin-top:6px', text: '複習完成' }),
      el('p', { style: 'margin:0' },
        [`${ctx.done} 個句子 · ${Math.max(1, Math.round(secs / 60))} 分鐘`]),
    ]),
    el('a', { class: 'btn btn-primary btn-lg btn-block', href: '#/library' }, ['去練新課']),
    el('a', { class: 'btn btn-ghost btn-block', href: '#/', style: 'margin-top:9px' }, ['回到今天']),
  );
  toast('複習紀錄已更新');
}

function paint() {
  const host = document.getElementById('rev');
  if (!host || !ctx) return;
  const c = card();
  const s = sentenceOf(c);
  const lesson = ctx.lessons.get(c.lessonId);

  const wave = el('div', { class: 'wave', id: 'revwave' });
  for (let n = 0; n < 8; n++) wave.append(el('i'));

  mount(host, 
    el('div', { class: 'trainer-top' }, [
      backButton('離開', '#/'),
      el('div', { class: 'muted', text: `${ctx.i + 1} / ${ctx.cards.length}` }),
    ]),
    el('div', { class: 'stage' }, [
      el('div', { class: 'stage-hint', text: ctx.shown ? '對答案' : '這句在說什麼?' }),
      el('p', { class: `sentence ${ctx.shown ? '' : 'is-hidden'}`, text: s.text }),
      ctx.shown && ctx.cfg.showZh && s.zh ? el('p', { class: 'sentence-zh', text: s.zh }) : null,
      ctx.shown && s.note ? el('div', { class: 'sentence-note', text: s.note }) : null,
      wave,
      ctx.shown && lesson
        ? el('div', { class: 'muted center', style: 'margin-top:10px', text: lesson.title })
        : null,
    ]),
    ctx.shown
      ? el('div', { class: 'rate-row' }, [
          el('button', { class: 'btn', onclick: () => answer(0) },
            [el('b', { text: '沒聽懂' }), el('span', { class: 'muted', text: '10 分鐘後' })]),
          el('button', { class: 'btn', onclick: () => answer(1) },
            [el('b', { text: '勉強' }), el('span', { class: 'muted', text: '過幾天' })]),
          el('button', { class: 'btn btn-primary', onclick: () => answer(2) },
            [el('b', { text: '掌握了' }), el('span', { style: 'opacity:.75', text: '排更遠' })]),
        ])
      : el('div', { class: 'actions' }, [
          el('button', { class: 'btn btn-primary btn-lg', onclick: () => { ctx.shown = true; paint(); } },
            ['顯示答案']),
          el('button', { class: 'btn', onclick: play }, ['再聽一次']),
        ]),
  );
}
