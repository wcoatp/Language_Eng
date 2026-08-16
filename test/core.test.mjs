import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

import {
  measuredWpm,
  rateFor,
  scoreDifficulty,
  scoreListening,
  speedScore,
  words,
} from '../js/difficulty.js';
import { parseTurn, tutorSystem } from '../js/llm.js';
import { AUTO, CORE_VOICES, VOICES, fallbackChain, forLang, pickVoice } from '../js/voices.js';
import { cuesToSegments, parseTranscript, parseVideoId } from '../js/youtube.js';
import { MIN_SLOW_WPM, nextLessonFor, playbackSequence, speechRates } from '../js/playback.js';
import { describeInterval, newCard, schedule } from '../js/srs.js';
import { orderForRecall, readyForRecall, recallCue, thinkingMs, wordsOf } from '../js/recall.js';
import {
  dailyLessonForDate,
  dailyLessonProblems,
  dailySeriesProblems,
  completesDailyPlayback,
  englishWordCount,
  groupDailySeries,
} from '../js/daily.js';

// asr.js reads the browser feature flags at module load time.
globalThis.window = {};
const { scoreAttempt } = await import('../js/asr.js');
const { splitSentences } = await import('../js/views/import.js');

test('difficulty helpers grade text and delivery speed deterministically', () => {
  assert.deepEqual(words("We're learning English."), ["we're", 'learning', 'english']);
  assert.equal(scoreDifficulty([]), 1);
  assert.equal(measuredWpm('one two three four', 2), 120);
  assert.equal(measuredWpm('anything', 0), null);
  assert.equal(speedScore(105), 1);
  assert.equal(speedScore(185), 5);
  assert.equal(rateFor(3), 0.87);

  const slow = [{ text: 'This is a simple sentence.', wpm: 105 }];
  const fast = [{ text: 'This is a simple sentence.', wpm: 185 }];
  assert.ok(scoreListening(fast) > scoreListening(slow));
});

test('speech rates hit the level target whatever pace the engine renders at', () => {
  // The same level through two engines must sound the same speed.
  const edge = speechRates({ targetWpm: 100, sourceWpm: 114 });
  const kokoro = speechRates({ targetWpm: 100, sourceWpm: 146 });
  assert.equal(edge.normalWpm, 100);
  assert.equal(kokoro.normalWpm, 100);
  assert.ok(edge.normal > kokoro.normal);

  // A human recording keeps its own delivery no matter what level it scored.
  const real = speechRates({ targetWpm: 100, sourceWpm: 160, rescale: false });
  assert.equal(real.normal, 1);
  assert.equal(real.normalWpm, 160);
});

test('the slow ladder steps down without falling under the intelligible floor', () => {
  const fast = speechRates({ targetWpm: 160, sourceWpm: 160, rescale: false });
  assert.ok(fast.slow.length >= 2, 'fast speech has room to slow down');
  for (const [i, step] of fast.slow.entries()) {
    assert.ok(step.wpm >= MIN_SLOW_WPM - 1, `step ${i} stays intelligible`);
    assert.ok(step.wpm < fast.normalWpm, `step ${i} is slower than normal`);
    if (i) assert.ok(step.wpm < fast.slow[i - 1].wpm, `step ${i} is slower than the one before`);
  }

  // Material that is already slow offers no useful steps rather than fake ones.
  const already = speechRates({ targetWpm: 100, sourceWpm: 95, rescale: false });
  assert.ok(already.slow.length <= 1);

  // The learner's slow-speed preference has to actually move the ladder.
  const gentle = speechRates({ targetWpm: 160, sourceWpm: 160, rescale: false, slowRate: 0.9 });
  assert.ok(gentle.slow[0].wpm > fast.slow[0].wpm);
});

test('every grade schedules a distinct, honestly-labelled interval', () => {
  const now = Date.UTC(2026, 7, 15);
  let card = newCard('x', 'l', 's', now);
  for (const g of [2, 2]) card = { ...card, ...schedule(card, g, now) };
  assert.equal(card.interval, 5);

  // From here the middle button used to land within a day of the right one.
  const hard = schedule(card, 1, now);
  const good = schedule(card, 2, now);
  assert.ok(good.interval - hard.interval >= 5, '勉強 and 掌握了 stay apart');
  assert.equal(schedule(card, 0, now).interval, 0);
  assert.ok(schedule(card, 0, now).due < now + 86400000, '沒聽懂 comes back the same session');

  assert.equal(describeInterval(0), '10 分鐘後');
  assert.equal(describeInterval(1), '明天');
  assert.equal(describeInterval(12), '12 天後');
  assert.equal(describeInterval(60), '2 個月後');
});

