/* Lesson detail — preview the sentences, then start the trainer. */

import { el, backButton, toast, confirmBox, mount } from "../ui.js";
import { getLesson, loadIndex, TOPICS, deleteUserLesson } from '../content.js';
import { lessonProgress } from '../srs.js';
import { settings } from '../store.js';
import { say, cancel as cancelSpeech, unlock } from '../tts.js';
import { kvGet, kvSet } from '../db.js';
import { downloadLesson, removeLesson, isLessonOffline, cacheSupported } from '../storage.js';
import { voiceIdForLesson, voiceForLesson } from '../voices.js';
import { englishWordCount, formatDailyDate, isDailyComplete, STORY_BEATS } from '../daily.js';
import { lookupText } from '../word-lookup.js';
import { getLearningProgress } from '../learning-store.js';
import { wordStatus } from '../learning.js';

let epoch = 0;
export function destroy() { epoch++; cancelSpeech(); }

export async function render(root, id) {
  const token = ++epoch;
  const [lesson, prog, cfg, index, dailyCompletions] = await Promise.all([
    getLesson(id), lessonProgress(id), settings(), loadIndex(), kvGet('dailyCompletions', {}),
  ]);
  if (token !== epoch) return;
  await kvSet('lastLesson', id);
  const dailySeries = lesson.daily
    ? index.filter((item) => item.daily?.seriesId === lesson.daily.seriesId)
      .sort((a, b) => a.daily.day - b.daily.day)
    : [];
  const dailyDone = isDailyComplete(lesson, prog, dailyCompletions);
  const deviceVoiceOnly = lesson.preGeneratedAudio === false ||
    (lesson.custom && !lesson.realAudio && !lesson.sentences.some((sentence) => sentence.audio));
  const learning = lesson.learning ? await getLearningProgress(lesson).catch(() => null) : null;
  if (token !== epoch) return;

  const pct = lesson.sentences.length
    ? Math.round((prog.learned / lesson.sentences.length) * 100) : 0;

  mount(root, 
    backButton(lesson.daily ? '每日課程' : '課程', lesson.daily ? '#/daily' : '#/library'),

    el('div', { class: 'lesson-head', style: 'margin-top:12px' }, [
      el('span', { class: `badge badge-l${lesson.level}`, text: `L${lesson.level}` }),
      el('span', { class: 'badge', text: lesson.type === 'dialogue' ? '對話' : '短文' }),
      el('span', { class: 'badge', text: TOPICS[lesson.topic] || '' }),
      lesson.daily ? el('span', {
        class: 'badge badge-daily',
        text: `${formatDailyDate(lesson.daily.date)} · 第 ${lesson.daily.day}/${lesson.daily.totalDays} 日`,
      }) : null,
      dailyDone ? el('span', { class: 'badge badge-done', text: '今日完成' }) : null,
      lesson.realAudio ? el('span', { class: 'badge badge-real', text: '真人錄音' }) : null,
      deviceVoiceOnly
        ? el('span', { class: 'badge', text: '裝置語音' }) : null,
    ]),
    el('h1', { style: 'margin-top:8px', text: lesson.title }),
    el('p', { class: 'sub', text: lesson.titleZh || '' }),
    lesson.summaryZh ? el('p', { text: lesson.summaryZh }) : null,
    lesson.daily ? dailySeriesStrip(lesson, dailySeries) : null,
    lesson.learning ? learningPanel(lesson, learning) : null,

    prog.seen ? el('div', { class: 'card' }, [
      el('div', { style: 'display:flex;justify-content:space-between' }, [
        el('span', { class: 'muted', text: '已掌握' }),
        el('span', { class: 'muted', text: `${prog.learned} / ${lesson.sentences.length}` }),
      ]),
      el('div', { class: 'bar' }, [el('i', { style: `width:${pct}%` })]),
    ]) : null,

    ...(lesson.daily
      ? [
          el('a', {
            class: 'btn btn-primary btn-lg btn-block',
            style: 'margin:6px 0 10px',
            href: `#/play/${encodeURIComponent(lesson.id)}`,
          }, ['▶ 閱讀並連續播放']),
          el('a', {
            class: 'btn btn-block',
            style: 'margin-bottom:10px',
            href: `#/listen/${encodeURIComponent(lesson.id)}`,
          }, [prog.seen ? '繼續逐句精聽' : '逐句精聽練習']),
        ]
      : [
          el('a', {
            class: 'btn btn-primary btn-lg btn-block',
            style: 'margin:6px 0 10px',
            href: `#/listen/${encodeURIComponent(lesson.id)}`,
          }, [prog.seen ? '繼續練習' : '開始練習']),
          el('a', {
            class: 'btn btn-block',
            style: 'margin-bottom:10px',
            href: `#/play/${encodeURIComponent(lesson.id)}`,
          }, ['▶ 連續播放 · 完整課文或自選句子']),
        ]),

    deviceVoiceOnly
      ? el('p', { class: 'hint', text: '本課使用裝置內建英語語音,不需下載音檔。' })
      : offlineButton(lesson, cfg),

    lesson.source ? el('p', { class: 'hint', style: 'margin:14px 0 0' }, [
      '素材來源:',
      lesson.sourceUrl
        ? el('a', { href: lesson.sourceUrl, target: '_blank', rel: 'noopener',
            style: 'color:var(--accent)' }, [lesson.source])
        : lesson.source,
    ]) : null,

    ...(lesson.learning ? [el('details', { class: 'lesson-transcript' }, [
      el('summary', { text: '查看雙語全文 · 想先測聽力可先不打開' }),
      ...transcript(lesson, cfg),
    ])] : transcript(lesson, cfg)),

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

function transcript(lesson, cfg) {
  return [el('h2', { text: lesson.daily ? `故事全文 · ${englishWordCount(lesson.sentences)} 字` : '句子預覽' }),
    el('p', { class: 'muted', text: '點單字查英中／英英；拖選可查片語。按句旁 ▶ 播放，正式精聽時會先蓋住文字。' }),
    ...storyRows(lesson, cfg)];
}

function learningPanel(lesson, progress) {
  const core = lesson.learning.vocabulary.filter(w => !w.optional);
  const done = core.filter(w => progress?.vocabulary[w.id]).length;
  const heard = core.filter(w => wordStatus(progress?.vocabulary[w.id]) === 'heard').length;
  const task = lesson.learning.task;
  const taskRating = task && progress?.tasks[task.id]?.rating;
  const labels = { independent: '獨立完成', prompted: '看提示完成', practice: '還需練習' };
  return el('section', { class: 'card learning-panel', 'aria-label': '本課學習路線' }, [
    el('h2', { text: '這課練什麼' }),
    el('p', { text: lesson.learning.objectiveZh }),
    lesson.learning.automatic ? el('p', { class: 'hint', text: '本課尚無人工字詞表；目前顯示本機自動候選，未上傳課文。可在揭示後使用英中／英英查詞確認。' }) : null,
    el('p', { class: 'hint', text: `核心 ${core.length} 個字詞 · 已自評 ${done}/${core.length} · 自評先聽就懂 ${heard}。可跳過，不影響原本練習。` }),
    el('a', { class: 'btn btn-primary btn-block', href: `#/prepare/${encodeURIComponent(lesson.id)}` }, [done ? '繼續／複習課前字詞' : '先熟悉本課字詞 · 約 2–3 分鐘']),
    progress?.quiz ? el('p', { class: 'hint', text: `最近理解測驗：${progress.quiz.right}/${progress.quiz.total}（與字詞自評分開）` }) : null,
    task ? el('a', { class: 'btn btn-block', href: `#/task/${encodeURIComponent(lesson.id)}` }, ['換條件任務 · 可直接挑戰']) : null,
    taskRating ? el('p', { class: 'hint', text: `最近任務自評：${labels[taskRating] || '尚未記錄'}，不是自動評分。` }) : null,
    lesson.learning.next ? el('a', { class: 'btn btn-block', href: `#/lesson/${encodeURIComponent(lesson.learning.next.id)}` }, [`下一步 · ${lesson.learning.next.labelZh}`]) : null,
    lesson.learning.prerequisite ? el('a', { class: 'btn btn-ghost btn-block', href: `#/lesson/${encodeURIComponent(lesson.learning.prerequisite.id)}` }, [`需要先備練習 · ${lesson.learning.prerequisite.labelZh}`]) : null,
  ]);
}

function dailySeriesStrip(lesson, series) {
  return el('section', { class: 'daily-series-strip' }, [
    el('div', { class: 'daily-series-strip-head' }, [
      el('div', {}, [
        el('b', { text: lesson.daily.seriesTitle }),
        el('div', { class: 'lesson-zh', text: lesson.daily.seriesTitleZh }),
      ]),
      el('span', { class: 'muted', text: `約 ${englishWordCount(lesson.sentences)} 字` }),
    ]),
    el('div', { class: 'daily-series-links' }, series.map((item) =>
      el('a', {
        class: `chip ${item.id === lesson.id ? 'is-on' : ''}`,
        href: `#/lesson/${encodeURIComponent(item.id)}`,
      }, [`第 ${item.daily.day} 日`]))),
  ]);
}

function storyRows(lesson, cfg) {
  if (!lesson.storyArc) return lesson.sentences.map((sentence) => row(sentence, lesson, cfg));
  const starts = new Map(STORY_BEATS.map((beat) => [lesson.storyArc[beat.id], beat]));
  const out = [];
  for (const sentence of lesson.sentences) {
    const beat = starts.get(sentence.id);
    if (beat) {
      out.push(el('div', { class: `story-beat story-beat-${beat.id}` }, [
        el('span', { text: beat.label }),
        el('b', { text: beat.description }),
      ]));
    }
    out.push(row(sentence, lesson, cfg));
  }
  return out;
}

/* Real recordings are heavy, so pinning one for offline use is a deliberate
   choice rather than something the app does behind your back. */
function offlineButton(lesson, cfg) {
  if (!cacheSupported()) return null;

  const btn = el('button', { class: 'btn btn-block', style: 'margin-bottom:8px' }, ['檢查中…']);
  let stored = false;

  const paint = () => {
    btn.disabled = false;
    btn.textContent = stored ? '✓ 已可離線使用 · 點此移除' : '⬇ 下載以便離線使用';
    btn.classList.toggle('btn-ghost', stored);
  };

  isLessonOffline(lesson, voiceIdForLesson(cfg, lesson)).then(v => { stored = v; paint(); });

  btn.onclick = async () => {
    btn.disabled = true;
    try {
      if (stored) {
        await removeLesson(lesson, voiceIdForLesson(cfg, lesson));
        stored = false;
        toast('已移除離線音檔');
      } else {
        const n = await downloadLesson(lesson, voiceIdForLesson(cfg, lesson),
          (done, total) => { btn.textContent = `下載中 ${done}/${total}`; });
        stored = true;
        toast(`已下載 ${n} 段音檔`);
      }
    } catch (e) {
      toast(e.message || '下載失敗');
    }
    paint();
  };

  return btn;
}

function row(s, lesson, cfg) {
  const play = async () => {
      unlock();
      cancelSpeech();
      try {
        await say(s.text, {
          lessonId: lesson.id, sentenceId: s.id,
          langCode: cfg.accentLang, voiceURI: cfg.accent, rate: cfg.normalRate,
          voiceId: voiceIdForLesson(cfg, lesson),
          realAudio: !!lesson.realAudio, blob: s.audio || null,
        });
      } catch { toast('播放失敗'); }
  };
  return el('div', { class: 'card', style: 'padding:13px 15px' }, [
    el('div', { style: 'display:flex;gap:10px;align-items:baseline' }, [
      s.speaker ? el('span', { class: 'badge', style: 'flex:none', text: s.speaker }) : null,
      el('div', { style: 'flex:1;min-width:0' }, [
        lookupText(s.text, { lessonId: lesson.id, sentenceId: s.id, lessonTitle: lesson.title,
          zh: s.zh }, { tag: 'div' }),
        cfg.showZh && s.zh
          ? el('div', { class: 'muted', style: 'margin-top:3px', text: s.zh }) : null,
      ]),
      el('button', { type: 'button', class: 'sentence-play chip', 'aria-label': `播放句子 ${s.id}`,
        onclick: play }, ['▶']),
    ]),
  ]);
}
