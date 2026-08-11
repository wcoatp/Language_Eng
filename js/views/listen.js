/* The training loop.

   Per sentence:  盲聽(原速) → 慢速 → 回原速 → 對答案 → 跟讀 → 評分
   The "back to normal speed" step is the point of the whole thing: it makes the
   ear map what it decoded slowly onto the real stream. */

import { el, toast, backButton, sleep, mount } from "../ui.js";
import { getLesson, rateFor } from '../content.js';
import { say, cancel as cancelSpeech, unlock } from '../tts.js';
import { settings } from '../store.js';
import { stopwatch } from '../store.js';
import { grade } from '../srs.js';
import { record, playBlob, stopPlayback, releaseMic, recorderSupported } from '../recorder.js';
import { listen as listenASR, asrSupported, scoreAttempt } from '../asr.js';

let ctx = null;

export function destroy() {
  if (!ctx) return;
  cancelSpeech();
  stopPlayback();
  releaseMic();
  ctx.rec?.cancel();
  ctx.asr?.abort();
  document.removeEventListener('keydown', ctx.onKey);
  ctx.watch?.stop();
  ctx = null;
}

export async function render(root, lessonId) {
  const [lesson, cfg] = await Promise.all([getLesson(lessonId), settings()]);

  ctx = {
    lesson,
    cfg,
    i: 0,
    stage: 'blind',
    rate: cfg.normalRate * rateFor(lesson.level),
    slowStep: 0,
    busy: false,
    attempt: null,
    blob: null,
    watch: stopwatch('listen', lesson.id),
    quiz: null,
    onKey: null,
  };

  ctx.onKey = e => {
    if (e.target.matches('input, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); replay(); }
    if (e.code === 'ArrowRight') { e.preventDefault(); next(); }
  };
  document.addEventListener('keydown', ctx.onKey);

  mount(root, el('div', { class: 'trainer', id: 'trainer' }));
  paint();
  // Autoplay is blocked until the user has interacted; the tap that opened the
  // lesson counts, so this normally just works.
  play();
}

/* ---------- helpers ---------- */

const sentences = () => ctx.lesson.sentences;
const cur = () => sentences()[ctx.i];

const SLOW_STEPS = [0.7, 0.55, 0.45];

function currentRate() {
  const base = ctx.cfg.normalRate * rateFor(ctx.lesson.level);
  if (ctx.stage === 'slow') return base * SLOW_STEPS[ctx.slowStep];
  return base;
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
      rate: currentRate(),
    });
  } catch (e) {
    toast('播放失敗:' + (e.message || '瀏覽器沒有可用的語音'));
  }
  setWave(false);
}

function setWave(on) {
  document.getElementById('wave')?.classList.toggle('is-on', on);
}

function replay() {
  if (ctx && !ctx.busy) play();
}

/* ---------- stage transitions ---------- */

function goto(stage) {
  ctx.stage = stage;
  cancelSpeech();
  paint();
  if (stage === 'blind' || stage === 'slow' || stage === 'again') play();
}

function harder() {
  if (ctx.stage !== 'slow') { ctx.slowStep = 0; goto('slow'); return; }
  if (ctx.slowStep < SLOW_STEPS.length - 1) { ctx.slowStep++; paint(); play(); }
  else toast('已經是最慢了');
}

async function next() {
  if (!ctx || ctx.busy) return;
  cancelSpeech();
  stopPlayback();
  ctx.blob = null;
  ctx.attempt = null;
  ctx.slowStep = 0;

  if (ctx.i >= sentences().length - 1) {
    if (ctx.lesson.questions?.length) { ctx.stage = 'quiz'; ctx.quiz = { at: 0, picked: null, right: 0 }; paint(); }
    else finish();
    return;
  }
  ctx.i++;
  goto('blind');
}

async function scoreAndNext(g) {
  const s = cur();
  await grade(ctx.lesson.id, s.id, g, { text: s.text, level: ctx.lesson.level });
  next();
}

async function finish() {
  const secs = await ctx.watch?.stop();
  ctx.watch = null;
  ctx.stage = 'done';
  ctx.doneSeconds = secs || 0;
  paint();
}

/* ---------- shadowing ---------- */

