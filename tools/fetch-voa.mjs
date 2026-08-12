#!/usr/bin/env node
/* Build lessons from VOA Learning English.

   VOA is a US federal government publication: its Learning English text, audio
   and video are in the public domain and may be reused for educational and
   commercial purposes with credit to learningenglish.voanews.com. That is what
   makes this the one real-human source we can legally ship inside the repo.
   https://learningenglish.voanews.com/p/6861.html

   Each episode is downloaded, transcribed and cut by tools/align-media.mjs.

   Examples:
     node tools/fetch-voa.mjs --list
     node tools/fetch-voa.mjs --series ask-a-teacher --count 4
     node tools/fetch-voa.mjs --plan            # the curated default set
*/

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';

const ATTRIBUTION = 'VOA Learning English (public domain)';
const ATTRIBUTION_URL = 'https://learningenglish.voanews.com';

/* Curated series. `level` is a hint only — the aligner scores each lesson from
   its own text, and these mostly agree within one level. Durations are the
   sweet spot we filter for: long enough to be a real lesson, short enough that
   one episode is not ten lessons. */
const SERIES = {
  'ask-a-teacher': {
    zone: 5535, topic: 'daily', minSec: 100, maxSec: 260,
    label: 'Ask a Teacher', note: 'listener questions answered — clear, short, conversational',
  },
  'words-and-stories': {
    zone: 987, topic: 'daily', minSec: 180, maxSec: 400,
    label: 'Words and Their Stories', note: 'idioms and everyday expressions in context',
  },
  'everyday-grammar': {
    zone: 4456, topic: 'daily', minSec: 150, maxSec: 400,
    label: 'Everyday Grammar', note: 'grammar explained with spoken examples',
  },
  'health-lifestyle': {
    zone: 955, topic: 'science', minSec: 180, maxSec: 400,
    label: 'Health & Lifestyle', note: 'everyday science and health reporting',
  },
  'science-tech': {
    zone: 1579, topic: 'science', minSec: 180, maxSec: 400,
    label: 'Science & Technology', note: 'technology and research news',
  },
  'as-it-is': {
    zone: 3521, topic: 'media', minSec: 180, maxSec: 420,
    label: 'As It Is', note: 'general-interest features',
  },
  'national-parks': {
    zone: 4791, topic: 'travel', minSec: 180, maxSec: 420,
    label: "America's National Parks", note: 'travel and place description',
  },
  'american-stories': {
    zone: 1581, topic: 'media', minSec: 300, maxSec: 720, maxSentences: 45,
    label: 'American Stories', note: 'classic short fiction read aloud',
  },
  'what-it-takes': {
    // Interviews run 17-60 minutes, so take only the opening stretch of one.
    zone: 5254, topic: 'work', minSec: 900, maxSec: 1400, maxSentences: 60,
    label: 'What It Takes', note: 'real two-person interviews at native pace',
  },
};

/* The default build: weighted towards the levels the library is thin on. */
const PLAN = [
  ['ask-a-teacher', 5],
  ['words-and-stories', 4],
  ['everyday-grammar', 3],
  ['health-lifestyle', 3],
  ['science-tech', 3],
  ['national-parks', 2],
  ['as-it-is', 2],
  ['american-stories', 2],
  ['what-it-takes', 2],
];

/* ---------- args ---------- */

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? true);
};
const has = n => argv.includes(`--${n}`);

if (has('help')) {
  console.log(`usage: node tools/fetch-voa.mjs [options]

  --list                 show the curated series and exit
  --plan                 build the default curated set (${PLAN.reduce((n, p) => n + p[1], 0)} episodes)
  --series NAME          build one series
  --count N              episodes for --series (default 3)
  --chunk N              sentences per lesson (default 15)
  --dry-run              show what would be built, download nothing
`);
  process.exit(0);
}

if (has('list')) {
  console.log('\ncurated VOA series:\n');
  for (const [k, s] of Object.entries(SERIES)) {
    console.log(`  ${k.padEnd(20)} ${s.label.padEnd(26)} ${s.note}`);
  }
  console.log(`\nsource: ${ATTRIBUTION_URL} — public domain\n`);
  process.exit(0);
}

const CHUNK = String(flag('chunk', 15));
const DRY = has('dry-run');

const jobs = has('series')
  ? [[String(flag('series')), Number(flag('count', 3))]]
  : PLAN;