test('voice auto-selection keeps the accent and raises pace after L1', () => {
  assert.equal(VOICES.length, 11);
  assert.equal(forLang('en-US').length, 3);
  assert.equal(pickVoice(AUTO, 'en-US', 1).id, 'edge-us');
  assert.equal(pickVoice(AUTO, 'en-US', 2).id, 'kokoro-us');
  assert.equal(pickVoice('chatterbox-us', 'en-US', 1).id, 'chatterbox-us');
  assert.equal(pickVoice(AUTO, 'en-AU', 5).id, 'edge-au');
});

test('speech-recognition comparison tolerates punctuation but catches omissions', () => {
  assert.equal(scoreAttempt("I'm ready!", "I'm ready").score, 100);
  const attempt = scoreAttempt('I would like some coffee', 'I like coffee');
  assert.ok(attempt.score < 100);
  assert.deepEqual(
    attempt.words.filter((word) => !word.ok).map((word) => word.w),
    ['would', 'some'],
  );
});

test('LLM turn parsing accepts valid, fenced, and plain responses', () => {
  assert.deepEqual(parseTurn('{"reply":"Hello!","fix":null}'), {
    reply: 'Hello!', fix: null,
  });
  assert.deepEqual(parseTurn('```json\n{"reply":"Try again.","fix":"修正"}\n```'), {
    reply: 'Try again.', fix: '修正',
  });
  assert.deepEqual(parseTurn('Keep going.'), { reply: 'Keep going.', fix: null });

  const prompt = tutorSystem({ level: 2, corrections: false, scenario: 'At a cafe.' });
  assert.match(prompt, /At a cafe/);
  assert.match(prompt, /Always set "fix" to null/);
});

test('YouTube helpers parse ids, transcript formats, and sentence segments', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(parseVideoId(id), id);
  assert.equal(parseVideoId(`https://youtu.be/${id}?t=12`), id);
  assert.equal(parseVideoId(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(parseVideoId('not a video'), null);

  const cues = parseTranscript('0:01\nHello there.\n0:03 This is the next line.\n0:05\n[Music]');
  assert.deepEqual(cues, [
    { start: 1, text: 'Hello there.' },
    { start: 3, text: 'This is the next line.' },
  ]);
  assert.deepEqual(cuesToSegments(cues, 8).map(({ id: cueId, text }) => ({ cueId, text })), [
    { cueId: 's1', text: 'Hello there.' },
    { cueId: 's2', text: 'This is the next line.' },
  ]);
});

test('article import keeps abbreviations together and normalises smart punctuation', () => {
  assert.deepEqual(splitSentences('Dr. Smith arrived. He said, “Hello!”'), [
    'Dr. Smith arrived.',
    'He said, "Hello!"',
  ]);
  assert.deepEqual(splitSentences(''), []);
});

test('continuous playback preserves lesson order in full and custom modes', () => {
  const sentences = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
  assert.deepEqual(playbackSequence(sentences, 'all', []).map((s) => s.id),
    ['s1', 's2', 's3']);
  assert.deepEqual(playbackSequence(sentences, 'custom', new Set(['s3', 's1'])).map((s) => s.id),
    ['s1', 's3']);
  assert.deepEqual(playbackSequence(sentences, 'custom', []).map((s) => s.id), []);
});

test('daily curriculum selects by local date and groups multi-day stories', () => {
  const lessons = [
    { id: 'd2', daily: { date: '2026-08-13', seriesId: 'rain', day: 2,
      totalDays: 2, seriesTitle: 'Rain Plan', seriesTitleZh: '雨天計畫' } },
    { id: 'd1', daily: { date: '2026-08-12', seriesId: 'rain', day: 1,
      totalDays: 2, seriesTitle: 'Rain Plan', seriesTitleZh: '雨天計畫' } },
  ];
  assert.equal(dailyLessonForDate(lessons, '2026-08-12').id, 'd1');
  assert.equal(dailyLessonForDate(lessons, '2026-08-14').id, 'd2');
  assert.equal(dailyLessonForDate(lessons, '2026-08-11'), null);
  const groups = groupDailySeries(lessons);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].lessons.map((lesson) => lesson.id), ['d1', 'd2']);

  const dailyLesson = { ...lessons[0], sentences: [{ id: 's1' }, { id: 's2' }] };
  assert.equal(completesDailyPlayback(dailyLesson, dailyLesson.sentences), true);
  assert.equal(completesDailyPlayback(dailyLesson, [{ id: 's2' }, { id: 's1' }]), false);
});

