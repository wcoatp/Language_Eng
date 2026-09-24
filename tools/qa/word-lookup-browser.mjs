import { parseWiktionary } from '../../js/dictionary.js';
import { lookupText, selectionIn, openLookup, closeLookup } from '../../js/word-lookup.js';

let failures = 0;
const results = document.getElementById('results');
function check(label, test) {
  const item = document.createElement('li');
  try { test(); item.textContent = `PASS ${label}`; }
  catch (error) { failures++; item.textContent = `FAIL ${label}: ${error.message}`; }
  results.append(item);
}
function assert(ok, message = 'assertion failed') { if (!ok) throw Error(message); }

// Synthetic fixture, not copied dictionary definitions or quotation text.
const html = `<div class="mw-parser-output">
<div class="mw-heading mw-heading2"><h2 id="French">French</h2></div><h3>Noun</h3><ol><li>Wrong language.</li></ol>
<div class="mw-heading mw-heading2"><h2 id="English">English</h2></div>
<div class="mw-heading mw-heading3"><h3>Verb</h3></div><p>headword</p>
<ol><li>First English definition.<dl><dd>EXAMPLE TO OMIT</dd></dl><ul><li>COPYRIGHT QUOTATION TO OMIT</li></ul></li>
<li>Second definition.<script>window.dictionaryInjected=true</script></li></ol>
<div class="mw-heading mw-heading4"><h4>Translations</h4></div>
<div class="NavFrame"><div class="NavHead">first meaning</div><span class="Hant" lang="cmn">繁體</span><span class="Hans" lang="cmn">繁体</span><span class="Hani" lang="cmn">中性</span><span lang="yue">不要廣東話</span></div>
<div class="NavFrame"><div class="NavHead">second meaning</div><span class="Hans" lang="cmn">锻炼</span></div>
<div class="mw-heading mw-heading2"><h2 id="Spanish">Spanish</h2></div><h3>Noun</h3><ol><li>Wrong language again.</li></ol></div>`;

const result = parseWiktionary(html, 'work out', 123);
check('WL-02 English section only, POS and definitions', () => {
  assert(result.definitions.length === 2);
  assert(result.definitions[0].pos === 'verb');
  assert(result.definitions[0].text === 'First English definition.');
});
check('WL-02 Chinese translations retain sense groups and prefer Traditional Chinese', () => {
  assert(result.translations.length === 2);
  assert(result.translations[0].terms.join('/') === '繁體/中性');
  assert(result.translations[1].script === 'simplified');
});
check('WL-06 no scripts, quotations or third-party HTML enter the live document', () => {
  assert(!window.dictionaryInjected);
  assert(!document.querySelector('.mw-parser-output'));
  assert(!JSON.stringify(result).includes('COPYRIGHT'));
});
check('WL-02 English missing is not taken from another language', () => {
  assert(parseWiktionary('<h2 id="French">French</h2><h3>Noun</h3><ol><li>Only French.</li></ol>', 'word', 1) === null);
});
check('WL-02 old heading markup remains supported', () => {
  const old = parseWiktionary('<h2><span id="English">English</span></h2><h3>Adjective</h3><ol><li>Old layout.</li></ol>', 'word', 1);
  assert(old?.definitions[0]?.text === 'Old layout.');
});
const text = "We work out the cost. It's useful.";
const content = lookupText(text);
document.getElementById('fixture').append(content);
check('WL-01 rendering preserves sentence text and punctuation', () => {
  assert(content.querySelector('.lookup-content').textContent === text);
  assert(content.querySelectorAll('[role="button"]').length === 7);
});
check('WL-01 same-sentence selection is accepted, cross-sentence selection rejected', () => {
  const words = content.querySelectorAll('.lookup-word');
  const range = document.createRange();
  range.setStart(words[1].firstChild, 0); range.setEnd(words[2].firstChild, 3);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  assert(selectionIn(content.querySelector('.lookup-content')) === 'work out');
  content.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
  assert(!content.querySelector('.lookup-selection').hidden);
  assert(content.querySelector('.lookup-selection').textContent.includes('work out'));
  range.setEnd(results.firstChild.firstChild, 3);
  assert(selectionIn(content.querySelector('.lookup-content')) === '');
  selection.removeAllRanges();
  content.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
});
async function asyncCheck(label, test) {
  const item = document.createElement('li');
  try { await test(); item.textContent = `PASS ${label}`; }
  catch (error) { failures++; item.textContent = `FAIL ${label}: ${error.message}`; }
  finally { closeLookup(); }
  results.append(item);
}
await asyncCheck('WL-04/08 modal stays focused after loading; close restores trigger', async () => {
  const trigger = content.querySelector('.lookup-word');
  let paused = false;
  await openLookup('work out', {}, { trigger, onOpen: () => { paused = true; } });
  const dialog = document.querySelector('.dictionary-dialog');
  assert(paused && dialog.open);
  assert(dialog.contains(document.activeElement));
  assert(dialog.textContent.includes('work out'));
  closeLookup();
  assert(document.activeElement === trigger);
});
await asyncCheck('WL-09 closing during local async load cannot resurrect the dialog', async () => {
  const pending = openLookup('record');
  closeLookup();
  await pending;
  assert(!document.querySelector('.dictionary-dialog'));
});
const summary = document.createElement('h2');
summary.textContent = failures ? `${failures} FAILED` : 'ALL PASSED';
document.getElementById('view').prepend(summary);
document.title = failures ? 'FAIL: SDD-001' : 'PASS: SDD-001';

document.getElementById('reset-preview').onclick = async () => {
  const status = document.getElementById('preview-status');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    status.textContent = '僅允許本機測試環境。'; return;
  }
  const registration = await navigator.serviceWorker?.getRegistration('/');
  if (registration && new URL(registration.scope).origin === location.origin) {
    await registration.unregister();
    status.textContent = '已停用此本機預覽的 worker；未刪除 IndexedDB、快取或音檔。請重新開啟預覽分頁。';
  } else status.textContent = '此預覽沒有已註冊的 worker。';
};
