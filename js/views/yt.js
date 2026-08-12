/* YouTube 精聽 — the same slow/normal loop, run over an embedded video.

   Nothing is downloaded and nothing is republished: the official player streams
   the video, we only keep the id, your transcript and your progress. That makes
   this the legal way to practise with material we could never ship ourselves. */

import { el, toast, backButton, emptyState, mount, confirmBox } from '../ui.js';
import { db } from '../db.js';
import { settings, stopwatch } from '../store.js';
import {
  parseVideoId, parseTranscript, cuesToSegments, YtPlayer,
} from '../youtube.js';

let ctx = null;

export function destroy() {
  ctx?.player?.destroy();
  ctx?.watch?.stop();
  ctx = null;
}

export async function render(root, id) {
  if (id === 'new') return addForm(root);
  if (id) return trainer(root, id);
  return list(root);
}

/* ---------- saved videos ---------- */

const allVideos = () => db.all('videos');

async function list(root) {
  const videos = (await allVideos()).sort((a, b) => b.at - a.at);

  mount(root,
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
      el('h1', { text: 'YouTube 精聽' }),
      el('a', { class: 'btn', href: '#/yt/new', style: 'min-height:38px;padding:8px 14px;font-size:14px' },
        ['+ 加入影片']),
    ]),
    el('p', { class: 'sub' },
      ['用任何 YouTube 英語教學影片做精聽。影片由 YouTube 播放,不會下載也不會轉存。']),

    videos.length
      ? el('div', {}, videos.map(v => el('a', {
          class: 'card card-tap', href: `#/yt/${v.id}`,
        }, [
          el('div', { class: 'lesson-head' }, [
            el('span', { class: 'badge badge-real', text: 'YouTube' }),
            el('span', { class: 'lesson-title', text: v.title }),
          ]),
          el('div', { class: 'lesson-meta' }, [
            el('span', { text: `${v.segments.length} 句` }),
            v.done ? el('span', { style: 'color:var(--accent)', text: `練到第 ${v.done + 1} 句` }) : null,
          ]),
        ])))
      : emptyState('還沒有加入影片', '找一支英語會話教學影片,把它的逐字稿貼進來'),
  );
}

/* ---------- add ---------- */

function addForm(root) {
  const state = { url: '', title: '', transcript: '' };
  const preview = el('div');

  const repaint = () => {
    const cues = parseTranscript(state.transcript);
    const segs = cuesToSegments(cues);
    if (!segs.length) { mount(preview); return; }
    mount(preview, el('div', { class: 'card' }, [
      el('h3', { text: `解析出 ${segs.length} 句` }),
      el('div', { style: 'max-height:190px;overflow:auto;margin-top:8px' },
        segs.slice(0, 8).map(s => el('div', {
          class: 'muted', style: 'padding:4px 0;border-bottom:1px solid var(--line)',
          text: `${fmtTime(s.start)}  ${s.text}`,
        }))),
      segs.length > 8 ? el('div', { class: 'hint', style: 'margin-top:8px', text: `…還有 ${segs.length - 8} 句` }) : null,
    ]));
  };

  mount(root,
    backButton('YouTube', '#/yt'),
    el('h1', { style: 'margin-top:12px', text: '加入影片' }),

    el('div', { class: 'card' }, [
      el('h3', { text: '怎麼拿到逐字稿' }),
      el('p', { class: 'hint', style: 'margin:0' }, [
        '在電腦版 YouTube 影片下方點「⋯ 更多 → 顯示轉錄稿」,' +
        '把整份逐字稿選起來複製,貼到下面即可。含時間碼的格式最好,系統會自動對齊。',
      ]),
    ]),

    el('div', { class: 'field' }, [
      el('label', { text: 'YouTube 網址' }),
      el('input', {
        placeholder: 'https://www.youtube.com/watch?v=...',
        oninput: e => { state.url = e.target.value; },
      }),
    ]),

    el('div', { class: 'field' }, [
      el('label', { text: '標題' }),
      el('input', {
        placeholder: '例:英式發音的連讀技巧',
        oninput: e => { state.title = e.target.value; },
      }),
    ]),

    el('div', { class: 'field' }, [
      el('label', { text: '逐字稿(含時間碼)' }),
      el('textarea', {
        rows: 8, placeholder: '0:00\nHello and welcome back to the channel\n0:04\ntoday we are going to look at...',
        oninput: e => { state.transcript = e.target.value; repaint(); },
      }),
    ]),

    preview,

    el('button', {
      class: 'btn btn-primary btn-lg btn-block', style: 'margin-top:12px',
      onclick: async () => {
        const videoId = parseVideoId(state.url);
        if (!videoId) { toast('看不懂這個 YouTube 網址'); return; }
        const segments = cuesToSegments(parseTranscript(state.transcript));
        if (!segments.length) { toast('逐字稿沒有解析出句子,請確認有含時間碼'); return; }

        const id = `yt-${videoId}`;
        await db.put('videos', {
          id, videoId,
          title: state.title.trim() || 'YouTube 影片',
          segments, done: 0, at: Date.now(),
        });
        toast('已加入');
        location.hash = `#/yt/${id}`;
      },
    }, ['建立課程']),
  );
}

/* ---------- trainer ---------- */