test('daily lesson validation enforces 500 words, real dates, and a four-part arc', () => {
  const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';
  const lesson = {
    id: 'daily-2026-08-14',
    title: 'A Small Test',
    titleZh: '一場小測試',
    summaryZh: '一篇用來驗證每日課格式的原創測試故事。',
    level: 2,
    type: 'article',
    topic: 'daily',
    preGeneratedAudio: false,
    daily: {
      date: '2026-08-14', seriesId: 'small-test', seriesTitle: 'A Small Test',
      seriesTitleZh: '一場小測試', day: 1, totalDays: 1,
    },
    storyArc: { setup: 's1', development: 's3', turn: 's5', resolution: 's7' },
    sentences: Array.from({ length: 30 }, (_, index) => ({
      id: `s${index + 1}`, text, zh: `第 ${index + 1} 句中文。`,
    })),
    questions: Array.from({ length: 3 }, () => ({
      q: 'What happened?', options: ['A', 'B', 'C'], answer: 0,
    })),
  };
  assert.equal(englishWordCount(lesson.sentences), 450);
  assert.deepEqual(dailyLessonProblems(lesson), []);

  const invalidDate = structuredClone(lesson);
  invalidDate.daily.date = '2026-02-30';
  assert.ok(dailyLessonProblems(invalidDate).some((problem) => /real YYYY-MM-DD/.test(problem)));

  const mismatchedId = structuredClone(lesson);
  mismatchedId.id = 'daily-2026-08-13';
  assert.ok(dailyLessonProblems(mismatchedId).some((problem) => /id must match its date/.test(problem)));

  const short = structuredClone(lesson);
  short.sentences = short.sentences.slice(0, 20);
  assert.ok(dailyLessonProblems(short).some((problem) => /about 500 English words/.test(problem)));
});

test('daily series validation catches missing days, duplicate dates, and gaps', () => {
  const meta = {
    seriesId: 'shared-plan', seriesTitle: 'A Shared Plan', seriesTitleZh: '共享計畫', totalDays: 2,
  };
  const valid = [
    { id: 'daily-a', daily: { ...meta, day: 1, date: '2026-08-13' } },
    { id: 'daily-b', daily: { ...meta, day: 2, date: '2026-08-14' } },
  ];
  assert.deepEqual(dailySeriesProblems(valid), []);
  const duplicate = structuredClone(valid);
  duplicate[1].daily.date = '2026-08-13';
  const problems = dailySeriesProblems(duplicate);
  assert.ok(problems.some((problem) => /used by both/.test(problem)));
  assert.ok(problems.some((problem) => /dates must be consecutive/.test(problem)));
});

test('cancel settles an active pre-generated audio promise', async () => {
  const originalWindow = globalThis.window;
  const originalAudio = globalThis.Audio;
  const originalFetch = globalThis.fetch;
  const instances = [];

  class FakeAudio {
    constructor() { this.paused = false; instances.push(this); }
    play() { return new Promise(() => {}); }
    pause() { this.paused = true; }
  }

  globalThis.window = { speechSynthesis: null };
  globalThis.Audio = FakeAudio;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ lessons: { fixture: { 'edge-us': ['s1'] } } }),
  });

  try {
    const tts = await import(`../js/tts.js?cancel-active=${Date.now()}`);
    const playing = tts.say('Hello.', {
      lessonId: 'fixture', sentenceId: 's1', voiceId: 'edge-us',
    });
    for (let i = 0; i < 20 && !instances.length; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(instances.length, 1);
    tts.cancel();
    await Promise.race([
      playing,
      new Promise((_, reject) => setTimeout(() => reject(new Error('cancel did not settle')), 100)),
    ]);
    assert.equal(instances[0].paused, true);
  } finally {
    globalThis.window = originalWindow;
    globalThis.Audio = originalAudio;
    globalThis.fetch = originalFetch;
  }
});

