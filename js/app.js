/* Router + app shell. */

import { toast } from './ui.js';
import { loadVoices, unlock, cancel as cancelSpeech } from './tts.js';

const ROUTES = [
  { re: /^\/$/,                 load: () => import('./views/home.js'),     tab: '/' },
  { re: /^\/daily$/,            load: () => import('./views/daily.js'),    tab: '/' },
  { re: /^\/library$/,          load: () => import('./views/library.js'),  tab: '/library' },
  { re: /^\/lesson\/(.+)$/,     load: () => import('./views/lesson.js'),   tab: '/library' },
  { re: /^\/listen\/(.+)$/,     load: () => import('./views/listen.js'),   tab: '/library', full: true },
  { re: /^\/play\/(.+)$/,       load: () => import('./views/player.js'),   tab: '/library', full: true },
  { re: /^\/review$/,           load: () => import('./views/review.js'),   tab: '/review' },
  { re: /^\/talk$/,             load: () => import('./views/talk.js'),     tab: '/talk' },
  { re: /^\/talk\/(.+)$/,       load: () => import('./views/talk.js'),     tab: '/talk', full: true },
  { re: /^\/import$/,           load: () => import('./views/import.js'),   tab: '/library' },
  { re: /^\/yt$/,               load: () => import('./views/yt.js'),       tab: '/library' },
  { re: /^\/yt\/(.+)$/,         load: () => import('./views/yt.js'),       tab: '/library', full: true },
  { re: /^\/settings$/,         load: () => import('./views/settings.js'), tab: '/settings' },
  { re: /^\/progress$/,         load: () => import('./views/progress.js'), tab: '/' },
];

const view = document.getElementById('view');
let currentModule = null;
let renderToken = 0;

function path() {
  const h = location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/';
}

function setActiveTab(tab) {
  document.querySelectorAll('.tab').forEach(a => {
    a.classList.toggle('is-active', a.dataset.tab === tab);
  });
}

async function route() {
  const p = path();
  const token = ++renderToken;

  // Let the outgoing view release timers, mics and audio.
  try { currentModule?.destroy?.(); } catch { /* ignore */ }
  currentModule = null;
  cancelSpeech();

  const match = ROUTES.find(r => r.re.test(p));
  if (!match) { location.hash = '#/'; return; }

  setActiveTab(match.tab);
  document.getElementById('tabbar').style.display = match.full ? 'none' : '';
  view.style.paddingBottom = match.full ? 'calc(32px + var(--safe-b))' : '';

  const params = (p.match(match.re) || []).slice(1).map(decodeURIComponent);

  view.replaceChildren();
  try {
    const mod = await match.load();
    if (token !== renderToken) return;          // a newer navigation won
    currentModule = mod;
    await mod.render(view, ...params);
    if (token === renderToken) window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    if (token !== renderToken) return;
    view.replaceChildren();
    const box = document.createElement('div');
    box.className = 'card';
    box.innerHTML = `<h3>載入失敗</h3><p>${String(err.message || err)}</p>`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-block';
    btn.textContent = '回到首頁';
    btn.onclick = () => { location.hash = '#/'; };
    box.append(btn);
    view.append(box);
  }
}

window.addEventListener('hashchange', route);

// Browser speech needs a real user gesture before it will make sound on iOS.
document.addEventListener('pointerdown', () => unlock(), { once: true });

// Chrome keeps queued utterances alive across reloads otherwise.
window.addEventListener('beforeunload', () => cancelSpeech());

loadVoices();
route();

/* ---------- service worker ---------- */

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('已更新到新版本,重開即可套用');
          }
        });
      });
    } catch { /* offline support is optional */ }
  });
}
