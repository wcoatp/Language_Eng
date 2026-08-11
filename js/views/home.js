/* 今天 — the daily dashboard. The headline number is cumulative practice time,
   because that is the metric that actually predicts progress. */

import { el, mount } from "../ui.js";
import { stats, settings, fmtDuration } from '../store.js';
import { dueCount, allLessonProgress } from '../srs.js';
import { allLessons } from '../content.js';
import { kvGet } from '../db.js';

const GOAL_HOURS = 1000;

export async function render(root) {
  const [s, cfg, due, lessons, prog, lastId] = await Promise.all([
    stats(), settings(), dueCount(), allLessons(), allLessonProgress(), kvGet('lastLesson'),
  ]);

  const hours = s.totalSeconds / 3600;
  const goalSec = cfg.dailyGoalMin * 60;
  const todayPct = Math.min(100, (s.todaySeconds / goalSec) * 100);

  const started = new Set(prog.keys());
  const next = lessons.find(l => l.id === lastId && (prog.get(l.id)?.learned || 0) < l.count)
    || lessons.filter(l => !started.has(l.id)).sort((a, b) => a.level - b.level)[0]
    || lessons[0];

  mount(root, 
    el('h1', { text: '今天' }),
    el('p', { class: 'sub', text: greeting(s) }),

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
