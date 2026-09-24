import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { wordTokens, normalizeTerm, phraseAt, lookupLocal, dictionaryRequestUrl, dictionaryUrl,
  fetchDictionary, cacheResult, bookmarkKey, toggleBookmark } from '../js/dictionary.js';
import { LOCAL_DICTIONARY, CONTEXT_SENSES } from '../js/dictionary-data.js';

test('WL-01: tokenization preserves contractions, hyphens, punctuation and offsets', () => {
  const text = "I'm ready. You're well-known; we’re here!";
  const tokens = wordTokens(text);
  assert.deepEqual(tokens.map(t => t.text), ["I'm", 'ready', "You're", 'well-known', 'we’re', 'here']);
  for (const t of tokens) assert.equal(text.slice(t.start, t.end), t.text);
  assert.deepEqual(wordTokens('2026 / 中文'), []);
});

test('WL-01/WL-06: selected terms are bounded English, not arbitrary URLs or sentences', () => {
  assert.equal(normalizeTerm('  WORK   out '), 'work out');
  assert.equal(normalizeTerm('I’m'), "i'm");
  for (const bad of ['https://example.com', '<img>', '中文字', 'one two three four five six seven', '', 'a'.repeat(81)]) {
    assert.equal(normalizeTerm(bad), '');
  }
});

test('WL-03: an in-sentence phrase wins over the separate words, without substring collisions', () => {
  assert.equal(phraseAt('We work out the cost.', 3, 7), 'work out');
  assert.equal(phraseAt('We worked out the cost.', 10, 13), 'worked out');
  assert.equal(phraseAt('The workout starts now.', 4, 11), null);
  assert.equal(phraseAt('Show aboutness.', 5, 14), null);
});

test('WL-02: authored entries have usable bilingual definitions and explicit forms', () => {
  assert.ok(Object.keys(LOCAL_DICTIONARY).length >= 100);
  for (const [word, entry] of Object.entries(LOCAL_DICTIONARY)) {
    assert.equal(normalizeTerm(word), word);
    for (const sense of entry.senses) assert.ok(sense.en && sense.zh && sense.pos, word);
    for (const form of entry.forms) assert.equal(lookupLocal(form)?.word, word, form);
  }
});

test('WL-03: contextual meanings require the exact lesson AND sentence', () => {
  const context = { lessonId: 'daily-2026-08-23', sentenceId: 's7' };
  const entry = lookupLocal('work out', context);
  assert.equal(entry.contextual, true);
  assert.equal(entry.definitions.length, 1);
  assert.equal(entry.translations[0].terms[0], '推算；弄清楚');
  assert.equal(lookupLocal('work out', { ...context, sentenceId: 's1' }).contextual, false);
  assert.equal(lookupLocal('work out').definitions.length, 2);
  assert.equal(lookupLocal('inspected').word, 'inspect');
  assert.equal(lookupLocal('zznotaword'), null);
  assert.equal(lookupLocal('constructor'), null);
});

test('WL-03: curated sentence references exist and contain the intended word/form', async () => {
  for (const [lessonId, sentenceIds, word] of CONTEXT_SENSES) {
    const lesson = JSON.parse(await readFile(new URL(`../content/lessons/${lessonId}.json`, import.meta.url)));
    for (const id of sentenceIds) {
      const text = lesson.sentences.find(s => s.id === id)?.text.toLowerCase();
      assert.ok(text, id);
      assert.ok([word, ...LOCAL_DICTIONARY[word].forms].some(w => text.includes(w)), `${word} ${id}`);
    }
  }
});

test('WL-06: request contains only the selected term and public API parameters', async () => {
  const url = new URL(dictionaryRequestUrl('work out'));
  assert.equal(url.origin, 'https://en.wiktionary.org');
  assert.equal(url.searchParams.get('page'), 'work out');
  assert.equal(url.searchParams.get('origin'), '*');
  assert.equal(dictionaryUrl('work out'), 'https://en.wiktionary.org/wiki/work_out');
  assert.throws(() => dictionaryRequestUrl('https://invalid.test'));
  let options;
  const result = await fetchDictionary('apple', {
    fetchImpl: async (_url, opts) => { options = opts; return { ok: true, json: async () => ({ parse: { text: '<p>fixture</p>', revid: 123 } }) }; },
    parse: (html, term, revision) => ({ html, term, revision }),
  });
  assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.deepEqual(result, { html: '<p>fixture</p>', term: 'apple', revision: 123 });
});

test('WL-05: not-found is distinct from network failure or invalid service reply', async () => {
  const response = json => async () => ({ ok: true, json: async () => json });
  await assert.rejects(fetchDictionary('unknown', { fetchImpl: response({ error: { code: 'missingtitle' } }) }), { code: 'missing' });
  await assert.rejects(fetchDictionary('word', { fetchImpl: async () => { throw Error('offline'); } }), { code: 'network' });
  await assert.rejects(fetchDictionary('word', { fetchImpl: response({ error: { code: 'ratelimited' } }) }), { code: 'network' });
  await assert.rejects(fetchDictionary('word', { fetchImpl: async () => ({ ok: false }) }), { code: 'network' });
});

test('WL-09: closing aborts fetch; timeouts remain retryable connection errors', async () => {
  const pending = async (_url, { signal }) => new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('aborted', 'AbortError'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  const controller = new AbortController();
  const request = fetchDictionary('word', { fetchImpl: pending, signal: controller.signal });
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  await assert.rejects(fetchDictionary('word', { fetchImpl: pending, timeoutMs: 2 }), { code: 'network' });
});

test('WL-05: dictionary cache is deduplicated, bounded and keeps most recent first', () => {
  const old = Array.from({ length: 100 }, (_, i) => ({ term: `word${i}`, result: {}, at: i }));
  const next = cacheResult(old, 'apple', { word: 'apple' }, 200);
  assert.equal(next.length, 100);
  assert.equal(next[0].term, 'apple');
  assert.equal(old.length, 100);
  assert.equal(cacheResult(next, 'apple', { word: 'apple' }, 201).filter(e => e.term === 'apple').length, 1);
});

test('WL-07: bookmark identity distinguishes meanings in different sentences', () => {
  const a = { id: bookmarkKey('record', { lessonId: 'a', sentenceId: 's1' }), term: 'record' };
  const b = { id: bookmarkKey('record', { lessonId: 'a', sentenceId: 's2' }), term: 'record' };
  assert.notEqual(a.id, b.id);
  const saved = toggleBookmark(toggleBookmark([], a), b);
  assert.equal(saved.length, 2);
  assert.deepEqual(toggleBookmark(saved, a), [b]);
});

test('WL-07/WL-10: offline modules, bookmark export and deployment exclusions are wired', async () => {
  const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const shell = await read('sw.js');
  for (const module of ['dictionary.js', 'dictionary-data.js', 'word-lookup.js']) assert.ok(shell.includes(`./js/${module}`));
  assert.match(await read('js/views/settings.js'), /createBackupText/);
  assert.match(await read('js/backup.js'), /for \(const name of DATA_STORES\)/);
  assert.match(await read('js/views/listen.js'), /'aria-hidden': hidden \? 'true' : null/);
  const hosting = JSON.parse(await read('firebase.json')).hosting;
  assert.ok(hosting.ignore.includes('**/*.pdf'));
  assert.ok(hosting.ignore.includes('AGENTS.md'));
});
