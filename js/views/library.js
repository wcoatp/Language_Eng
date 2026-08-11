/* 課程 — browse built-in lessons and imported articles. */

import { el, emptyState, mount } from "../ui.js";
import { allLessons, LEVELS, TOPICS } from '../content.js';
import { allLessonProgress } from '../srs.js';
import { kvGet, kvSet } from '../db.js';

let state = { level: 0, topic: '' };

export async function render(root) {
  state = { ...state, ...(await kvGet('libraryFilter', {})) };
  const [lessons, prog] = await Promise.all([allLessons(), allLessonProgress()]);

  const host = el('div');
  mount(root, 
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
      el('h1', { text: '課程' }),
      el('a', { class: 'btn', href: '#/import', style: 'min-height:38px;padding:8px 14px;font-size:14px' },
        ['+ 匯入文章']),
    ]),
    el('p', { class: 'sub', text: `${lessons.length} 課 · 由淺到深` }),
    filters(() => paint(host, lessons, prog)),
    host,
  );
  paint(host, lessons, prog);
}

function filters(onChange) {
  const wrap = el('div');

  const levelRow = el('div', { class: 'chips' }, [
    chip('全部程度', state.level === 0, () => { state.level = 0; save(); onChange(); }),
    ...LEVELS.map(l => chip(l.label, state.level === l.n, () => {
      state.level = state.level === l.n ? 0 : l.n; save(); onChange();
    })),
  ]);

  const topicRow = el('div', { class: 'chips' }, [
    chip('全部主題', !state.topic, () => { state.topic = ''; save(); onChange(); }),
    ...Object.entries(TOPICS).map(([k, v]) => chip(v, state.topic === k, () => {
      state.topic = state.topic === k ? '' : k; save(); onChange();
    })),
  ]);

  wrap.append(levelRow, topicRow);
  return wrap;
}

function save() { kvSet('libraryFilter', state); }

function chip(label, on, onclick) {
  return el('button', { class: `chip ${on ? 'is-on' : ''}`, onclick }, [label]);
}

function paint(host, lessons, prog) {
  document.querySelectorAll('.chip').forEach(c => {
    // Re-render chips cheaply by toggling state on the existing nodes.
  });
  const shown = lessons.filter(l =>
    (!state.level || l.level === state.level) &&
    (!state.topic || (l.topic || 'custom') === state.topic));

  if (!shown.length) {
    mount(host, emptyState('這個條件下沒有課程', '換個程度或主題看看'));
    return;
  }

  const groups = new Map();
  for (const l of shown) {
    const k = l.level;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(l);
  }

  const out = [];
  for (const lv of [...groups.keys()].sort((a, b) => a - b)) {
    const meta = LEVELS.find(x => x.n === lv);
    out.push(el('h2', {}, [
      meta?.label || `L${lv}`,
      el('span', { class: 'muted', style: 'font-weight:400;margin-left:8px', text: meta?.desc || '' }),
    ]));
    for (const l of groups.get(lv)) out.push(card(l, prog.get(l.id)));
  }
  mount(host, ...out);

  // Reflect the active filter on the chip row without a full re-render.
  const chips = document.querySelectorAll('.chips');
  if (chips[0]) {
    chips[0].children[0].classList.toggle('is-on', state.level === 0);
    LEVELS.forEach((l, i) => chips[0].children[i + 1]?.classList.toggle('is-on', state.level === l.n));
  }
  if (chips[1]) {
    chips[1].children[0].classList.toggle('is-on', !state.topic);
    Object.keys(TOPICS).forEach((k, i) =>
      chips[1].children[i + 1]?.classList.toggle('is-on', state.topic === k));
  }
}

function card(l, p) {
  const done = p && p.learned >= l.count;
  return el('a', { class: 'card card-tap', href: `#/lesson/${encodeURIComponent(l.id)}` }, [
    el('div', { class: 'lesson-head' }, [
      el('span', { class: `badge badge-l${l.level}`, text: `L${l.level}` }),
      el('span', { class: 'lesson-title', text: l.title }),
      done ? el('span', { class: 'badge badge-done', text: '完成' }) : null,
      l.custom ? el('span', { class: 'badge', text: '我的' }) : null,
    ]),
    el('div', { class: 'lesson-zh', text: l.titleZh || l.summaryZh || '' }),
    el('div', { class: 'lesson-meta' }, [
      el('span', { text: `${l.count} 句` }),
      el('span', { text: l.type === 'dialogue' ? '對話' : '短文' }),
      el('span', { text: TOPICS[l.topic] || '' }),
      p ? el('span', { style: 'color:var(--accent)', text: `${p.learned}/${l.count} 已掌握` }) : null,
    ]),
  ]);
}