test('cancel during manifest loading prevents late audio from starting', async () => {
  const originalWindow = globalThis.window;
  const originalAudio = globalThis.Audio;
  const originalFetch = globalThis.fetch;
  const instances = [];
  let releaseManifest;

  globalThis.window = { speechSynthesis: null };
  globalThis.Audio = class { constructor() { instances.push(this); } };
  globalThis.fetch = () => new Promise((resolve) => { releaseManifest = resolve; });

  try {
    const tts = await import(`../js/tts.js?cancel-manifest=${Date.now()}`);
    const playing = tts.say('Hello.', {
      lessonId: 'fixture', sentenceId: 's1', voiceId: 'edge-us',
    });
    for (let i = 0; i < 20 && !releaseManifest; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(typeof releaseManifest, 'function');
    tts.cancel();
    releaseManifest({
      ok: true,
      json: async () => ({ lessons: { fixture: { 'edge-us': ['s1'] } } }),
    });
    await playing;
    assert.equal(instances.length, 0);
  } finally {
    globalThis.window = originalWindow;
    globalThis.Audio = originalAudio;
    globalThis.fetch = originalFetch;
  }
});

test('every routed view is available in the offline app shell', async () => {
  const [app, serviceWorker] = await Promise.all([
    readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../sw.js', import.meta.url), 'utf8'),
  ]);
  const views = [...app.matchAll(/import\('\.\/(views\/[^']+\.js)'\)/g)]
    .map((match) => `./js/${match[1]}`);
  assert.ok(views.includes('./js/views/player.js'));
  // Quote-agnostic: the formatter is free to restyle sw.js.
  const listed = (path) => serviceWorker.includes(`'${path}'`) || serviceWorker.includes(`"${path}"`);
  for (const view of views) assert.ok(listed(view), `${view} missing from SHELL`);
  assert.ok(listed('./js/daily.js'));

  const { caches, stores } = fakeCaches();
  const handlers = {};
  let skippedWaiting = 0;
  const workerSelf = {
    ECHO_VERSION: { app: '2026.08.16.1', cache: 'v202608161' },
    addEventListener: (name, handler) => { handlers[name] = handler; },
    skipWaiting: () => { skippedWaiting += 1; },
    clients: {
      claim: async () => {},
      matchAll: async () => [],
    },
    location: { origin: 'https://example.test' },
  };
  runInNewContext(serviceWorker, {
    self: workerSelf,
    importScripts: () => {},
    caches,
    fetch: async () => ({
      ok: true,
      clone: () => ({
        json: async () => ({
          lessons: [
            { id: 'daily-2026-08-14', daily: { date: '2026-08-14' } },
            { id: 'regular-lesson' },
          ],
        }),
      }),
    }),
    encodeURIComponent,
    URL,
    Response,
  });

  const run = async (name, event = {}) => {
    let pending;
    handlers[name]({ ...event, waitUntil: (promise) => { pending = promise; } });
    await pending;
  };

  await run('install');
  assert.equal(skippedWaiting, 0,
    'an upgrade stays waiting until the learner accepts it');
  const content = [...(stores.get('echo-content')?.keys() || [])];
  assert.ok(content.includes('./content/lessons/daily-2026-08-14.json'),
    'daily stories precache into the content cache');
  assert.ok(!content.includes('./content/lessons/regular-lesson.json'));
  assert.ok([...stores.keys()].some((k) => /^echo-v\d+$/.test(k)), 'shell has its own versioned cache');

  const activeShell = stores.get('echo-v202608161');
  const appRequest = {
    method: 'GET',
    mode: 'same-origin',
    url: 'https://example.test/js/app.js',
  };
  activeShell.set(appRequest.url, 'the active release');
  let fetched;
  handlers.fetch({ request: appRequest, respondWith: (promise) => { fetched = promise; } });
  assert.equal(await fetched, 'the active release');
  await Promise.resolve();
  assert.equal(activeShell.get(appRequest.url), 'the active release',
    'background network traffic cannot mutate the running shell generation');

  /* Shipping a release must not cost the learner their audio. Content used to
     live in the versioned bucket, so bumping the version deleted every clip
     they had played and a phone re-fetched them over mobile data. */
  const old = stores.get('echo-v6') || stores.set('echo-v6', new Map()).get('echo-v6');
  old.set('https://example.test/js/app.js', 'stale shell');
  old.set('https://example.test/content/audio/kokoro-us/l3-01/s1.mp3', 'a clip already played');
  stores.set('echo-offline', new Map([['https://example.test/content/audio/l1-01/s1.mp3', 'pinned']]));

  await run('activate');
  const survivors = [...stores.keys()];
  assert.ok(!survivors.includes('echo-v6'), 'the old shell cache is retired');
  assert.ok(survivors.includes('echo-offline'), 'explicitly pinned lessons survive');
  assert.equal(stores.get('echo-content').get('https://example.test/content/audio/kokoro-us/l3-01/s1.mp3'),
    'a clip already played', 'played audio is carried over, not deleted');
  assert.ok(!stores.get('echo-content').has('https://example.test/js/app.js'),
    'only content is carried over');

  let reply;
  handlers.message({
    data: { type: 'ECHO_GET_VERSION' },
    ports: [{ postMessage: (message) => { reply = message; } }],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(reply)), {
    type: 'ECHO_VERSION',
    version: '2026.08.16.1',
    cache: 'v202608161',
  });
  handlers.message({ data: { type: 'ECHO_SKIP_WAITING' }, ports: [] });
  assert.equal(skippedWaiting, 1,
    'the waiting worker activates only after an explicit update action');
});

test('an incomplete app shell cannot become an installable release', async () => {
  const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const handlers = {};
  const { caches } = fakeCaches();
  runInNewContext(serviceWorker, {
    self: {
      ECHO_VERSION: { app: '2026.08.16.1', cache: 'v202608161' },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      skipWaiting: () => {},
      clients: { claim: async () => {}, matchAll: async () => [] },
      location: { origin: 'https://example.test' },
    },
    importScripts: () => {},
    caches,
    fetch: async (url) => ({
      ok: url !== './js/app.js',
      status: url === './js/app.js' ? 404 : 200,
      clone() { return this; },
      json: async () => ({ lessons: [] }),
    }),
    encodeURIComponent,
    URL,
    Response,
    Error,
  });

  let install;
  handlers.install({ waitUntil: (promise) => { install = promise; } });
  await assert.rejects(install, /precache failed: \.\/js\/app\.js \(404\)/);
});

test('legacy v10 clients cross the one-time waiting-worker bridge safely', async () => {
  const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const handlers = {};
  const { caches, stores } = fakeCaches();
  stores.set('echo-v10', new Map());
  let skippedWaiting = 0;
  let navigatedTo = null;
  let posted = 0;
  runInNewContext(serviceWorker, {
    self: {
      ECHO_VERSION: { app: '2026.08.16.1', cache: 'v202608161' },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      skipWaiting: () => { skippedWaiting += 1; },
      clients: {
        claim: async () => {},
        matchAll: async () => [{
          url: 'https://example.test/#/settings',
          navigate: async (url) => { navigatedTo = url; },
          postMessage: () => { posted += 1; },
        }],
      },
      location: { origin: 'https://example.test' },
    },
    importScripts: () => {},
    caches,
    fetch: async () => ({
      ok: true,
      status: 200,
      clone() { return this; },
      json: async () => ({ lessons: [] }),
    }),
    encodeURIComponent,
    URL,
    Response,
    Error,
  });

  const run = async (name) => {
    let pending;
    handlers[name]({ waitUntil: (promise) => { pending = promise; } });
    await pending;
  };
  await run('install');
  assert.equal(skippedWaiting, 1,
    'only the legacy release activates without the new page button');
  await run('activate');
  assert.equal(navigatedTo, 'https://example.test/#/settings',
    'legacy pages immediately reload under the complete new shell');
  assert.equal(posted, 0, 'the legacy page cannot consume the new message protocol');
  assert.ok(!stores.has('echo-v10'));
});

/** Minimal in-memory CacheStorage, enough to drive the service worker. */
function fakeCaches() {
  const stores = new Map();
  const key = (req) => (typeof req === 'string' ? req : req.url);
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      add: async (url) => { store.set(String(url), 'added'); },
      put: async (req, res) => { store.set(key(req), res); },
      match: async (req) => store.get(key(req)) ?? null,
      keys: async () => [...store.keys()].map((url) => ({ url })),
    };
  };
  return {
    stores,
    caches: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
      match: async (req) => {
        for (const store of stores.values()) if (store.has(key(req))) return store.get(key(req));
        return null;
      },
    },
  };
}

