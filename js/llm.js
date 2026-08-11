/* Conversation backend. Multi-provider, browser-direct, bring-your-own-key.

   The key is stored only in this device's IndexedDB and is sent only to the
   provider you picked. There is no server in between. */

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    base: 'https://api.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-opus-5',   label: 'Opus 5 — 品質最好',   price: '$5 / $25' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5 — 平衡',     price: '$3 / $15' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — 便宜快',  price: '$1 / $5' },
    ],
    defaultModel: 'claude-opus-5',
  },
  openai: {
    label: 'OpenAI (GPT-5.6)',
    base: 'https://api.openai.com',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-5.6-luna',  label: 'Luna — 快又便宜(推薦)', price: '$0.2 / $1.2' },
      { id: 'gpt-5.6-terra', label: 'Terra — 平衡',           price: '—' },
      { id: 'gpt-5.6-sol',   label: 'Sol — 最強',             price: '—' },
    ],
    defaultModel: 'gpt-5.6-luna',
  },
  deepseek: {
    label: 'DeepSeek',
    base: 'https://api.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-v4-flash', label: 'V4-Flash — 最便宜', price: '$0.14 / $0.28' },
      { id: 'deepseek-v4-pro',   label: 'V4-Pro — 較強',     price: '$0.44 / $0.87' },
    ],
    defaultModel: 'deepseek-v4-flash',
  },
  custom: {
    label: '自訂 (OpenAI 相容)',
    base: '',
    keyUrl: '',
    models: [],
    defaultModel: '',
  },
};

export function modelsFor(provider) { return PROVIDERS[provider]?.models || []; }
export function defaultModelFor(provider) { return PROVIDERS[provider]?.defaultModel || ''; }

/* ---------- request shaping ---------- */

function endpoint(cfg) {
  const base = (cfg.baseUrl || PROVIDERS[cfg.provider]?.base || '').replace(/\/+$/, '');
  if (!base) throw new LlmError('missing-base', '請填入 API 網址');
  return cfg.provider === 'anthropic'
    ? `${base}/v1/messages`
    : `${base}/v1/chat/completions`;
}

export class LlmError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function explain(status, body) {
  const detail = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  if (status === 401 || status === 403) return new LlmError('auth', 'API key 無效或沒有權限。');
  if (status === 429) return new LlmError('rate', '呼叫太頻繁或額度用完了,稍後再試。');
  if (status === 404) return new LlmError('model', '找不到這個模型,請在設定裡換一個。');
  if (status >= 500) return new LlmError('server', '服務暫時有問題,稍後再試。');
  return new LlmError('http', `請求失敗 (${status})${detail ? ': ' + detail.slice(0, 180) : ''}`);
}

async function post(url, headers, body, signal) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', headers, signal,
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    // A blocked pre-flight lands here with no status to inspect.
    throw new LlmError('cors',
      '無法連上該服務。可能是網路問題,或這家 API 不允許瀏覽器直接呼叫(CORS)。');
  }
  if (!res.ok) {
    let payload = null;
    try { payload = await res.json(); } catch { payload = await res.text().catch(() => ''); }
    throw explain(res.status, payload?.error?.message || payload);
  }
  return res.json();
}

/**
 * One conversational turn.
 * @param {{provider,apiKey,model,baseUrl}} cfg
 * @param {{system: string, messages: {role:'user'|'assistant',content:string}[], signal?: AbortSignal, maxTokens?: number}} opts
 * @returns {Promise<string>} raw assistant text
 */