async function startShadow() {
  if (!recorderSupported()) { toast('這個瀏覽器不支援錄音'); return; }
  ctx.busy = true;
  ctx.blob = null;
  ctx.attempt = null;
  paint();

  try {
    ctx.rec = await record();
  } catch {
    ctx.busy = false;
    toast('沒有麥克風權限');
    paint();
    return;
  }

  // Recognition runs alongside the recording so one take gives both a
  // playback for A/B comparison and a rough word-match score.
  if (asrSupported()) {
    ctx.asr = listenASR({ lang: ctx.cfg.accentLang });
    ctx.asr.promise.catch(() => '');
  }
  ctx.stage = 'recording';
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
    const heard = await Promise.race([asr.promise.catch(() => ''), sleep(2500).then(() => '')]);
    if (heard) ctx.attempt = scoreAttempt(cur().text, heard);
  }

  ctx.busy = false;
  ctx.stage = 'compare';
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
  try { await playBlob(ctx.blob); } catch { toast('播放失敗'); }
  setWave(false);
}

async function playBoth() {
  await playOriginal();
  await sleep(350);
  await playMine();
}

/* ---------- rendering ---------- */

function paint() {
  const host = document.getElementById('trainer');
  if (!host || !ctx) return;
  mount(host, 
    header(),
    ctx.stage === 'quiz' ? quizStage()
      : ctx.stage === 'done' ? doneStage()
      : stage(),
    ctx.stage === 'quiz' || ctx.stage === 'done' ? '' : actions(),
  );
}

function header() {
  const total = sentences().length;
  const dots = el('div', { class: 'step-dots' });
  for (let n = 0; n < total; n++) {
    dots.append(el('i', { class: n < ctx.i ? 'done' : n === ctx.i ? 'now' : '' }));
  }
  return el('div', { class: 'trainer-top' }, [
    backButton('結束', `#/lesson/${encodeURIComponent(ctx.lesson.id)}`),
    el('div', { class: 'muted', style: 'font-variant-numeric:tabular-nums' },
      [`${Math.min(ctx.i + 1, total)} / ${total}`]),
    dots,
  ]);
}

const HINTS = {
  blind:     '原速 · 先不看字',
  slow:      '慢速 · 抓出每個字',
  again:     '再回原速 · 把它接起來',
  reveal:    '對答案',
  shadow:    '跟讀',
  recording: '錄音中',
  compare:   '比對',
};

function stage() {
  const s = cur();
  const hidden = ctx.stage === 'blind' || ctx.stage === 'slow' || ctx.stage === 'again';
  const showZh = ctx.cfg.showZh && !hidden;

  const wave = el('div', { class: 'wave', id: 'wave' });
  for (let n = 0; n < 8; n++) wave.append(el('i'));

  return el('div', { class: 'stage' }, [
    el('div', { class: 'stage-hint', text: HINTS[ctx.stage] || '' }),
    s.speaker ? el('div', { class: 'speaker-tag', text: s.speaker }) : null,
    el('p', { class: `sentence ${hidden ? 'is-hidden' : ''}`, text: s.text }),
    showZh ? el('p', { class: 'sentence-zh', text: s.zh || '' }) : null,
    !hidden && s.note ? el('div', { class: 'sentence-note', text: s.note }) : null,
    ctx.attempt ? scoreBar(ctx.attempt) : null,
    wave,
    ctx.stage === 'slow'
      ? el('div', { class: 'muted center', style: 'margin-top:8px',
          text: `${Math.round(SLOW_STEPS[ctx.slowStep] * 100)}% 速度` })
      : null,
  ]);
}

function scoreBar(a) {
  const tone = a.score >= 80 ? 'var(--good)' : a.score >= 55 ? 'var(--warn)' : 'var(--bad)';
  return el('div', { style: 'margin-top:14px;text-align:center' }, [
    el('div', { style: `font-size:30px;font-weight:700;color:${tone}`, text: `${a.score}` }),
    el('div', { class: 'muted', text: '語音辨識比對分數(僅供參考)' }),
    el('div', { style: 'margin-top:10px;font-size:14px;line-height:1.9' },
      a.words.map(w => el('span', {
        style: `padding:2px 5px;margin:0 1px;border-radius:5px;${
          w.ok ? '' : 'background:color-mix(in srgb,var(--bad) 22%,transparent);color:var(--bad)'}`,
        text: w.w,
      }))),
  ]);
}

