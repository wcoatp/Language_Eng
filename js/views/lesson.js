/* Lesson detail — preview the sentences, then start the trainer. */

import { el, backButton, toast, confirmBox, mount } from "../ui.js";
import { getLesson, TOPICS, deleteUserLesson } from '../content.js';
import { lessonProgress } from '../srs.js';
import { settings } from '../store.js';
import { say, cancel as cancelSpeech, unlock } from '../tts.js';
import { kvSet } from '../db.js';

export function destroy() { cancelSpeech(); }

export async function render(root, id) {
  const [lesson, prog, cfg] = await Promise.all([getLesson(id), lessonProgress(id), settings()]);
  await kvSet('lastLesson', id);

  const pct = lesson.sentences.length
    ? Math.round((prog.learned / lesson.sentences.length) * 100) : 0;

  mount(root, 
    backButton('課程', '#/library'),

    el('div', { class: 'lesson-head', style: 'margin-top:12px' }, [
      el('span', { class: `badge badge-l${lesson.level}`, text: `L${lesson.level}` }),
      el('span', { class: 'badge', text: lesson.type === 'dialogue' ? '對話' : '短文' }),
      el('span', { class: 'badge', text: TOPICS[lesson.topic] || '' }),
    ]),
    el('h1', { style: 'margin-top:8px', text: lesson.title }),
    el('p', { class: 'sub', text: lesson.titleZh || '' }),
    lesson.summaryZh ? el('p', { text: lesson.summaryZh }) : null,

    prog.seen ? el('div', { class: 'card' }, [
      el('div', { style: 'display:flex;justify-content:space-between' }, [
        el('span', { class: 'muted', text: '已掌握' }),
        el('span', { class: 'muted', text: `${prog.learned} / ${lesson.sentences.length}` }),
      ]),
      el('div', { class: 'bar' }, [el('i', { style: `width:${pct}%` })]),
    ]) : null,

    el('a', {
      class: 'btn btn-primary btn-lg btn-block',
      style: 'margin:6px 0 18px',
      href: `#/listen/${encodeURIComponent(lesson.id)}`,
    }, [prog.seen ? '繼續練習' : '開始練習']),

    el('h2', { text: '句子預覽' }),
    el('p', { class: 'muted', style: 'margin-top:-4px;margin-bottom:12px' },
      ['點任一句可以先聽聽看。正式練習時會先蓋住文字。']),
    ...lesson.sentences.map(s => row(s, lesson, cfg)),

    lesson.questions?.length
      ? el('p', { class: 'muted center', style: 'margin-top:18px' },
          [`練完後有 ${lesson.questions.length} 題理解測驗`])
      : null,

    lesson.custom || lesson.at ? el('div', {}, [
      el('hr', { class: 'divider' }),
      el('button', {
        class: 'btn btn-danger btn-block',
        onclick: async () => {
          if (!await confirmBox(`刪除「${lesson.title}」?這課的練習紀錄會保留。`, '刪除')) return;
          await deleteUserLesson(lesson.id);
          toast('已刪除');
          location.hash = '#/library';
        },
      }, ['刪除這篇文章']),
    ]) : null,
  );
}

function row(s, lesson, cfg) {
  return el('div', {
    class: 'card',
    style: 'padding:13px 15px;cursor:pointer',
    onclick: async e => {
      unlock();
      cancelSpeech();
      e.currentTarget.style.borderColor = 'var(--accent)';
      try {
        await say(s.text, {
          lessonId: lesson.id, sentenceId: s.id,
          langCode: cfg.accentLang, voiceURI: cfg.accent, rate: cfg.normalRate,
        });
      } catch { toast('播放失敗'); }
      e.currentTarget.style.borderColor = '';
    },
  }, [
    el('div', { style: 'display:flex;gap:10px;align-items:baseline' }, [
      s.speaker ? el('span', { class: 'badge', style: 'flex:none', text: s.speaker }) : null,
      el('div', {}, [
        el('div', { style: 'font-size:15.5px', text: s.text }),
        cfg.showZh && s.zh
          ? el('div', { class: 'muted', style: 'margin-top:3px', text: s.zh }) : null,
      ]),
    ]),
  ]);
}
