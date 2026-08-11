#!/usr/bin/env node
/* Generate the PWA icons with no image dependencies — a tiny PNG encoder
   over node's built-in zlib.  node tools/make-icons.mjs */

import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {(x:number,y:number)=>[number,number,number,number]} shade */
function png(size, shade) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;                       // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = shade(x, y);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [15, 17, 21];
const FG = [94, 234, 212];

/* Eight bars in a soundwave arc — reads as "listening" at any size. */
const BARS = [0.30, 0.52, 0.78, 1.0, 1.0, 0.78, 0.52, 0.30];

function draw(size, { padding, radius }) {
  const inner = size * (1 - padding * 2);
  const x0 = size * padding;
  const gap = inner / (BARS.length * 2 - 1);
  const barW = gap;
  const cy = size / 2;

  return (x, y) => {
    // Rounded-square background.
    const r = size * radius;
    const dx = Math.max(r - x, x - (size - r), 0);
    const dy = Math.max(r - y, y - (size - r), 0);
    if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];

    for (let i = 0; i < BARS.length; i++) {
      const bx = x0 + i * gap * 2;
      if (x < bx || x >= bx + barW) continue;
      const h = inner * BARS[i] * 0.82;
      if (Math.abs(y - cy) <= h / 2) {
        // Round the bar caps.
        const capY = Math.abs(y - cy) - (h / 2 - barW / 2);
        if (capY > 0 && Math.hypot(0, capY) > barW / 2) break;
        return [...FG, 255];
      }
      break;
    }

    // Subtle vertical lift in the background.
    const t = y / size;
    return [
      Math.round(BG[0] + t * 6),
      Math.round(BG[1] + t * 7),
      Math.round(BG[2] + t * 9),
      255,
    ];
  };
}

await mkdir(outDir, { recursive: true });

const jobs = [
  ['icon-192.png', 192, { padding: 0.22, radius: 0.22 }],
  ['icon-512.png', 512, { padding: 0.22, radius: 0.22 }],
  // Maskable icons get cropped to a circle, so keep the art well inside.
  ['icon-maskable-512.png', 512, { padding: 0.30, radius: 0.5 }],
];

for (const [name, size, opts] of jobs) {
  await writeFile(join(outDir, name), png(size, draw(size, opts)));
  console.log('wrote icons/' + name);
}
