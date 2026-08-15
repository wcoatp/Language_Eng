/* 今天 — the daily dashboard. The headline number is cumulative practice time,
   because that is the metric that actually predicts progress. */

import { el, mount } from "../ui.js";
import { stats, settings, fmtDuration } from '../store.js';
import { dueCount, allLessonProgress } from '../srs.js';
import { allLessons } from '../content.js';
import { kvGet, kvSet } from '../db.js';
import { needsHomeScreenPrompt, requestPersistence } from '../storage.js';
import {
  dailyLessonForDate,
  formatDailyDate,
  isDailyLesson,
  isDailyComplete,
  localDateKey,
} from '../daily.js';

const GOAL_HOURS = 1000;

export async function render(root) {
  const [s, cfg, due, lessons, prog, lastId, dailyCompletions] = await Promise.all([
    stats(), settings(), dueCount(), allLessons(), allLessonProgress(), kvGet('lastLesson'),
    kvGet('dailyCompletions', {}),
  ]);

  const hours = s.totalSeconds / 3600;
  const goalSec = cfg.dailyGoalMin * 60;
  const todayPct = Math.min(100, (s.todaySeconds / goalSec) * 100);

  const started = new Set(prog.keys());
  const daily = dailyLessonForDate(lessons);
  const regularLessons = lessons.filter((lesson) => !isDailyLesson(lesson));
  const next = regularLessons.find(l => l.id === lastId && (prog.get(l.id)?.learned || 0) < l.count)
    || regularLessons.filter(l => !started.has(l.id)).sort((a, b) => a.level - b.level)[0]
    || regularLessons[0];

  // Chrome grants persistence silently; on iOS only installing actually helps.
  requestPersistence();

  mount(root, 
    await iosInstallBanner(),
    el('h1', { text: '今天' }),
    el('p', { class: 'sub', text: greeting(s) }),

    daily ? dailyCard(daily,
      isDailyComplete(daily, prog.get(daily.id), dailyCompletions)) : null,

    // --- 1000 hour counter ---
    el('a', { class: 'hero card-tap', href: '#/progress', style: 'display:block;text-decoration:none' }, [
      el('div', { class: 'hero-num' }, [
        hours < 10 ? hours.toFixed(1) : Math.floor(hours).toString(),
        el('small', { text: `/ ${GOAL_HOURS} 小時` }),
      ]),
      el('div', { class: 'hero-label', text: '累積練習時數' }),
      el('div', { class: 'bar' }, [el('i', { style: `width:${Math.min(100, (hours / GOAL_HOURS) * 100)}%` })]),
    ]),

    // --- today ---
    el('div', { class: 'card' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline' }, [
        el('h3', { style: 'margin:0', text: '今天的目標' }),
        el('span', { class: 'muted',
          text: `${Math.round(s.todaySeconds / 60)} / ${cfg.dailyGoalMin} 分` }),
      ]),
      el('div', { class: 'bar' }, [el('i', { style: `width:${todayPct}%` })]),
      todayPct >= 100
        ? el('p', { class: 'muted', style: 'margin:10px 0 0', text: '今天的份完成了 — 多練都是賺到的。' })
        : null,
    ]),

    el('div', { class: 'stat-row' }, [
      stat(s.streak, '連續天數'),
      stat(due, '待複習'),
      stat(started.size, '練過的課'),
    ]),

    // --- actions ---
    due > 0 ? el('a', { class: 'btn btn-primary btn-lg btn-block', href: '#/review',
      style: 'margin-bottom:10px' }, [`複習 ${due} 個句子`]) : null,

    next ? el('a', { class: 'card card-tap', href: `#/lesson/${encodeURIComponent(next.id)}` }, [
      el('div', { class: 'muted', style: 'margin-bottom:7px',
        text: lastId === next.id ? '繼續上次的課' : '接下來' }),
      el('div', { class: 'lesson-head' }, [
        el('span', { class: `badge badge-l${next.level}`, text: `L${next.level}` }),
        el('span', { class: 'lesson-title', text: next.title }),
      ]),
      el('div', { class: 'lesson-zh', text: next.titleZh || next.summaryZh || '' }),
      el('div', { class: 'lesson-meta' }, [
        el('span', { text: `${next.count} 句` }),
        el('span', { text: next.type === 'dialogue' ? '對話' : '短文' }),
      ]),
    ]) : el('div', { class: 'card' }, [
      el('p', { style: 'margin:0' }, ['還沒有課程內容。']),
      el('a', { class: 'btn btn-block', href: '#/import', style: 'margin-top:10px' }, ['匯入我的文章']),
    ]),

    el('a', { class: 'btn btn-ghost btn-block', href: '#/talk', style: 'margin-top:10px' },
      ['🗣 練對話']),
  );
}

