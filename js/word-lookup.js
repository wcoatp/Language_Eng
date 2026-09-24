/* SDD-001: shared word selection and dictionary dialog. */
import { el, mount, toast } from './ui.js';
import { kvGet, kvSet } from './db.js';
import { say, cancel, unlock } from './tts.js';
import { wordTokens, normalizeTerm, phraseAt, lookupLocal, dictionaryUrl,
  fetchDictionary, cacheResult, bookmarkKey, toggleBookmark } from './dictionary.js';

let active = null;
let writeQueue = Promise.resolve();
// Serialize read/modify/write operations across quickly opened dialogs.
function updateStored(key, update) {
  const work = writeQueue.catch(() => {}).then(async () => {
    const next = update(await kvGet(key, []));
    await kvSet(key, next);
    return next;
  });
  writeQueue = work;
  return work;
}

export function selectionIn(container, selection = globalThis.getSelection?.()) {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return '';
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return '';
  return normalizeTerm(selection.toString());
}

export function lookupText(text, context = {}, { tag = 'span', className = '', onOpen = cancel } = {}) {
  const content = el('span', { class: 'lookup-content' });
  const wrap = el(tag, { class: `lookup-text ${className}`.trim() }, [content]);
  let at = 0;
  for (const token of wordTokens(text)) {
    content.append(document.createTextNode(text.slice(at, token.start)));
    const word = el('span', { class: 'lookup-word', role: 'button', tabindex: '0',
      'aria-label': `查詞 ${token.text}`, text: token.text });
    const activate = () => {
      if (selectionIn(content)) return;
      const phrase = phraseAt(text, token.start, token.end);
      openLookup(phrase || token.text, { ...context, text }, {
        trigger: word, singleWord: phrase ? token.text : '', onOpen,
      });
    };
    word.addEventListener('click', e => { e.stopPropagation(); activate(); });
    word.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); activate(); }
    });
    content.append(word);
    at = token.end;
  }
  content.append(document.createTextNode(text.slice(at)));
  const selectionButton = el('button', { type: 'button', class: 'lookup-selection chip', hidden: true });
  let selected = '';
  const capture = () => {
    if (!wrap.isConnected) return;
    selected = selectionIn(content);
    selectionButton.hidden = !selected;
    selectionButton.textContent = selected ? `查選取的字詞：${selected}` : '';
  };
  wrap.addEventListener('pointerup', () => setTimeout(capture, 0));
  wrap.addEventListener('keyup', capture);
  // Text selection and whitespace taps must not bubble to sentence playback.
  wrap.addEventListener('click', e => e.stopPropagation());
  selectionButton.addEventListener('click', e => {
    e.stopPropagation();
    const term = selected;
    if (term) openLookup(term, { ...context, text }, { trigger: selectionButton, onOpen });
  });
  wrap.append(selectionButton);
  return wrap;
}

export function closeLookup({ restoreFocus = true } = {}) {
  if (!active) return;
  const state = active;
  active = null;
  state.controller?.abort();
  if (state.speaking) cancel();
  state.dialog.close();
  state.dialog.remove();
  if (restoreFocus) {
    if (state.trigger?.isConnected) state.trigger.focus();
    else {
      const view = document.getElementById('view');
      view?.setAttribute('tabindex', '-1');
      view?.focus({ preventScroll: true });
    }
  }
}

export async function openLookup(raw, context = {}, options = {}) {
  const term = normalizeTerm(raw);
  if (!term) { toast('請選取同一句內 1–6 個英文單字。'); return; }
  closeLookup({ restoreFocus: false });
  options.onOpen?.();
  const dialog = el('dialog', { class: 'dictionary-dialog', 'aria-labelledby': 'dictionary-title' });
  const state = { dialog, term, context, trigger: options.trigger || document.activeElement,
    result: lookupLocal(term, context) || context.result || null, language: 'zh', busy: false, ready: false,
    error: '', bookmarks: [], singleWord: options.singleWord || '', onSaved: options.onSaved,
    onResolved: options.onResolved };
  active = state;
  dialog.addEventListener('cancel', e => { e.preventDefault(); closeLookup(); });
  dialog.addEventListener('keydown', e => e.stopPropagation());
  dialog.addEventListener('click', e => { if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeLookup();
  } });
  document.body.append(dialog);
  paint(state);
  dialog.showModal();
  dialog.querySelector('[data-close]')?.focus();
  try {
    const [language, bookmarks, cache] = await Promise.all([
      kvGet('dictionaryLanguage', 'zh'), kvGet('vocabularyBookmarks', []), kvGet('dictionaryCache', []),
    ]);
    if (active !== state) return;
    state.language = language === 'en' ? 'en' : 'zh';
    state.bookmarks = Array.isArray(bookmarks) ? bookmarks : [];
    if (!state.result) {
      const hit = Array.isArray(cache) && cache.find(e => e.term === term);
      if (hit?.result) {
        state.result = hit.result; state.cached = true;
        state.onResolved?.(state.result);
        updateStored('dictionaryCache', rows => cacheResult(rows, term, hit.result)).catch(() => {});
      }
    }
  } catch { state.storageError = '裝置儲存暫不可用，仍可查詞。'; }
  if (active === state) { state.ready = true; paint(state); }
}