export async function chat(cfg, { system, messages, signal, maxTokens = 700 }) {
  if (!cfg.apiKey) throw new LlmError('no-key', '還沒設定 API key。');
  const model = cfg.model || defaultModelFor(cfg.provider);
  if (!model) throw new LlmError('no-model', '還沒選模型。');

  const url = endpoint(cfg);

  if (cfg.provider === 'anthropic') {
    const data = await post(url, {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      // Required for direct browser calls; the key is the user's own.
      'anthropic-dangerous-direct-browser-access': 'true',
    }, { model, max_tokens: maxTokens, system, messages }, signal);

    if (data.stop_reason === 'refusal') {
      throw new LlmError('refusal', '這個話題被模型的安全機制擋下了,換個主題試試。');
    }
    return (data.content || [])
      .filter(b => b.type === 'text').map(b => b.text).join('').trim();
  }

  // OpenAI-compatible (OpenAI, DeepSeek, and anything else speaking the same shape).
  const body = {
    model,
    max_completion_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, ...messages],
  };
  // Conversation practice wants fast replies, not deep reasoning.
  if (cfg.provider === 'openai') body.reasoning_effort = 'low';

  let data;
  try {
    data = await post(url, {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    }, body, signal);
  } catch (e) {
    // Older/simpler endpoints reject the newer parameter names — retry plainly.
    if (e instanceof LlmError && (e.code === 'http' || e.code === 'model')) {
      delete body.reasoning_effort;
      body.max_tokens = maxTokens;
      delete body.max_completion_tokens;
      data = await post(url, {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      }, body, signal);
    } else {
      throw e;
    }
  }
  return (data.choices?.[0]?.message?.content || '').trim();
}

/** Cheap round-trip used by Settings to verify a key works. */
export async function testKey(cfg) {
  const text = await chat(cfg, {
    system: 'Reply with exactly: OK',
    messages: [{ role: 'user', content: 'ping' }],
    maxTokens: 16,
  });
  return text.length > 0;
}

/* ---------- tutor prompt ---------- */

const LEVEL_BRIEF = {
  1: 'Use only the ~800 most common English words. Sentences under 10 words. Present tense.',
  2: 'Use common everyday vocabulary. Sentences under 14 words. Simple past and future are fine.',
  3: 'Speak at a natural everyday pace with phrasal verbs and contractions. Sentences under 18 words.',
  4: 'Speak naturally with idioms and opinions. Do not simplify much.',
  5: 'Speak exactly as you would to a native speaker. Do not simplify at all.',
};

export function tutorSystem({ level = 3, corrections = true, scenario = '' } = {}) {
  return [
    'You are a warm, patient English conversation partner for a Taiwanese adult learner.',
    'You are on a voice call: your reply is read aloud by a speech engine.',
    '',
    'Rules:',
    '- Reply in English only. Never use Chinese in "reply".',
    '- Keep replies to 1-3 sentences. This is a conversation, not a lecture.',
    '- End almost every turn with a question so the learner keeps talking.',
    '- Write plain spoken prose: no markdown, no bullet points, no emoji, no stage directions.',
    `- ${LEVEL_BRIEF[level] || LEVEL_BRIEF[3]}`,
    '- The learner speaks through speech recognition, so expect small transcription errors.',
    '  Guess what they meant and keep going. Never comment on transcription noise.',
    scenario ? `- Scenario: ${scenario} Stay in that situation and play your role.` : '',
    '',
    'Respond with a single JSON object and nothing else:',
    corrections
      ? '{"reply": "<your spoken reply>", "fix": "<one short Traditional Chinese note naming ONE real mistake in the learner\'s English and the natural way to say it, or null if their English was fine>"}'
      : '{"reply": "<your spoken reply>", "fix": null}',
    corrections
      ? 'Only set "fix" when there is a genuine error worth naming. Do not nitpick style or invent mistakes. Most turns should be null.'
      : 'Always set "fix" to null.',
  ].filter(Boolean).join('\n');
}

/** Tolerant parse — models occasionally wrap JSON in prose or fences. */
export function parseTurn(raw) {
  const text = String(raw || '').trim();
  const body = text.replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const o = JSON.parse(body.slice(start, end + 1));
      if (typeof o.reply === 'string' && o.reply.trim()) {
        return { reply: o.reply.trim(), fix: o.fix ? String(o.fix).trim() : null };
      }
    } catch { /* fall through */ }
  }
  return { reply: body || '…', fix: null };
}