function dailyCard(lesson, done) {
  const exact = lesson.daily.date === localDateKey();
  return el('div', { class: 'daily-home-wrap' }, [
    el('a', {
      class: 'card card-tap daily-home',
      href: `#/lesson/${encodeURIComponent(lesson.id)}`,
    }, [
      el('div', { class: 'lesson-head' }, [
        el('span', { class: 'badge badge-daily', text: exact ? '今日課程' : '最新課程' }),
        el('span', { class: `badge badge-l${lesson.level}`, text: `L${lesson.level}` }),
        done ? el('span', { class: 'badge badge-done', text: '完成' }) : null,
        el('span', { class: 'muted daily-home-date', text: formatDailyDate(lesson.daily.date) }),
      ]),
      el('div', { class: 'daily-home-title', text: lesson.title }),
      el('div', { class: 'lesson-zh', text: lesson.titleZh }),
      el('p', { class: 'daily-home-summary', text: lesson.summaryZh }),
      el('div', { class: 'lesson-meta' }, [
        el('span', { text: lesson.daily.seriesTitleZh }),
        el('span', { text: `第 ${lesson.daily.day}/${lesson.daily.totalDays} 日` }),
        el('span', { text: `${lesson.wordCount || 500} 字` }),
      ]),
    ]),
    el('a', { class: 'daily-schedule-link', href: '#/daily' }, ['查看完整每日課表 →']),
  ]);
}

/* On iOS a plain Safari tab loses all its storage after seven days idle, so
   this is a data-loss warning, not an install advert. Shown once, dismissible. */
async function iosInstallBanner() {
  if (!needsHomeScreenPrompt()) return null;
  if (await kvGet('hideInstallHint', false)) return null;

  return el('div', {
    class: 'card',
    style: 'border-color:color-mix(in srgb,var(--warn) 45%,var(--line));' +
           'background:color-mix(in srgb,var(--warn) 8%,var(--surface))',
  }, [
    el('div', { style: 'font-weight:600;margin-bottom:6px', text: '請加入主畫面' }),
    el('p', { class: 'hint', style: 'margin:0 0 10px' },
      ['iOS 會清除七天沒使用的網站資料,你的練習紀錄和累積時數都會不見。' +
       '按下方分享鈕選「加入主畫面」,資料才會長期保留。']),
    el('button', {
      class: 'btn btn-ghost', style: 'min-height:38px;font-size:13px',
      onclick: async e => {
        await kvSet('hideInstallHint', true);
        e.currentTarget.closest('.card').remove();
      },
    }, ['知道了,不再提醒']),
  ]);
}

function stat(n, label) {
  return el('div', { class: 'stat' }, [
    el('b', { text: String(n) }),
    el('span', { text: label }),
  ]);
}

function greeting(s) {
  const h = new Date().getHours();
  const when = h < 5 ? '深夜好' : h < 11 ? '早安' : h < 14 ? '午安' : h < 18 ? '下午好' : '晚安';
  if (!s.days) return `${when} — 從第一課開始吧。`;
  if (s.todaySeconds > 0) return `${when} — 今天已經練了 ${fmtDuration(s.todaySeconds)}。`;
  if (s.streak > 0) return `${when} — 連續 ${s.streak} 天,別斷在今天。`;
  return `${when} — 回來練幾分鐘吧。`;
}
