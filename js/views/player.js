/* Continuous listening: play a whole lesson or any individually selected lines. */

import { getLesson, loadIndex } from '../content.js';
import { settings, logTime } from '../store.js';
import { voiceIdForLesson } from '../voices.js';
import { say, cancel as cancelSpeech, unlock } from '../tts.js';
import { PLAYBACK_GAPS, PLAYBACK_RATES, playbackSequence } from '../playback.js';
import { el, toast, backButton, sleep, mount } from '../ui.js';
import { kvGet, kvSet } from '../db.js';
import { completesDailyPlayback, isDailyComplete, STORY_BEATS } from '../daily.js';

let ctx = null;

export function destroy() {
  if (!ctx) return;
  ctx.run++;
  cancelSpeech();
  logElapsed(ctx);
  ctx = null;
}

export async function render(root, lessonId) {
  const [lesson, cfg, index, completions] = await Promise.all([
    getLesson(lessonId), settings(), loadIndex(), kvGet('dailyCompletions', {}),
  ]);
  const nextDaily = lesson.daily
    ? index.find((item) => item.daily?.seriesId === lesson.daily.seriesId &&
      item.daily.day === lesson.daily.day + 1)
    : null;
  ctx = {
    root,
    lesson,
    cfg,
    mode: 'all',
    selected: new Set(lesson.sentences.map((sentence) => sentence.id)),
    rate: cfg.normalRate || 1,
    gap: 500,
    playing: false,
    currentId: null,
    run: 0,
    startedAt: 0,
    completed: isDailyComplete(lesson, null, completions),
    nextDaily,
  };
  paint();
}

function chosen(state = ctx) {
  return playbackSequence(state.lesson.sentences, state.mode, state.selected);
}

function logElapsed(state) {
  if (!state.startedAt) return;
  const seconds = (performance.now() - state.startedAt) / 1000;
  state.startedAt = 0;
  logTime(seconds, 'listen', state.lesson.id).catch(() => {});
}

function stop() {
  if (!ctx) return;
  ctx.run++;
  ctx.playing = false;
  ctx.currentId = null;
  cancelSpeech();
  logElapsed(ctx);
  paint();
}

async function play() {
  const state = ctx;
  if (!state) return;
  if (state.playing) { stop(); return; }

  const sequence = chosen(state);
  if (!sequence.length) {
    toast('請至少選一句');
    return;
  }

  unlock();
  state.playing = true;
  state.startedAt = performance.now();
  const token = ++state.run;
  let failed = false;
  paint();

  for (const [i, sentence] of sequence.entries()) {
    if (ctx !== state || state.run !== token) return;
    state.currentId = sentence.id;
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
      if (ctx === state && state.run === token) toast(error.message || '播放失敗');
      failed = true;
      break;
    }
    if (ctx !== state || state.run !== token) return;
    if (state.gap && i < sequence.length - 1) await sleep(state.gap);
  }

  if (ctx !== state || state.run !== token) return;
  state.playing = false;
  state.currentId = null;
  logElapsed(state);
  const dailyComplete = !failed && completesDailyPlayback(state.lesson, sequence);
  if (dailyComplete) {
    const completions = await kvGet('dailyCompletions', {});
    completions[state.lesson.id] = Date.now();
    await kvSet('dailyCompletions', completions);
    state.completed = true;
  }
  if (ctx !== state || state.run !== token) return;
  paint();
  if (!failed) toast(dailyComplete ? '今日課程完成' : '播放完成');
}

function setMode(mode) {
  if (!ctx || ctx.playing) return;
  ctx.mode = mode;
  paint();
}

function toggle(id, checked) {
  if (!ctx || ctx.playing) return;
  if (checked) ctx.selected.add(id);
  else ctx.selected.delete(id);
  paint();
}

function setAll(selected) {
  if (!ctx || ctx.playing) return;
  ctx.selected = new Set(selected ? ctx.lesson.sentences.map((sentence) => sentence.id) : []);
  paint();
}