function link(label, href) {
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: label });
}

function paint(state) {
  if (active !== state) return;
  const focusKey = state.dialog.contains(document.activeElement) ? document.activeElement.dataset.focus : '';
  const result = state.result;
  const id = bookmarkKey(state.term, state.context);
  const saved = state.bookmarks.some(e => e.id === id);
  const switchLanguage = async language => {
    state.language = language;
    paint(state);
    try { await kvSet('dictionaryLanguage', language); } catch { toast('偏好未儲存'); }
  };
  mount(state.dialog,
    el('div', { class: 'dictionary-head' }, [
      el('div', {}, [el('h2', { id: 'dictionary-title', text: state.term }),
        el('div', { class: 'muted', text: result?.contextual ? '本句意思 · 已編輯' : '一般字詞解釋 · 請依上下文選義' })]),
      el('button', { type: 'button', class: 'btn dictionary-close', 'aria-label': '關閉查詞',
        'data-close': '', 'data-focus': 'close', onclick: () => closeLookup() }, ['✕']),
    ]),
    state.singleWord ? el('button', { type: 'button', class: 'chip', 'data-focus': 'single',
      onclick: () => openLookup(state.singleWord, state.context, { trigger: state.trigger }) }, [`只查單字 ${state.singleWord}`]) : null,
    result?.word && result.word !== state.term ? el('p', { class: 'hint', text: `字典原形：${result.word}` }) : null,
    result?.sourceUrl && lookupLocal(state.term, state.context) ? el('button', {
      type: 'button', class: 'chip', onclick: () => {
        state.result = lookupLocal(state.term, state.context); state.error = ''; paint(state);
      },
    }, ['回到內建／本課解釋']) : null,
    el('div', { class: 'dictionary-tabs', role: 'group', 'aria-label': '解釋語言' }, [
      ...[['zh', '英中'], ['en', '英英']].map(([language, label]) => el('button', {
        type: 'button', class: `chip ${state.language === language ? 'is-on' : ''}`,
        'aria-pressed': String(state.language === language), 'data-focus': language,
        onclick: () => switchLanguage(language),
      }, [label])),
      el('button', { type: 'button', class: 'chip', 'data-focus': 'speak', onclick: async () => {
        unlock(); state.speaking = true;
        try { await say(state.term, { langCode: 'en-US', rate: 0.85 }); }
        catch { toast('此裝置暫無可用的英語發音'); }
        finally { state.speaking = false; }
      } }, ['▶ 發音']),
    ]),
    el('div', { class: 'dictionary-results', 'aria-live': 'polite' }, [
      state.busy ? el('p', { text: '正在查詢開放字典…' }) : null,
      state.error ? el('p', { class: 'dictionary-error', text: state.error }) : null,
      result ? meanings(result, state.language) : el('p', {
        text: state.ready ? '內建小詞庫尚未收錄。可按下方按鈕查詢其他字詞。' : '讀取裝置詞庫…',
      }),
    ]),
    result?.lemma && result.lemma !== state.term ? el('button', { type: 'button', class: 'chip',
      onclick: () => openLookup(result.lemma, state.context, { trigger: state.trigger }) }, [`查原形 ${result.lemma}`]) : null,
    state.context.text ? el('details', { class: 'dictionary-context' }, [
      el('summary', { text: '回看原句' }), el('p', { text: state.context.text }),
      state.context.zh ? el('p', { class: 'hint', text: state.context.zh }) : null,
    ]) : null,
    el('div', { class: 'dictionary-actions' }, [
      el('button', { type: 'button', class: 'btn btn-primary', disabled: !state.ready || state.saving,
        'data-focus': 'save', onclick: () => saveWord(state) }, [saved ? '✓ 已收藏 · 點此移除' : '＋ 收藏生字']),
      el('button', { type: 'button', class: 'btn', disabled: state.busy || !state.ready, 'data-focus': 'online',
        onclick: () => online(state) }, [state.error ? '重新查詢' : '查開放字典']),
    ]),
    el('p', { class: 'hint', text: '只有按「查開放字典」才連線；僅傳送所選字詞，不傳課文或學習紀錄。' }),
    state.storageError ? el('p', { class: 'hint', text: state.storageError }) : null,
    el('div', { class: 'dictionary-source' }, result?.sourceUrl ? [
      link('來源：Wiktionary contributors', dictionaryUrl(state.term)), ' · ',
      link('CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'),
      el('div', { text: `已摘錄文字${result.revision ? ` · 修訂 ${result.revision}` : ''}${state.cached ? ' · 裝置快取' : ''}` }),
    ] : [el('span', { text: result?.source || '尚無詞條' }), ' · ', link('查看維基詞典', dictionaryUrl(state.term))]),
  );
  if (state.dialog.open) {
    const next = focusKey && state.dialog.querySelector(`[data-focus="${focusKey}"]`);
    // A pending save/lookup disables its button. Keep focus in the modal even
    // when a repaint removes the previously focused control.
    (next && !next.disabled ? next : state.dialog.querySelector('[data-close]'))
      ?.focus({ preventScroll: true });
  }
}

