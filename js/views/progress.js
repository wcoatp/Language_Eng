/* 進度 — the long view. Practice hours are the metric that matters. */

import { el, backButton, mount } from "../ui.js";
import { stats, settings, fmtDuration, todayKey } from '../store.js';
import { allLessonProgress } from '../srs.js';
import { allLessons } from '../content.js';
import { db } from '../db.js';

const GOAL_HOURS = 1000;

export async function render(root) {
  const [s, cfg, prog, lessons, sessions] = await Promise.all([
    stats(), settings(), allLessonProgress(), allLessons(), db.all('sessions'),
  ]);

  const hours = s.totalSeconds / 3600;
  const byMode = new Map();
  for (const r of sessions) byMode.set(r.mode, (byMode.get(r.mode) || 0) + r.seconds);

  const cards = [...prog.values()];
  const learned = cards.reduce((n, p) => n + p.learned, 0);
  const seen = cards.reduce((n, p) => n + p.seen, 0);
  const doneLessons = lessons.filter(l => (prog.get(l.id)?.learned || 0) >= l.count).length;

  const active = [...s.byDay.values()];
  const avg = active.length ? s.totalSeconds / active.length : 0;
  const daysLeft = avg > 0 ? Math.ceil((GOAL_HOURS * 3600 - s.totalSeconds) / avg) : null;

  mount(root, 
    backButton('今天', '#/'),
    el('h1', { style: 'margin-top:12px', text: '進度' }),

    el('div', { class: 'hero' }, [
      el('div', { class: 'hero-num' }, [
        hours < 10 ? hours.toFixed(1) : Math.floor(hours).toString(),
        el('small', { text: `/ ${GOAL_HOURS} 小時` }),
      ]),
      el('div', { class: 'hero-label', text: '一千小時之路' }),
      el('div', { class: 'bar' }, [el('i', { style: `width:${Math.min(100, (hours / GOAL_HOURS) * 100)}%` })]),
      el('p', { class: 'muted', style: 'margin:12px 0 0' }, [
        s.days
          ? `練習過 ${s.days} 天,平均每天 ${fmtDuration(avg)}${
              daysLeft && daysLeft < 40000 ? ` · 照這個速度還需要約 ${Math.round(daysLeft / 365 * 10) / 10} 年` : ''}`
          : '還沒開始 — 今天練十分鐘就是起點。',
      ]),
    ]),

    el('div', { class: 'stat-row' }, [
      stat(s.streak, '連續天數'),
      stat(doneLessons, '完成課程'),
      stat(learned, '掌握句數'),
    ]),

    el('h2', { text: '最近 12 週' }),
    heatmap(s.byDay),

    el('h2', { text: '時間分配' }),
    el('div', { class: 'card' }, [
      ...['listen', 'review', 'talk'].map(mode => {
        const secs = byMode.get(mode) || 0;
        const pct = s.totalSeconds ? (secs / s.totalSeconds) * 100 : 0;
        return el('div', { style: 'margin-bottom:14px' }, [
          el('div', { style: 'display:flex;justify-content:space-between;font-size:14px' }, [
            el('span', { text: { listen: '聽力訓練', review: '複習', talk: '對話' }[mode] }),
            el('span', { class: 'muted', text: secs ? fmtDuration(secs) : '—' }),
          ]),
          el('div', { class: 'bar', style: 'margin-top:6px' }, [el('i', { style: `width:${pct}%` })]),
        ]);
      }),
      seen ? el('p', { class: 'hint', style: 'margin:4px 0 0' },
        [`練過 ${seen} 個句子,其中 ${learned} 句已標記為掌握。`]) : null,
    ]),

    el('h2', { text: '每日目標' }),
    el('div', { class: 'card' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline' }, [
        el('span', { text: `今天 ${Math.round(s.todaySeconds / 60)} 分` }),
        el('span', { class: 'muted', text: `目標 ${cfg.dailyGoalMin} 分` }),
      ]),
      el('div', { class: 'bar' }, [
        el('i', { style: `width:${Math.min(100, (s.todaySeconds / (cfg.dailyGoalMin * 60)) * 100)}%` }),
      ]),
      el('a', { class: 'btn btn-block', style: 'margin-top:14px', href: '#/settings' }, ['調整目標']),
    ]),
  );
}

function stat(n, label) {
  return el('div', { class: 'stat' }, [el('b', { text: String(n) }), el('span', { text: label })]);
}

function heatmap(byDay) {
  const WEEKS = 12;
  const today = new Date();
  // Align the grid so each column is a full Sun–Sat week.
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));

  const cells = [];
  const max = Math.max(600, ...byDay.values());

  for (let w = WEEKS - 1; w >= 0; w--) {
    const col = el('div', { style: 'display:flex;flex-direction:column;gap:3px' });
    for (let d = 0; d < 7; d++) {
      const date = new Date(end);
      date.setDate(end.getDate() - (w * 7 + (6 - d)));
      const key = todayKey(date);
      const secs = byDay.get(key) || 0;
      const future = date > today;
      const intensity = secs ? 0.25 + 0.75 * Math.min(1, secs / max) : 0;
      col.append(el('div', {
        title: `${key} · ${secs ? fmtDuration(secs) : '沒練習'}`,
        style: `width:100%;aspect-ratio:1;border-radius:3px;${
          future ? 'opacity:.15;background:var(--surface-2)'
                 : secs ? `background:color-mix(in srgb, var(--accent) ${Math.round(intensity * 100)}%, var(--surface-2))`
                        : 'background:var(--surface-2)'}${
          key === todayKey() ? ';outline:1.5px solid var(--accent);outline-offset:1px' : ''}`,
      }));
    }
    cells.push(col);
  }

  return el('div', { class: 'card' }, [
    el('div', { style: `display:grid;grid-template-columns:repeat(${WEEKS},1fr);gap:3px` }, cells),
    el('div', { class: 'hint', style: 'margin-top:10px;display:flex;justify-content:space-between' }, [
      el('span', { text: '12 週前' }),
      el('span', { text: '今天' }),
    ]),
  ]);
}
