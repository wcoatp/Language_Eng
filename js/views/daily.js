/* Daily curriculum — dated story lessons grouped into 1-3 day series. */

import { backButton, el, emptyState, mount } from '../ui.js';
import { allLessons } from '../content.js';
import { allLessonProgress } from '../srs.js';
import { kvGet } from '../db.js';
import {
  dailyLessonForDate,
  dailyLessons,
  formatDailyDate,
  groupDailySeries,
  isDailyComplete,
  localDateKey,
} from '../daily.js';

export async function render(root) {
  const [all, progress, completions] = await Promise.all([
    allLessons(), allLessonProgress(), kvGet('dailyCompletions', {}),
  ]);
  const lessons = dailyLessons(all);
  const todayKey = localDateKey();
  const today = dailyLessonForDate(lessons, todayKey);

  if (!lessons.length) {
    mount(root,
      backButton('今天', '#/'),
      el('h1', { text: '每日課程' }),
      emptyState('還沒有每日課程', '新增含日期與故事單元的課程後會顯示在這裡'),
    );
    return;
  }

  const series = groupDailySeries(lessons).reverse();
  const featured = today || lessons[0];
  mount(root,
    backButton('今天', '#/'),
    el('div', { class: 'daily-heading' }, [
      el('div', {}, [
        el('h1', { text: '每日課程' }),
        el('p', { class: 'sub', text: '每天一篇約 500 字的原創故事 · 一個主題 1–3 日' }),
      ]),
      el('span', { class: 'daily-count', text: `${lessons.length} 日` }),
    ]),

    todayCard(featured, todayKey,
      isDailyComplete(featured, progress.get(featured.id), completions), !today),

    el('h2', { text: '主題課表' }),
    ...series.map((item) => seriesCard(item, progress, completions, featured.id)),
  );
}

function todayCard(lesson, todayKey, done, upcoming = false) {
  const exact = lesson.daily.date === todayKey;
  return el('section', { class: 'daily-hero' }, [
    el('div', { class: 'lesson-head' }, [
      el('span', { class: 'badge badge-daily', text: upcoming
        ? '即將推出' : exact ? '今日課程' : '最新課程' }),
      el('span', { class: `badge badge-l${lesson.level}`, text: `L${lesson.level}` }),
      done ? el('span', { class: 'badge badge-done', text: '完成' }) : null,
    ]),
    el('div', { class: 'daily-date', text: formatDailyDate(lesson.daily.date) }),
    el('h2', { class: 'daily-title', text: lesson.title }),
    el('div', { class: 'lesson-zh', text: lesson.titleZh }),
    el('p', { class: 'daily-summary', text: lesson.summaryZh }),
    el('div', { class: 'lesson-meta' }, [
      el('span', { text: lesson.daily.seriesTitleZh }),
      el('span', { text: `第 ${lesson.daily.day}/${lesson.daily.totalDays} 日` }),
      el('span', { text: `約 ${lesson.wordCount || 500} 字` }),
    ]),
    el('a', {
      class: 'btn btn-primary btn-lg btn-block',
      style: 'margin-top:16px',
      href: `#/lesson/${encodeURIComponent(lesson.id)}`,
    }, [done ? '再次閱讀' : upcoming ? '預先閱讀' : '開始今日課程']),
  ]);
}

function seriesCard(series, progress, completions, currentId) {
  const completed = series.lessons.filter((lesson) =>
    isDailyComplete(lesson, progress.get(lesson.id), completions)).length;
  const range = series.startDate === series.endDate
    ? formatDailyDate(series.startDate, { weekday: undefined })
    : `${formatDailyDate(series.startDate, { weekday: undefined })}–${formatDailyDate(series.endDate, { weekday: undefined })}`;

  return el('section', { class: 'card daily-series' }, [
    el('div', { class: 'daily-series-head' }, [
      el('div', {}, [
        el('h3', { text: series.title }),
        el('div', { class: 'lesson-zh', text: series.titleZh }),
      ]),
      el('div', { class: 'muted', text: `${range} · ${completed}/${series.totalDays}` }),
    ]),
    el('div', { class: 'daily-days' }, series.lessons.map((lesson) => {
      const done = isDailyComplete(lesson, progress.get(lesson.id), completions);
      return el('a', {
        class: `daily-day ${lesson.id === currentId ? 'is-current' : ''}`,
        href: `#/lesson/${encodeURIComponent(lesson.id)}`,
      }, [
        el('span', { class: 'daily-day-number', text: String(lesson.daily.day) }),
        el('span', { class: 'daily-day-copy' }, [
          el('b', { text: lesson.title }),
          el('small', { text: `${formatDailyDate(lesson.daily.date)} · ${lesson.wordCount || 500} 字` }),
        ]),
        done ? el('span', { class: 'daily-check', text: '✓' }) : null,
      ]);
    })),
  ]);
}