for (const [name] of jobs) {
  if (!SERIES[name]) {
    console.error(`unknown series "${name}". Run --list to see the options.`);
    process.exit(1);
  }
}

/* ---------- feed ---------- */

async function episodes(series) {
  const url = `https://learningenglish.voanews.com/podcast/?zoneId=${series.zone}`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`feed ${series.zone} returned ${res.status}`);
  const xml = await res.text();

  const out = [];
  for (const block of xml.split('<item>').slice(1)) {
    const pick = tag => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? decode(m[1].trim()) : '';
    };
    const enc = block.match(/<enclosure[^>]*url="([^"]+)"/);
    if (!enc) continue;

    const dur = pick('itunes:duration') || pick('duration');
    const [h = 0, m = 0, s = 0] = dur.split(':').map(Number);
    const seconds = dur.split(':').length === 3 ? h * 3600 + m * 60 + s : h * 60 + m;

    out.push({
      title: pick('title').replace(/\s*-\s*\w+ \d+,\s*\d{4}\s*$/, '').trim(),
      url: enc[1],
      link: pick('link'),
      seconds,
      pubDate: pick('pubDate'),
    });
  }
  return out;
}

const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8216;|&lsquo;/g, "'")
  .replace(/&#8220;|&ldquo;|&#8221;|&rdquo;/g, '"')
  .replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

/* Titles become lesson ids and clip directory names. Truncation alone is not
   enough: "...Poe, Part One" and "...Part Two" share their first 34 characters
   and would collide, silently dropping one of them. Append a short digest of
   the full title whenever the slug had to be cut. */
function slugify(title) {
  const full = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!full) return 'voa';
  if (full.length <= 34) return full;
  const digest = createHash('sha1').update(title).digest('hex').slice(0, 6);
  return `${full.slice(0, 34).replace(/-$/, '')}-${digest}`;
}

const exists = p => access(p).then(() => true, () => false);

/* ---------- build ---------- */

let made = 0, skipped = 0, failed = 0;

for (const [name, count] of jobs) {
  const series = SERIES[name];
  process.stdout.write(`\n=== ${series.label} ===\n`);

  let list;
  try {
    list = await episodes(series);
  } catch (e) {
    console.error(`  feed failed: ${e.message}`);
    failed++;
    continue;
  }

  // Prefer episodes inside the target duration band, shortest first: they make
  // tighter lessons and transcribe faster.
  const picked = list
    .filter(e => e.seconds >= series.minSec && e.seconds <= series.maxSec)
    .sort((a, b) => a.seconds - b.seconds)
    .slice(0, count);

  if (!picked.length) {
    console.log(`  no episodes between ${series.minSec}s and ${series.maxSec}s (feed had ${list.length})`);
    continue;
  }

  for (const ep of picked) {
    const id = `voa-${slugify(ep.title)}`;
    if (await exists(join(root, 'content', 'lessons', `${id}.json`)) ||
        await exists(join(root, 'content', 'lessons', `${id}-01.json`))) {
      console.log(`  skip (already built) ${ep.title}`);
      skipped++;
      continue;
    }

    console.log(`  ${DRY ? '[dry] ' : ''}${ep.title}  (${Math.round(ep.seconds / 60)}m)`);
    if (DRY) continue;

    try {
      const { stdout } = await run('node', [
        join(root, 'tools', 'align-media.mjs'), ep.url,
        '--title', ep.title,
        '--mode', 'repo',
        '--topic', series.topic,
        '--accent', 'real',
        '--chunk', CHUNK,
        '--id-prefix', id,
        '--source-note', `${ATTRIBUTION} — ${series.label}`,
        '--source-url', ep.link || ATTRIBUTION_URL,
        ...(series.maxSentences ? ['--max-sentences', String(series.maxSentences)] : []),
      ], { maxBuffer: 1 << 28 });

      const summary = stdout.split('\n').find(l => /sentences \(/.test(l)) || '';
      console.log(`     ${summary.trim()}`);
      made++;
    } catch (e) {
      console.error(`     failed: ${String(e.stderr || e.message).split('\n').slice(-3).join(' ').slice(0, 200)}`);
      failed++;
    }
  }
}

console.log(`\nbuilt ${made} episode(s), skipped ${skipped}${failed ? `, failed ${failed}` : ''}`);
if (made && !DRY) console.log('next: node tools/build-index.mjs');
