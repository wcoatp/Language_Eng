/* Pure helpers for dated, multi-day story lessons. */

export const STORY_BEATS = [
  { id: 'setup', label: '起', description: '故事開場' },
  { id: 'development', label: '承', description: '情節發展' },
  { id: 'turn', label: '轉', description: '意外轉折' },
  { id: 'resolution', label: '合', description: '收束回味' },
];

const WORD = /[A-Za-z]+(?:'[A-Za-z]+)*/g;

export function englishWordCount(sentences = []) {
  return sentences.reduce((total, sentence) =>
    total + ((sentence?.text || '').match(WORD)?.length || 0), 0);
}

export function dailyLessonProblems(lesson) {
  if (!lesson?.daily) return [];
  const problems = [];
  const add = (condition, message) => { if (!condition) problems.push(message); };
  const meta = lesson.daily;
  const sentences = Array.isArray(lesson.sentences) ? lesson.sentences : [];
  const beatIds = STORY_BEATS.map((beat) => beat.id);

  add(lesson.type === 'article', 'daily lesson must use type "article"');
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meta.date || '');
  const parsedDate = dateMatch
    ? new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])))
    : null;
  add(!!parsedDate && parsedDate.getUTCFullYear() === Number(dateMatch[1]) &&
    parsedDate.getUTCMonth() === Number(dateMatch[2]) - 1 &&
    parsedDate.getUTCDate() === Number(dateMatch[3]), 'daily.date must be a real YYYY-MM-DD date');
  add(lesson.id === `daily-${meta.date}`,
    `daily lesson id must match its date (expected daily-${meta.date})`);
  add(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.seriesId || ''),
    'daily.seriesId must be a lowercase slug');
  add(typeof meta.seriesTitle === 'string' && !!meta.seriesTitle.trim(),
    'daily.seriesTitle is required');
  const seriesTitleWords = (meta.seriesTitle || '').match(WORD)?.length || 0;
  add(seriesTitleWords >= 2 && seriesTitleWords <= 8,
    'daily.seriesTitle should contain 2-8 English words');
  add(typeof meta.seriesTitleZh === 'string' && !!meta.seriesTitleZh.trim(),
    'daily.seriesTitleZh is required');
  add(Number.isInteger(meta.totalDays) && meta.totalDays >= 1 && meta.totalDays <= 3,
    'daily.totalDays must be 1-3');
  add(Number.isInteger(meta.day) && meta.day >= 1 && meta.day <= meta.totalDays,
    'daily.day must be within the series');
  add(typeof lesson.titleZh === 'string' && !!lesson.titleZh.trim(),
    'daily lesson needs a Chinese title');
  const titleWords = (lesson.title || '').match(WORD)?.length || 0;
  add(titleWords >= 2 && titleWords <= 8, 'daily title should contain 2-8 English words');
  add(typeof lesson.summaryZh === 'string' && !!lesson.summaryZh.trim(),
    'daily lesson needs a Chinese summary');
  add((lesson.questions || []).length === 3, 'daily lesson needs exactly 3 questions');
  add(sentences.length >= 24 && sentences.length <= 40,
    `daily lesson should contain 24-40 sentences (found ${sentences.length})`);
  for (const sentence of sentences) {
    add(typeof sentence.zh === 'string' && !!sentence.zh.trim(),
      `${sentence.id || 'sentence'} needs a Chinese translation`);
  }
  for (const [index, question] of (lesson.questions || []).entries()) {
    add(typeof question.q === 'string' && !!question.q.trim(),
      `question ${index + 1} needs question text`);
    add(Array.isArray(question.options) && question.options.length === 3 &&
      question.options.every((option) => typeof option === 'string' && !!option.trim()),
    `question ${index + 1} needs 3 non-empty options`);
    add(new Set(question.options || []).size === 3,
      `question ${index + 1} options must be different`);
  }

  const words = englishWordCount(sentences);
  add(words >= 450 && words <= 550,
    `daily story must be about 500 English words (found ${words}, expected 450-550)`);

  const arc = lesson.storyArc;
  add(!!arc && typeof arc === 'object' && !Array.isArray(arc), 'storyArc is required');
  if (arc && typeof arc === 'object' && !Array.isArray(arc)) {
    const keys = Object.keys(arc);
    add(keys.length === beatIds.length && beatIds.every((beat) => keys.includes(beat)),
      `storyArc must contain ${beatIds.join(', ')}`);
    const starts = beatIds.map((beat) => sentences.findIndex((sentence) => sentence.id === arc[beat]));
    add(starts[0] === 0, 'storyArc.setup must start at s1');
    add(starts.every((start) => start >= 0), 'every storyArc marker must reference a sentence');
    add(starts.every((start, index) => index === 0 || start > starts[index - 1]),
      'storyArc markers must follow story order');
    if (starts.every((start) => start >= 0)) {
      const boundaries = [...starts, sentences.length];
      add(boundaries.slice(0, -1).every((start, index) => boundaries[index + 1] - start >= 2),
        'every storyArc section needs at least 2 sentences');
    }
  }
  return problems;
}

