/* SDD-002/003: authored and deterministic local preparation rules. */
import { normalizeTerm, wordTokens, phraseAt, lookupLocal } from './dictionary.js';

const AUTO_SCHEMA = 1;
const AUTO_STOP = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'mine', 'we', 'us', 'our',
  'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they', 'them', 'their', 'who',
  'what', 'when', 'where', 'why', 'how', 'which', 'and', 'or', 'but', 'so', 'because', 'if', 'then',
  'than', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'out', 'over', 'to', 'up',
  'with', 'about', 'after', 'before', 'between', 'through', 'is', 'am', 'are', 'was', 'were', 'be',
  'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'will', 'would',
  'shall', 'should', 'may', 'might', 'must', 'not', 'no', 'yes', 'very', 'just', 'also', 'only',
  'here', 'there', 'now', 'really', 'some', 'any', 'all', 'more', 'most', 'much', 'many', 'one',
  'two', 'three', 'get', 'got', 'go', 'went', 'come', 'came', 'make', 'made', 'say', 'said',
]);

function hashVersion(lesson) {
  const input = `${AUTO_SCHEMA}|${lesson.id}|${(lesson.sentences || []).map(s => s.text).join('\n')}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

function autoId(term, used) {
  const base = `auto-${normalizeTerm(term).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'word'}`;
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

/** Build a spoiler-light local fallback. It selects text locally and never calls a dictionary service. */
export function automaticLearning(lesson) {
  const candidates = new Map();
  const add = (surface, sentence, order, local = lookupLocal(surface)) => {
    const clean = normalizeTerm(surface);
    if (!clean || (!clean.includes(' ') && (AUTO_STOP.has(clean) || clean.length < 4))) return;
    const key = local?.word || clean;
    const current = candidates.get(key);
    if (current) {
      current.count++;
      if (normalizeTerm(current.surface) === clean && !current.sentenceIds.includes(sentence.id)) current.sentenceIds.push(sentence.id);
      return;
    }
    const zh = local?.translations?.[0]?.terms?.[0] || '';
    const en = local?.definitions?.[0]?.text || '';
    candidates.set(key, { key, term: local?.word || clean, surface, sentenceIds: [sentence.id],
      local, zh, en, order, count: 1 });
  };
  for (const [sentenceIndex, sentence] of (lesson.sentences || []).entries()) {
    for (const token of wordTokens(sentence.text)) {
      const phrase = phraseAt(sentence.text, token.start, token.end);
      if (phrase) add(phrase, sentence, sentenceIndex, lookupLocal(phrase));
      add(token.text, sentence, sentenceIndex, lookupLocal(token.text));
    }
  }
  const target = lesson.level <= 1 ? 4 : 6;
  const ranked = [...candidates.values()].sort((a, b) => {
    const score = item => (item.local ? 1000 : 0) + (item.surface.includes(' ') ? 160 : 0) +
      Math.min(item.count, 5) * 25 + Math.min(item.surface.length, 20) - item.order;
    return score(b) - score(a) || a.order - b.order || a.key.localeCompare(b.key);
  }).slice(0, target);
  const used = new Set();
  return {
    version: hashVersion(lesson),
    automatic: true,
    objectiveZh: '先熟悉系統從本課挑出的內容詞；這是自動候選，可依需要查英中／英英後再開始聽。',
    ...(lesson.learningPath || {}),
    vocabulary: ranked.map(item => ({
      id: autoId(item.key, used), term: item.term, surface: item.surface,
      sentenceIds: item.sentenceIds.slice(0, 3), automatic: true, lookupRequired: !item.local,
      zh: item.zh || '尚未內建中文義，請開啟查詞確認。',
      en: item.en || 'Open the dictionary to review this lesson word.',
      example: item.local ? `Listen for “${item.surface}”.` : `Look up “${item.surface}”.`,
      exampleZh: item.local ? `聽課文時留意「${item.surface}」。` : `先查「${item.surface}」的英中／英英解釋。`,
    })),
  };
}

export function withAutomaticLearning(lesson) {
  if (!lesson || lesson.learning) return lesson;
  return { ...lesson, learning: automaticLearning(lesson) };
}

export function containsSurface(text, surface) {
  const wanted = wordTokens(surface).map(t => t.text.toLowerCase());
  const words = wordTokens(text);
  return wanted.length > 0 && words.some((token, i) => {
    const end = words[i + wanted.length - 1];
    return end && normalizeTerm(text.slice(token.start, end.end)) === normalizeTerm(surface);
  });
}

export function progressFor(lesson, all = {}) {
  const saved = all?.[lesson.id];
  return saved && saved.version === lesson.learning?.version
    ? { ...saved, vocabulary: saved.vocabulary || {}, tasks: saved.tasks || {} }
    : { version: lesson.learning?.version, vocabulary: {}, tasks: {}, quiz: null };
}

export function wordStatus(record) {
  if (!record) return 'unseen';
  if (record.read !== 'known') return 'practice';
  return record.heard === 'yes' ? 'heard' : 'reading';
}

export function prepareQueue(lesson, progress, mode = 'remaining') {
  const words = lesson.learning?.vocabulary || [];
  const pool = words.filter(w => mode === 'extra' ? w.optional : !w.optional);
  if (mode === 'remaining') return pool.filter(w => !progress.vocabulary[w.id]);
  if (mode === 'review') return pool.filter(w => wordStatus(progress.vocabulary[w.id]) !== 'heard');
  return pool;
}

export function recordLearning(all, lesson, kind, id, value, at = Date.now()) {
  if (!lesson.learning) throw Error('這課沒有預習規格');
  const state = progressFor(lesson, all);
  if (kind === 'vocabulary') {
    if (!lesson.learning.vocabulary.some(w => w.id === id) ||
        !['yes', 'hint', 'unavailable'].includes(value.heard) || !['known', 'practice'].includes(value.read)) throw Error('無效的字詞自評');
    state.vocabulary = { ...state.vocabulary, [id]: { heard: value.heard, read: value.read, at } };
  } else if (kind === 'task') {
    if (lesson.learning.task?.id !== id || !['independent', 'prompted', 'practice'].includes(value.rating)) throw Error('無效的任務自評');
    const prompted = !!value.prompted;
    state.tasks = { ...state.tasks, [id]: { rating: prompted && value.rating === 'independent' ? 'prompted' : value.rating, prompted, at } };
  } else if (kind === 'quiz') {
    const questions = lesson.questions || [];
    if (!Array.isArray(value.answers) || value.answers.length !== questions.length ||
        !value.answers.every((answer, i) => Number.isInteger(answer) && answer >= 0 && answer < questions[i].options.length)) throw Error('無效的測驗答案');
    state.quiz = { answers: [...value.answers], right: value.answers.filter((answer, i) => answer === questions[i].answer).length,
      total: questions.length, at };
  } else throw Error('未知的學習紀錄');
  return { ...(all || {}), [lesson.id]: state };
}

export function shuffleOptions(question, random = Math.random) {
  const options = question.options.map((text, originalIndex) => ({ text, originalIndex }));
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

export function learningProblems(lesson) {
  const problems = [];
  const check = (ok, message) => { if (!ok) problems.push(message); };
  const text = value => typeof value === 'string' && !!value.trim();
  const refsValid = ids => Array.isArray(ids) && ids.length && ids.every(id => lesson.sentences?.some(s => s.id === id));
  for (const q of lesson.questions || []) {
    if (q.explanationZh != null) check(text(q.explanationZh), 'question explanationZh must be text');
    if (q.sentenceIds != null) check(refsValid(q.sentenceIds), 'question sentenceIds must reference real sentences');
  }
  if (!lesson.learning) return problems;
  const l = lesson.learning;
  check(Number.isInteger(l.version) && l.version > 0, 'learning version must be a positive integer');
  check(text(l.objectiveZh), 'missing learning objective');
  const words = Array.isArray(l.vocabulary) ? l.vocabulary : [];
  check(words.length >= 4 && words.length <= 8, 'learning vocabulary needs 4-8 items');
  check(new Set(words.map(w => w.id)).size === words.length, 'duplicate vocabulary id');
  for (const w of words) {
    check(/^[a-z][a-z0-9-]*$/.test(w.id || ''), 'invalid vocabulary id');
    check(!!normalizeTerm(w.term) && !!normalizeTerm(w.surface), `${w.id}: invalid English term/surface`);
    for (const key of ['zh', 'en', 'example', 'exampleZh']) check(text(w[key]), `${w.id}: missing ${key}`);
    check(refsValid(w.sentenceIds), `${w.id}: invalid sentence references`);
    if (refsValid(w.sentenceIds)) check(w.sentenceIds.every(id => containsSurface(lesson.sentences.find(s => s.id === id).text, w.surface)), `${w.id}: surface not present at word boundaries`);
    if (w.optional != null) check(typeof w.optional === 'boolean', `${w.id}: optional must be boolean`);
    if (w.automatic != null) check(typeof w.automatic === 'boolean', `${w.id}: automatic must be boolean`);
    if (w.lookupRequired != null) check(typeof w.lookupRequired === 'boolean', `${w.id}: lookupRequired must be boolean`);
  }
  if (l.task) {
    for (const key of ['id', 'titleZh', 'roleZh', 'setupZh']) check(text(l.task[key]), `task missing ${key}`);
    const steps = Array.isArray(l.task.steps) ? l.task.steps : [];
    check(steps.length >= 2 && steps.length <= 8, 'task needs 2-8 steps');
    for (const s of steps) for (const key of ['partner', 'promptZh', 'keywords', 'frame', 'sample']) check(text(s[key]), `task step missing ${key}`);
    check(Array.isArray(l.task.success) && l.task.success.length >= 2 && l.task.success.every(text), 'task needs success criteria');
  }
  return problems;
}