async function trainer(root, id) {
  const [video, cfg] = await Promise.all([db.get('videos', id), settings()]);
  if (!video) { toast('找不到這支影片'); location.hash = '#/yt'; return; }

  ctx = {
    video, cfg,
    i: Math.min(video.done || 0, video.segments.length - 1),
    stage: 'blind',
    slowStep: 0,
    player: null,
    rateOk: true,
    watch: stopwatch('listen', id),
  };

  const host = el('div', { id: 'ytplayer' });
  mount(root,
    el('div', { class: 'trainer-top' }, [
      backButton('離開', '#/yt'),
      el('div', { class: 'muted', id: 'ytcount' }),
    ]),
    el('div', {
      style: 'position:relative;padding-bottom:56.25%;height:0;overflow:hidden;' +
             'border-radius:var(--radius);margin-bottom:14px;background:#000',
    }, [
      el('div', { style: 'position:absolute;inset:0' }, [host]),
    ]),
    el('div', { id: 'ytbody' }),
  );

  try {
    ctx.player = await YtPlayer.create(host, video.videoId, {
      onError: () => toast('這支影片無法嵌入播放(可能被上傳者限制)'),
    });
  } catch (e) {
    mount(document.getElementById('ytbody'),
      el('div', { class: 'card' }, [
        el('p', { text: e.message || '播放器載入失敗' }),
        el('a', { class: 'btn btn-block', href: '#/yt' }, ['返回']),
      ]));
    return;
  }

  ctx.rateOk = ctx.player.rateWorks();
  paint();
  play();
}

const SLOW_STEPS = [0.75, 0.5];
const seg = () => ctx.video.segments[ctx.i];

function currentRate() {
  if (ctx.stage === 'slow' && ctx.rateOk) return SLOW_STEPS[ctx.slowStep];
  return 1;
}

async function play() {
  const s = seg();
  if (!s || !ctx.player) return;
  // A little lead-in, because YouTube cue times tend to land a beat late.
  await ctx.player.playSegment(Math.max(0, s.start - 0.25), s.end, currentRate());
}

function goto(stage) {
  ctx.stage = stage;
  paint();
  if (stage !== 'reveal') play();
}

async function next() {
  ctx.player?.stop();
  ctx.slowStep = 0;
  if (ctx.i >= ctx.video.segments.length - 1) return finish();
  ctx.i++;
  ctx.video.done = ctx.i;
  await db.put('videos', { ...ctx.video, done: ctx.i });
  goto('blind');
}

async function finish() {
  const secs = await ctx.watch.stop();
  ctx.watch = null;
  ctx.player?.pause();
  await db.put('videos', { ...ctx.video, done: 0 });
  mount(document.getElementById('ytbody'),
    el('div', { class: 'hero', style: 'text-align:center' }, [
      el('div', { style: 'font-size:38px' }, ['📺']),
      el('h1', { style: 'margin-top:6px', text: '這支影片練完了' }),
      el('p', { style: 'margin:0', text: `${Math.max(1, Math.round(secs / 60))} 分鐘` }),
    ]),
    el('a', { class: 'btn btn-primary btn-lg btn-block', href: '#/yt' }, ['選下一支']),
  );
}

function paint() {
  const body = document.getElementById('ytbody');
  const count = document.getElementById('ytcount');
  if (!body || !ctx) return;
  const s = seg();
  count.textContent = `${ctx.i + 1} / ${ctx.video.segments.length}`;

  const hidden = ctx.stage !== 'reveal';
  const btn = (label, cls, fn) => el('button', { class: `btn ${cls}`, onclick: fn }, [label]);

  const actions = el('div', { class: 'actions' });
  if (ctx.stage === 'blind') {
    actions.append(
      btn('聽懂了', 'btn-primary btn-lg', () => goto('reveal')),
      el('div', { class: 'btn-row' }, [
        btn('再聽一次', '', play),
        btn(ctx.rateOk ? '聽不懂 · 放慢' : '再聽一次(無法放慢)', '',
          () => (ctx.rateOk ? goto('slow') : play())),
      ]),
    );
  } else if (ctx.stage === 'slow') {
    actions.append(
      btn('再回原速聽一次', 'btn-primary btn-lg', () => goto('again')),
      el('div', { class: 'btn-row' }, [
        btn('再聽一次', '', play),
        btn('再慢一點', '', () => {
          if (ctx.slowStep < SLOW_STEPS.length - 1) { ctx.slowStep++; paint(); play(); }
          else toast('已經是最慢了');
        }),
      ]),
    );
  } else if (ctx.stage === 'again') {
    actions.append(
      btn('看答案', 'btn-primary btn-lg', () => goto('reveal')),
      btn('再聽一次', '', play),
    );
  } else {
    actions.append(
      btn('下一句', 'btn-primary btn-lg', next),
      btn('再聽一次', '', play),
    );
  }

  mount(body,
    el('div', { class: 'stage', style: 'min-height:150px' }, [
      el('div', { class: 'stage-hint', text: {
        blind: '原速 · 先不看字', slow: '慢速 · 抓出每個字',
        again: '再回原速 · 把它接起來', reveal: '對答案',
      }[ctx.stage] }),
      el('p', { class: `sentence ${hidden ? 'is-hidden' : ''}`, style: 'font-size:19px', text: s.text }),
      ctx.stage === 'slow'
        ? el('div', { class: 'muted center', text: `${Math.round(SLOW_STEPS[ctx.slowStep] * 100)}% 速度` })
        : null,
    ]),
    !ctx.rateOk
      ? el('p', { class: 'hint', style: 'color:var(--warn);text-align:center;margin:0 0 10px' },
          ['這台裝置的 YouTube 播放器不接受變速(iOS 常見),所以只能原速重聽。' +
           '需要慢速練習的話,用「課程」裡的真人錄音課。'])
      : null,
    actions,
  );
}

const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
