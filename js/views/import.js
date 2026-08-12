/* 匯入文章 — turn any English text into a lesson.

   Works with no API key at all (split + auto difficulty). If a key is set, the
   model can also add translations, connected-speech notes and questions —
   that runs once, here, so the trainer itself never needs the network. */

import { el, toast, backButton, mount } from "../ui.js";
import { scoreDifficulty, saveUserLesson, TOPICS } from '../content.js';
import { settings } from '../store.js';
import { chat, LlmError } from '../llm.js';
import { readPack, installPack, PackError } from '../pack.js';

const ABBR = /\b(mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|approx|inc|ltd|co|no|fig|al)\.$/i;

/** Split prose into sentences, keeping abbreviations and decimals intact. */
export function splitSentences(text) {
  const clean = String(text)
    .replace(/\r/g, '')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];

  const out = [];
  let buf = '';
  const parts = clean.split(/(?<=[.!?]["')\]]?)\s+/);
  for (const part of parts) {
    buf = buf ? `${buf} ${part}` : part;
    const endsSentence = /[.!?]["')\]]?$/.test(buf);
    const looksAbbrev = ABBR.test(buf) || /\b[A-Z]\.$/.test(buf) || /\d\.$/.test(buf);
    if (endsSentence && !looksAbbrev) { out.push(buf.trim()); buf = ''; }
  }
  if (buf.trim()) out.push(buf.trim());

  // Very long sentences are unusable for shadowing — break them at clause joints.
  const final = [];
  for (const s of out) {
    if (s.split(' ').length <= 32) { final.push(s); continue; }
    let rest = s;
    while (rest.split(' ').length > 32) {
      const cut = rest.lastIndexOf(', ', Math.floor(rest.length * 0.6));
      if (cut < 30) { final.push(rest); rest = ''; break; }
      final.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 2).trim();
    }
    if (rest) final.push(rest);
  }
  return final.filter(s => /[a-z]/i.test(s));
}

export async function render(root) {
  const cfg = await settings();
  const state = { title: '', text: '', topic: 'custom', enrich: !!cfg.apiKey, busy: false };

  const preview = el('div');
  const textarea = el('textarea', {
    rows: 9, placeholder: '把英文文章貼進來…',
    oninput: e => { state.text = e.target.value; paintPreview(); },
  });

  function paintPreview() {
    const parts = splitSentences(state.text);
    if (!parts.length) { mount(preview, ); return; }
    const level = scoreDifficulty(parts);
    mount(preview, 
      el('div', { class: 'card' }, [
        el('div', { class: 'lesson-head' }, [
          el('span', { class: `badge badge-l${level}`, text: `L${level}` }),
          el('span', { class: 'lesson-title', text: '自動判定難度' }),
        ]),
        el('div', { class: 'lesson-meta' }, [
          el('span', { text: `${parts.length} 句` }),
          el('span', { text: `平均 ${Math.round(
            parts.reduce((n, s) => n + s.split(' ').length, 0) / parts.length)} 字/句` }),
        ]),
        el('div', { style: 'margin-top:12px;max-height:170px;overflow:auto' },
          parts.slice(0, 8).map((s, i) => el('div', {
            class: 'muted', style: 'padding:4px 0;border-bottom:1px solid var(--line)',
            text: `${i + 1}. ${s}`,
          }))),
        parts.length > 8
          ? el('div', { class: 'hint', style: 'margin-top:8px', text: `…還有 ${parts.length - 8} 句` })
          : null,
      ]),
    );
  }

  mount(root, 
    backButton('課程', '#/library'),
    el('h1', { style: 'margin-top:12px', text: '匯入' }),

    packSection(),

    el('h2', { text: '貼上文章' }),
    el('p', { class: 'sub' },
      ['貼上任何英文文章,自動切句、判定難度,用裝置語音朗讀。']),

    el('div', { class: 'field' }, [
      el('label', { text: '標題' }),
      el('input', {
        placeholder: '例:TED 演講 — 專注力',
        oninput: e => { state.title = e.target.value; },
      }),
    ]),

    el('div', { class: 'field' }, [
      el('label', { text: '文章內容' }),
      textarea,
      el('div', { class: 'hint' }, [
        '或 ',
        el('label', { style: 'color:var(--accent);cursor:pointer;text-decoration:underline' }, [
          '從檔案讀取 (.txt / .md)',
          el('input', {
            type: 'file', accept: '.txt,.md,text/plain,text/markdown', style: 'display:none',
            onchange: async e => {
              const f = e.target.files?.[0];
              if (!f) return;
              const raw = await f.text();
              state.text = raw;
              textarea.value = raw;
              if (!state.title) state.title = f.name.replace(/\.(txt|md)$/i, '');
              root.querySelector('input[placeholder^="例"]').value = state.title;
              paintPreview();
            },
          }),
        ]),
      ]),
    ]),

    el('div', { class: 'field' }, [
      el('label', { text: '主題' }),
      el('select', { onchange: e => { state.topic = e.target.value; } },
        Object.entries(TOPICS).map(([k, v]) =>
          el('option', { value: k, selected: k === 'custom' }, [v]))),
    ]),

    cfg.apiKey ? el('div', { class: 'card' }, [
      el('div', { class: 'switch-row', style: 'border:0;padding:0' }, [
        el('div', { class: 'lbl' }, [
          'AI 備課',
          el('small', { text: '加上中文翻譯、連讀提示與理解測驗。只在匯入時跑一次,之後離線可用。' }),
        ]),
        el('label', { class: 'switch' }, [
          el('input', { type: 'checkbox', checked: state.enrich,
            onchange: e => { state.enrich = e.target.checked; } }),
          el('span'),
        ]),
      ]),
    ]) : el('p', { class: 'hint' },
      ['設定 API key 後,匯入時可以順便產生中文翻譯與理解測驗。沒有也能正常練習。']),

    preview,

    el('button', {
      class: 'btn btn-primary btn-lg btn-block', style: 'margin-top:14px',
      onclick: async e => {
        if (state.busy) return;
        const parts = splitSentences(state.text);
        if (!parts.length) { toast('請先貼上文章'); return; }
        if (!state.title.trim()) { toast('幫這篇文章取個標題'); return; }

        const btn = e.currentTarget;
        state.busy = true;
        btn.disabled = true;

        try {
          let sentences = parts.map((t, i) => ({ id: `s${i + 1}`, text: t }));
          let questions = [];
          let titleZh = '';

          if (state.enrich && cfg.apiKey) {
            btn.textContent = 'AI 備課中…';
            try {
              const enriched = await enrich(cfg, state.title, parts);
              sentences = sentences.map((s, i) => ({ ...s, ...(enriched.sentences[i] || {}) }));
              questions = enriched.questions || [];
              titleZh = enriched.titleZh || '';
            } catch (err) {
              toast('AI 備課失敗,先存純文字版:' +
                (err instanceof LlmError ? err.message : ''));
            }
          }

          const id = `my-${Date.now().toString(36)}`;
          await saveUserLesson({
            id,
            title: state.title.trim(),
            titleZh,
            level: scoreDifficulty(parts),
            type: 'article',
            topic: state.topic,
            summaryZh: '',
            custom: true,
            sentences,
            questions,
            at: Date.now(),
          });
          toast('匯入完成');
          location.hash = `#/lesson/${id}`;
        } catch (err) {
          toast('匯入失敗:' + (err.message || ''));
        } finally {
          state.busy = false;
          btn.disabled = false;
          btn.textContent = '建立課程';
        }
      },
    }, ['建立課程']),
  );
}

/* ---------- lesson packs ---------- */

/* Packs carry real recordings cut from your own media on the Mac. They stay on
   your devices, which is why anything you do not own the rights to redistribute
   belongs here rather than in the shared course list. */
function packSection() {
  const status = el('p', { class: 'hint', style: 'margin:10px 0 0' });

  const input = el('input', {
    type: 'file', accept: '.echopack', style: 'display:none',
    onchange: async e => {
      const f = e.target.files?.[0];
      if (!f) return;
      status.style.color = '';
      status.textContent = `讀取 ${f.name}…`;
      try {
        const pack = await readPack(f);
        status.textContent = `匯入中:${pack.lessons.length} 課、${pack.total} 句…`;
        const n = await installPack(pack);
        const missing = pack.total - pack.withAudio;
        toast(`已匯入 ${n} 課`);
        status.style.color = 'var(--good)';
        status.textContent = `✓ 匯入 ${n} 課、${pack.withAudio} 段真人錄音` +
          (missing ? `(${missing} 句沒有音檔)` : '');
        setTimeout(() => { location.hash = '#/library'; }, 900);
      } catch (err) {
        status.style.color = 'var(--bad)';
        status.textContent = '✕ ' + (err instanceof PackError ? err.message : (err.message || '匯入失敗'));
      } finally {
        e.target.value = '';
      }
    },
  });

  return el('div', { class: 'card' }, [
    el('h3', { style: 'margin-bottom:6px', text: '課程包(真人錄音)' }),
    el('p', { class: 'hint', style: 'margin-bottom:12px' },
      ['在 Mac 上用 tools/align-media.mjs 把你自己的影片或 podcast 切成課程,' +
       '產生的 .echopack 用 AirDrop 傳過來匯入。音檔只存在這台裝置。']),
    el('button', {
      class: 'btn btn-block',
      onclick: () => input.click(),
    }, ['選擇 .echopack 檔案']),
    input,
    status,
  ]);
}

/* ---------- optional AI prep ---------- */

async function enrich(cfg, title, parts) {
  const numbered = parts.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const system = [
    'You prepare English listening lessons for a Taiwanese adult learner.',
    'Return ONLY a JSON object, no prose and no code fences, shaped exactly like:',
    '{"titleZh":"<Traditional Chinese title>",',
    ' "sentences":[{"zh":"<Traditional Chinese translation>","note":"<optional>"}],',
    ' "questions":[{"q":"<English comprehension question>","options":["a","b","c"],"answer":0}]}',
    'The "sentences" array MUST have exactly one entry per numbered input sentence, in order.',
    'Use Taiwan Traditional Chinese conventions.',
    '"note" is optional: include it only where there is a real connected-speech feature',
    '(linking, reduction, flapped t, contraction) worth naming. Write notes in Traditional Chinese',
    'with the English fragment inline. Omit the field entirely when there is nothing to say.',
    'Provide exactly 3 comprehension questions, each with exactly 3 options.',
  ].join('\n');

  const raw = await chat(cfg, {
    system,
    messages: [{ role: 'user', content: `Title: ${title}\n\n${numbered}` }],
    maxTokens: Math.min(8000, 400 + parts.length * 120),
  });

  const body = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('回傳格式無法解析');
  const parsed = JSON.parse(body.slice(start, end + 1));

  return {
    titleZh: typeof parsed.titleZh === 'string' ? parsed.titleZh : '',
    sentences: Array.isArray(parsed.sentences) ? parsed.sentences : [],
    questions: Array.isArray(parsed.questions)
      ? parsed.questions.filter(q =>
          q && typeof q.q === 'string' &&
          Array.isArray(q.options) && q.options.length === 3 &&
          Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 3)
      : [],
  };
}