function meanings(result, language) {
  const rows = language === 'en' ? result.definitions : result.translations;
  if (!rows?.length) return el('p', { text: language === 'zh'
    ? '此詞條暫缺中文翻譯；可切換英英或查看來源。' : '此詞條暫缺英文解釋；可切換英中或查看來源。' });
  return el('ol', { class: 'dictionary-meanings' }, rows.map(row => el('li', {}, [
    el('div', { class: 'muted', text: language === 'en' ? row.pos : row.sense }),
    el('div', { text: language === 'en' ? row.text : row.terms.join('；') }),
    row.script === 'simplified' ? el('small', { class: 'hint', text: '來源僅提供簡體中文，未自動轉換。' }) : null,
  ])));
}

async function online(state) {
  if (active !== state || state.busy) return;
  state.busy = true; state.error = ''; state.controller = new AbortController(); paint(state);
  try {
    const result = await fetchDictionary(state.term, { signal: state.controller.signal });
    if (active !== state) return;
    // Explicit online lookup shows general meanings; a button returns to the authored entry.
    state.result = result; state.cached = false;
    state.onResolved?.(result);
    await updateStored('dictionaryCache', rows => cacheResult(rows, state.term, result));
  } catch (error) {
    if (active !== state || error.name === 'AbortError') return;
    if (error.code) state.error = error.message;
    else state.storageError = '查詢成功，但快取未儲存。';
  } finally { if (active === state) { state.busy = false; paint(state); } }
}

async function saveWord(state) {
  if (state.saving || active !== state) return;
  state.saving = true; paint(state);
  try {
    const entry = { id: bookmarkKey(state.term, state.context), term: state.term,
      lessonId: state.context.lessonId || '', sentenceId: state.context.sentenceId || '',
      lessonTitle: state.context.lessonTitle || '', text: state.context.text || '', zh: state.context.zh || '',
      result: state.result, savedAt: Date.now() };
    state.bookmarks = await updateStored('vocabularyBookmarks', rows => toggleBookmark(rows, entry));
    await state.onSaved?.();
    if (active === state) toast(state.bookmarks.some(e => e.id === entry.id) ? '已加入生字收藏' : '已移除收藏');
  } catch { if (active === state) toast('收藏未儲存，請檢查裝置儲存空間'); }
  finally { if (active === state) { state.saving = false; paint(state); } }
}

export async function vocabularySection() {
  const box = el('div', { class: 'card' });
  const draw = async () => {
    let words = [];
    try { words = await kvGet('vocabularyBookmarks', []); } catch { /* show empty state */ }
    if (!Array.isArray(words)) words = [];
    mount(box,
    el('p', { text: words.length ? `已收藏 ${words.length} 個字詞；點開可複習或移除。` : '在課文點選字詞，再按「收藏生字」。收藏會保留原句，不影響句子熟練度。' }),
    ...words.map(word => el('button', { type: 'button', class: 'vocabulary-item', onclick: e =>
      openLookup(word.term, word, { trigger: e.currentTarget, onOpen: cancel, onSaved: draw }) }, [
      el('b', { text: word.term }), el('span', { class: 'muted', text: word.lessonTitle || '一般字詞' }),
    ])),
    el('p', { class: 'hint', text: '收藏包含在「完整資料備份」中。內建詞與成功快取的查詢可離線查看。' }),
    );
  };
  await draw();
  return box;
}