export function dailySeriesProblems(lessons = []) {
  const problems = [];
  const dated = dailyLessons(lessons);
  const seenDates = new Map();
  for (const lesson of dated) {
    const previous = seenDates.get(lesson.daily.date);
    if (previous) problems.push(`${lesson.daily.date}: used by both ${previous} and ${lesson.id}`);
    seenDates.set(lesson.daily.date, lesson.id);
  }

  for (const series of groupDailySeries(dated)) {
    const first = series.lessons[0]?.daily;
    const expectedDays = Array.from({ length: first?.totalDays || 0 }, (_, index) => index + 1);
    const actualDays = series.lessons.map((lesson) => lesson.daily.day);
    if (JSON.stringify(actualDays) !== JSON.stringify(expectedDays)) {
      problems.push(`${series.id}: expected days ${expectedDays.join(', ')}, found ${actualDays.join(', ')}`);
    }
    for (const lesson of series.lessons) {
      const meta = lesson.daily;
      if (meta.totalDays !== first.totalDays || meta.seriesTitle !== first.seriesTitle ||
          meta.seriesTitleZh !== first.seriesTitleZh) {
        problems.push(`${series.id}: series metadata differs in ${lesson.id}`);
      }
    }
    for (let index = 1; index < series.lessons.length; index++) {
      const before = Date.parse(`${series.lessons[index - 1].daily.date}T00:00:00Z`);
      const after = Date.parse(`${series.lessons[index].daily.date}T00:00:00Z`);
      if (after - before !== 86_400_000) {
        problems.push(`${series.id}: series dates must be consecutive`);
        break;
      }
    }
  }
  return problems;
}

export function isDailyLesson(lesson) {
  return !!lesson?.daily?.date && !!lesson?.daily?.seriesId;
}

export function normalizeCourseTitle(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function dailyTitleProblems(lesson, referenceTitles = []) {
  if (!lesson?.daily) return [];
  const blocked = new Set(referenceTitles.map(normalizeCourseTitle));
  const problems = [];
  for (const [label, title] of [
    ['title', lesson.title],
    ['daily.seriesTitle', lesson.daily.seriesTitle],
  ]) {
    if (blocked.has(normalizeCourseTitle(title))) {
      problems.push(`${label} reuses a reference-course title; write an original title`);
    }
  }
  return problems;
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dailyLessons(lessons = []) {
  return lessons.filter(isDailyLesson).sort((a, b) =>
    a.daily.date.localeCompare(b.daily.date) || a.daily.day - b.daily.day);
}

/** Exact date when available; otherwise the newest published lesson. */
export function dailyLessonForDate(lessons = [], dateKey = localDateKey()) {
  const dated = dailyLessons(lessons);
  if (!dated.length) return null;
  const exact = dated.find((lesson) => lesson.daily.date === dateKey);
  if (exact) return exact;
  const published = dated.filter((lesson) => lesson.daily.date <= dateKey);
  return published.at(-1) || null;
}

export function groupDailySeries(lessons = []) {
  const groups = new Map();
  for (const lesson of dailyLessons(lessons)) {
    const meta = lesson.daily;
    if (!groups.has(meta.seriesId)) {
      groups.set(meta.seriesId, {
        id: meta.seriesId,
        title: meta.seriesTitle,
        titleZh: meta.seriesTitleZh || '',
        totalDays: meta.totalDays,
        lessons: [],
      });
    }
    groups.get(meta.seriesId).lessons.push(lesson);
  }
  return [...groups.values()].map((series) => ({
    ...series,
    startDate: series.lessons[0]?.daily.date || '',
    endDate: series.lessons.at(-1)?.daily.date || '',
  }));
}

export function formatDailyDate(dateKey, options = {}) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric', day: 'numeric', weekday: 'short', ...options,
  }).format(date);
}

export function completesDailyPlayback(lesson, sequence = []) {
  if (!isDailyLesson(lesson) || !Array.isArray(lesson.sentences)) return false;
  return sequence.length === lesson.sentences.length && sequence.every((sentence, index) =>
    sentence?.id === lesson.sentences[index]?.id);
}

export function isDailyComplete(lesson, progress, completions = {}) {
  if (!isDailyLesson(lesson)) return false;
  const total = lesson.count ?? lesson.sentences?.length ?? 0;
  return !!completions?.[lesson.id] || !!(total && progress?.learned >= total);
}