function paint(scrollCurrent = false) {
  const state = ctx;
  if (!state) return;
  const sequence = chosen(state);
  const currentIndex = state.currentId
    ? sequence.findIndex((sentence) => sentence.id === state.currentId)
    : -1;
  const rates = [...new Set([state.cfg.normalRate || 1, ...PLAYBACK_RATES])]
    .sort((a, b) => a - b);

  mount(state.root,
    el('div', { class: 'trainer-top' }, [
      backButton('課程', `#/lesson/${encodeURIComponent(state.lesson.id)}`),
      el('span', { class: 'muted', text: state.playing
        ? `${currentIndex + 1} / ${sequence.length}`
        : `${sequence.length} 句` }),
    ]),
    el('h1', { text: state.lesson.daily ? '每日課程閱讀' : '連續播放' }),
    el('p', { class: 'sub', text: `${state.lesson.title} · ${state.lesson.titleZh || ''}` }),

    el('div', { class: `player-controls card ${state.playing ? 'is-playing' : ''}` }, [
      el('div', { class: 'chips player-mode-row', style: 'margin-bottom:12px' }, [
        chip('完整課文', state.mode === 'all', () => setMode('all'), state.playing),
        chip('自訂選擇', state.mode === 'custom', () => setMode('custom'), state.playing),
      ]),
      el('div', { class: 'player-setting' }, [
        el('span', { class: 'muted', text: '速度' }),
        ...rates.map((rate) => chip(`${rate}x`, state.rate === rate, () => {
          if (state.playing) return;
          state.rate = rate;
          paint();
        }, state.playing)),
      ]),
      el('div', { class: 'player-setting' }, [
        el('span', { class: 'muted', text: '句間' }),
        ...PLAYBACK_GAPS.map((gap) => chip(gap ? `${gap / 1000} 秒` : '不停頓',
          state.gap === gap, () => {
            if (state.playing) return;
            state.gap = gap;
            paint();
          }, state.playing)),
      ]),
      el('button', {
        class: `btn ${state.playing ? 'btn-danger' : 'btn-primary'} btn-lg btn-block`,
        disabled: !state.playing && !sequence.length,
        onclick: state.playing ? stop : play,
      }, [state.playing ? '■ 停止播放'
        : sequence.length ? `▶ 播放 ${sequence.length} 句` : '請先選擇句子']),
    ]),

    state.completed && !state.playing ? el('section', { class: 'card daily-player-complete' }, [
      el('div', { class: 'badge badge-done', text: '今日完成' }),
      el('h2', { text: '故事已完整聽完' }),
      el('p', { text: state.nextDaily
        ? `接著閱讀「${state.nextDaily.title}」,看看故事如何發展。`
        : '你已完成這個主題的最後一日。' }),
      state.nextDaily ? el('a', {
        class: 'btn btn-primary btn-block',
        href: `#/lesson/${encodeURIComponent(state.nextDaily.id)}`,
      }, [`前往第 ${state.nextDaily.daily.day} 日`])
        : el('a', { class: 'btn btn-block', href: '#/daily' }, ['回到每日課表']),
    ]) : null,

    state.mode === 'custom' ? el('div', { class: 'player-selection-bar' }, [
      el('span', { class: 'muted', text: `已選 ${state.selected.size} / ${state.lesson.sentences.length}` }),
      el('div', { style: 'display:flex;gap:8px' }, [
        el('button', { class: 'btn btn-ghost player-small-btn', disabled: state.playing,
          onclick: () => setAll(true) }, ['全選']),
        el('button', { class: 'btn btn-ghost player-small-btn', disabled: state.playing,
          onclick: () => setAll(false) }, ['清除']),
      ]),
    ]) : null,

    el('div', { class: 'player-list' }, playerRows(state)),
  );

  if (scrollCurrent && state.currentId) {
    requestAnimationFrame(() => document.getElementById(`player-${state.currentId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
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
      out.push(el('div', { class: 'story-beat player-story-beat' }, [
        el('span', { text: beat.label }),
        el('b', { text: beat.description }),
      ]));
    }
    const selected = state.mode === 'all' || state.selected.has(sentence.id);
    const current = state.currentId === sentence.id;
    out.push(el('label', {
      id: `player-${sentence.id}`,
      class: `player-row card${current ? ' is-playing' : ''}${selected ? '' : ' is-muted'}`,
    }, [
      state.mode === 'custom' ? el('input', {
        type: 'checkbox',
        checked: state.selected.has(sentence.id),
        disabled: state.playing,
        onchange: (event) => toggle(sentence.id, event.target.checked),
      }) : el('span', { class: 'player-number', text: String(index + 1) }),
      el('div', { class: 'player-copy' }, [
        el('div', { style: 'display:flex;gap:8px;align-items:baseline' }, [
          sentence.speaker ? el('span', { class: 'badge', text: sentence.speaker }) : null,
          el('span', { text: sentence.text }),
        ]),
        state.cfg.showZh && sentence.zh
          ? el('div', { class: 'muted', style: 'margin-top:4px', text: sentence.zh }) : null,
      ]),
    ]));
  });
  return out;
}

function chip(label, active, onclick, disabled = false) {
  return el('button', {
    class: `chip ${active ? 'is-on' : ''}`,
    disabled,
    onclick,
  }, [label]);
}