test('every accent falls back through the core sets, never to the device voice', () => {
  // Core sets ship with every lesson; the accent packs may not exist yet.
  assert.deepEqual(CORE_VOICES, ['kokoro-us', 'kokoro-gb', 'edge-us', 'edge-gb']);
  for (const voice of VOICES) assert.ok(fallbackChain(voice.id, voice.lang).length > 1);

  const nz = fallbackChain('edge-nz', 'en-NZ');
  assert.equal(nz[0], 'edge-nz', 'the chosen voice is tried first');
  assert.ok(CORE_VOICES.includes(nz[1]), 'then a core set, not the device voice');
  assert.equal(new Set(nz).size, nz.length, 'no voice is tried twice');

  // An accent that has core sets of its own keeps the accent before leaving it.
  const gb = fallbackChain('kokoro-gb', 'en-GB');
  assert.equal(gb[1], 'edge-gb', 'stay in the accent while a core set has it');
  assert.ok(gb.includes('edge-us'));
});

test('hands-free follows the story before it follows the library', () => {
  const index = [
    { id: 'daily-2026-08-17', level: 3, type: 'article',
      daily: { seriesId: 'market', day: 1, date: '2026-08-17' } },
    { id: 'daily-2026-08-18', level: 3, type: 'article',
      daily: { seriesId: 'market', day: 2, date: '2026-08-18' } },
    { id: 'daily-2026-08-20', level: 3, type: 'article',
      daily: { seriesId: 'swim', day: 1, date: '2026-08-20' } },
    { id: 'l2-01', level: 2, type: 'dialogue' },
    { id: 'l3-01', level: 3, type: 'dialogue' },
    { id: 'l3-02', level: 3, type: 'dialogue' },
    { id: 'l5-01', level: 5, type: 'dialogue' },
  ];
  const byId = (id) => index.find((l) => l.id === id);

  // Day 2 of the same story wins over anything else.
  assert.equal(nextLessonFor(index, byId('daily-2026-08-17')).id, 'daily-2026-08-18');
  // Series over: the next published day, even in another series.
  assert.equal(nextLessonFor(index, byId('daily-2026-08-18')).id, 'daily-2026-08-20');
  // Nothing later than the last story.
  assert.equal(nextLessonFor(index, byId('daily-2026-08-20')), null);

  // Library lessons advance in order and never jump more than one level.
  assert.equal(nextLessonFor(index, byId('l3-01')).id, 'l3-02');
  assert.equal(nextLessonFor(index, byId('l3-02')), null, 'L5 is out of reach from L3');
  assert.equal(nextLessonFor(index, byId('l2-01')).id, 'l3-01');
  assert.equal(nextLessonFor(index, null), null);
});