function actions() {
  const box = el('div', { class: 'actions' });
  const btn = (label, cls, fn) => el('button', { class: `btn ${cls}`, onclick: fn }, [label]);

  switch (ctx.stage) {
    case 'blind':
      box.append(
        btn('聽懂了', 'btn-primary btn-lg', () => goto('reveal')),
        el('div', { class: 'btn-row' }, [
          btn('再聽一次', '', replay),
          btn('聽不懂 · 放慢', '', harder),
        ]),
      );
      break;

    case 'slow':
      box.append(
        btn('再回原速聽一次', 'btn-primary btn-lg', () => goto('again')),
        el('div', { class: 'btn-row' }, [
          btn('再聽一次', '', replay),
          btn('再慢一點', '', harder),
        ]),
      );
      break;

    case 'again':
      box.append(
        btn('看答案', 'btn-primary btn-lg', () => goto('reveal')),
        btn('再聽一次', '', replay),
      );
      break;

    case 'reveal':
      box.append(
        btn('跟讀這句', 'btn-primary btn-lg', () => { ctx.stage = 'shadow'; paint(); startShadow(); }),
        el('div', { class: 'btn-row' }, [
          btn('再聽一次', '', replay),
          btn('跳過 · 下一句', 'btn-ghost', () => scoreAndNext(2)),
        ]),
      );
      break;

    case 'shadow':
      box.append(el('div', { class: 'muted center' }, ['準備麥克風…']));
      break;

    case 'recording':
      box.append(
        btn('■ 錄好了', 'btn-primary btn-lg', stopShadow),
        el('div', { class: 'muted center', style: 'margin-top:2px' },
          ['照著剛剛聽到的唸一次,語調、連讀都模仿']),
      );
      break;

    case 'compare': {
      box.append(
        el('div', { class: 'btn-row' }, [
          btn('▶ 原音', '', playOriginal),
          btn('▶ 我的', '', playMine),
          btn('▶ 連續比對', '', playBoth),
        ]),
        el('div', { class: 'muted center', style: 'margin:8px 0 2px' }, ['這句你掌握得如何?']),
        el('div', { class: 'rate-row' }, [
          el('button', { class: 'btn', onclick: () => scoreAndNext(0) },
            [el('b', { text: '沒聽懂' }), el('span', { class: 'muted', text: '待會再來' })]),
          el('button', { class: 'btn', onclick: () => scoreAndNext(1) },
            [el('b', { text: '勉強' }), el('span', { class: 'muted', text: '明天複習' })]),
          el('button', { class: 'btn btn-primary', onclick: () => scoreAndNext(2) },
            [el('b', { text: '掌握了' }), el('span', { style: 'opacity:.75', text: '排到之後' })]),
        ]),
        btn('重錄', 'btn-ghost', startShadow),
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

  const opts = q.options.map((text, idx) => el('button', {
    class: `q-opt ${picked == null ? '' : idx === q.answer ? 'is-right' : idx === picked ? 'is-wrong' : ''}`,
    disabled: picked != null,
    onclick: () => {
      ctx.quiz.picked = idx;
      if (idx === q.answer) ctx.quiz.right++;
      paint();
    },
  }, [text]));

  return el('div', {}, [
    el('div', { class: 'card' }, [
      el('div', { class: 'stage-hint', style: 'text-align:left',
        text: `理解測驗 ${ctx.quiz.at + 1} / ${qs.length}` }),
      el('h3', { style: 'font-size:17px;margin:6px 0 14px', text: q.q }),
      ...opts,
      picked != null ? el('button', {
        class: 'btn btn-primary btn-block', style: 'margin-top:12px',
        onclick: () => {
          if (ctx.quiz.at >= qs.length - 1) finish();
          else { ctx.quiz.at++; ctx.quiz.picked = null; paint(); }
        },
      }, [ctx.quiz.at >= qs.length - 1 ? '看結果' : '下一題']) : null,
    ]),
  ]);
}

function doneStage() {
  const mins = Math.max(1, Math.round((ctx.doneSeconds || 0) / 60));
  const q = ctx.quiz;
  return el('div', {}, [
    el('div', { class: 'hero', style: 'text-align:center' }, [
      el('div', { style: 'font-size:40px' }, ['🎧']),
      el('h1', { style: 'margin-top:6px', text: '這課完成了' }),
      el('p', { style: 'margin-bottom:0' },
        [`練習 ${mins} 分鐘${q ? ` · 理解測驗答對 ${q.right}/${ctx.lesson.questions.length}` : ''}`]),
    ]),
    el('p', { class: 'muted center', style: 'margin-bottom:18px' },
      ['沒掌握的句子已經排進複習,明天會再出現。']),
    el('div', { class: 'actions' }, [
      el('a', { class: 'btn btn-primary btn-lg btn-block', href: '#/library' }, ['選下一課']),
      el('a', { class: 'btn btn-block', href: `#/listen/${encodeURIComponent(ctx.lesson.id)}`,
        onclick: () => setTimeout(() => location.reload(), 0) }, ['再練一次這課']),
      el('a', { class: 'btn btn-ghost btn-block', href: '#/' }, ['回到今天']),
    ]),
  ]);
}
