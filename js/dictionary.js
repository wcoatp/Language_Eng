/* SDD-001: dictionary data/lookup logic. No learner state and no automatic network calls. */
import { LOCAL_DICTIONARY, CONTEXT_SENSES } from './dictionary-data.js';

export const DICTIONARY_LICENSE = 'https://creativecommons.org/licenses/by-sa/4.0/';
const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*/g;
const forms = new Map(Object.values(LOCAL_DICTIONARY).flatMap(e => e.forms.map(f => [f, e.word])));

export function wordTokens(text) {
  return [...String(text).matchAll(WORD_RE)].map(m => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
}

export function normalizeTerm(value) {
  const term = String(value ?? '').trim().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').toLowerCase();
  if (term.length > 80 || !/^[a-z]+(?:['-][a-z]+)*(?: [a-z]+(?:['-][a-z]+)*){0,5}$/.test(term)) return '';
  return term;
}

export function phraseAt(text, start, end) {
  const candidates = Object.keys(LOCAL_DICTIONARY).concat([...forms.keys()]).filter(k => k.includes(' '));
  const lower = text.toLowerCase().replace(/’/g, "'");
  let best = null;
  for (const phrase of candidates) {
    let at = lower.indexOf(phrase);
    while (at >= 0) {
      const finish = at + phrase.length;
      if (at <= start && finish >= end && !/[a-z'-]/i.test(lower[at - 1] || '') &&
          !/[a-z'-]/i.test(lower[finish] || '') && (!best || phrase.length > best.length)) best = phrase;
      at = lower.indexOf(phrase, at + 1);
    }
  }
  return best;
}

export function lookupLocal(raw, { lessonId, sentenceId } = {}) {
  const term = normalizeTerm(raw);
  const word = Object.hasOwn(LOCAL_DICTIONARY, term) ? term : forms.get(term);
  const entry = LOCAL_DICTIONARY[word];
  if (!entry) return null;
  const context = CONTEXT_SENSES.find(([l, ids, w]) => l === lessonId && ids.includes(sentenceId) && w === word);
  const senses = context ? [{ ...entry.senses[0], zh: context[3] }] : entry.senses;
  return {
    word, requested: term, contextual: !!context, source: 'Echo 自編學習詞庫',
    definitions: senses.map(s => ({ pos: s.pos, text: s.en })),
    translations: senses.map(s => ({ sense: s.pos, terms: [s.zh], script: 'traditional' })),
  };
}

export function dictionaryUrl(term) {
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(normalizeTerm(term).replace(/ /g, '_'))}`;
}

export function dictionaryRequestUrl(term) {
  const clean = normalizeTerm(term);
  if (!clean) throw new Error('請選取 1–6 個英文單字。');
  const url = new URL('https://en.wiktionary.org/w/api.php');
  url.search = new URLSearchParams({ action: 'parse', page: clean, prop: 'text|revid',
    format: 'json', formatversion: '2', origin: '*', redirects: '1', disableeditsection: '1' }).toString();
  return url.href;
}

const cleanText = value => String(value || '').replace(/\s+/g, ' ').trim();
const PARTS = new Set(['Noun', 'Verb', 'Adjective', 'Adverb', 'Pronoun', 'Preposition', 'Conjunction',
  'Interjection', 'Determiner', 'Article', 'Particle', 'Phrase', 'Proper noun', 'Numeral']);

/** Parse inside an inert template; never append third-party markup or media to the page. */
export function parseWiktionary(html, term, revision, doc = globalThis.document) {
  const template = doc.createElement('template');
  template.innerHTML = String(html);
  const heading = template.content.querySelector('[id="English"]');
  if (!heading) return null;
  const section = doc.createElement('template');
  const headBlock = heading.closest('.mw-heading') || heading.closest('h2') || heading;
  for (let node = headBlock.nextElementSibling; node; node = node.nextElementSibling) {
    if (node.matches('h2, .mw-heading2') || node.querySelector('h2')) break;
    section.content.append(node.cloneNode(true));
  }
  const definitions = [];
  let pos = '';
  for (const node of section.content.children) {
    const h = node.matches('h3,h4,h5') ? node : node.querySelector('h3,h4,h5');
    if (h) {
      const name = cleanText(h.textContent).replace(/\s+\d+$/, '');
      pos = PARTS.has(name) ? name.toLowerCase() : '';
    }
    if (node.tagName !== 'OL' || !pos) continue;
    for (const li of node.children) {
      if (li.tagName !== 'LI') continue;
      const copy = li.cloneNode(true);
      copy.querySelectorAll('dl,ul,ol,script,style,sup,.citation-whole,.h-quotation,.h-usage-example,.nyms').forEach(n => n.remove());
      const text = cleanText(copy.textContent).slice(0, 600);
      if (text && definitions.length < 8) definitions.push({ pos, text });
    }
  }
  const translations = [];
  for (const frame of section.content.querySelectorAll('.NavFrame')) {
    const terms = [...frame.querySelectorAll('[lang="cmn"], [lang="zh"], [lang="zh-Hant"]')]
      .filter(n => !n.classList.contains('Hans')).map(n => cleanText(n.textContent)).filter(Boolean);
    if (terms.length && translations.length < 8) translations.push({
      sense: cleanText(frame.querySelector('.NavHead')?.textContent).slice(0, 160),
      terms: [...new Set(terms)].slice(0, 10), script: 'traditional',
    });
    // Do not silently label a simplified-only translation as Traditional Chinese.
    if (!terms.length && translations.length < 8) {
      const original = [...frame.querySelectorAll('.Hans[lang="cmn"], .Hans[lang="zh"]')]
        .map(n => cleanText(n.textContent)).filter(Boolean);
      if (original.length) translations.push({ sense: cleanText(frame.querySelector('.NavHead')?.textContent).slice(0, 160),
        terms: [...new Set(original)].slice(0, 10), script: 'simplified' });
    }
  }
  if (!definitions.length && !translations.length) return null;
  const base = section.content.querySelector('.form-of-definition-link a');
  return {
    word: normalizeTerm(term), definitions, translations, contextual: false,
    lemma: normalizeTerm(base?.textContent), source: 'Wiktionary contributors',
    sourceUrl: dictionaryUrl(term), licenseUrl: DICTIONARY_LICENSE,
    revision: Number.isSafeInteger(revision) ? revision : null,
  };
}

export class DictionaryError extends Error {
  constructor(code, message) { super(message); this.name = 'DictionaryError'; this.code = code; }
}

export async function fetchDictionary(term, { signal, fetchImpl = globalThis.fetch,
  parse = parseWiktionary, timeoutMs = 10000 } = {}) {
  const url = dictionaryRequestUrl(term);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new DictionaryError('network', '字典服務暫時無法連線，請稍後重試。');
    const data = await response.json();
    if (data.error?.code === 'missingtitle') throw new DictionaryError('missing', '字典暫無這個詞條。可以改查原形或縮短片語。');
    if (!data.parse || typeof data.parse.text !== 'string') throw new DictionaryError('network', '字典服務回覆異常，請稍後重試。');
    const result = parse(data.parse.text, term, data.parse.revid);
    if (!result) throw new DictionaryError('missing', '目前無法取得這個英文詞條的解釋，請查看來源或改查原形。');
    return result;
  } catch (error) {
    if (timedOut) throw new DictionaryError('network', '查詞逾時，請確認網路後重試。');
    if (controller.signal.aborted) throw new DOMException('Lookup cancelled', 'AbortError');
    if (error instanceof DictionaryError) throw error;
    throw new DictionaryError('network', '目前無法連線查詞；內建詞與已快取詞仍可使用。');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function cacheResult(entries, term, result, now = Date.now(), limit = 100) {
  return [{ term, result, at: now }, ...(Array.isArray(entries) ? entries : []).filter(e => e.term !== term)].slice(0, limit);
}

export function bookmarkKey(term, context = {}) {
  return JSON.stringify([normalizeTerm(term), context.lessonId || '', context.sentenceId || '']);
}

export function toggleBookmark(entries, entry) {
  const safe = Array.isArray(entries) ? entries : [];
  return safe.some(e => e.id === entry.id) ? safe.filter(e => e.id !== entry.id) : [entry, ...safe];
}