test('the retrieval cue always leaves something to retrieve', () => {
  const text = 'Every morning at seven she walks up the hill.';
  assert.equal(wordsOf(text).length, 9);

  const none = recallCue(text, 0);
  assert.equal(none.lead, '');
  assert.equal(none.missing, 9, 'with no run-up the whole sentence is produced');

  const two = recallCue(text, 2);
  assert.equal(two.lead, 'Every morning');
  assert.equal(two.missing, 7);

  // A run-up longer than the sentence would turn the drill back into reading.
  const greedy = recallCue('Two words', 9);
  assert.equal(greedy.missing, 1, 'at least one word is always withheld');
  assert.deepEqual(recallCue('', 2), { lead: '', missing: 0, total: 0 });
});

test('thinking time scales with the sentence but stays inside sane bounds', () => {
  const short = thinkingMs('Hello there.');
  const long = thinkingMs(new Array(40).fill('word').join(' '));
  assert.ok(long > short, 'a longer sentence gets longer to retrieve');
  assert.ok(short >= 2500, 'never so short that there is no time to reach');
  assert.ok(long <= 12000, 'never so long that the drill stalls');
  assert.equal(thinkingMs(''), 2500);
});

test('retrieval is gated on having recognised the sentence first', () => {
  // Producing a sentence you have never understood tests nothing.
  assert.equal(readyForRecall({ reps: 0, lastGrade: 2 }), false);
  assert.equal(readyForRecall({ reps: 2, lastGrade: 0 }), false, 'a lapse goes back to recognition');
  assert.equal(readyForRecall({ reps: 1, lastGrade: 1 }), true);
  assert.equal(readyForRecall(null), false);

  const queue = [
    { id: 'new', reps: 0, lastGrade: 2 },
    { id: 'ready', reps: 3, lastGrade: 2 },
    { id: 'lapsed', reps: 4, lastGrade: 0 },
  ];
  // The harder, more valuable rep goes first so a short session gets it.
  assert.deepEqual(orderForRecall(queue).map((c) => c.id), ['ready', 'new', 'lapsed']);
  assert.equal(orderForRecall(queue).length, queue.length, 'nothing is dropped');
});
