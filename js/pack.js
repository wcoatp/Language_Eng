/* Lesson packs — real audio you produced yourself, carried between your devices.

   tools/align-media.mjs writes a .echopack on your Mac; this reads it on any
   device. The audio lands in this browser's IndexedDB and is never uploaded,
   which is what makes it safe to use with material you may not redistribute.

   Layout (see the writer for the matching end):
     "ECHOPACK\x01"        9 bytes
     uint32LE              header length
     JSON header           { version, lessons: [...], files: [{p,o,n}] }
     data                  every clip concatenated, addressed by the header */

import { saveUserLesson } from './content.js';

const MAGIC = 'ECHOPACK';

export class PackError extends Error {}

/**
 * Read a .echopack into lesson objects with their audio attached.
 * @param {File|Blob} file
 */
export async function readPack(file) {
  const buf = await file.arrayBuffer();
  if (buf.byteLength < MAGIC.length + 4) throw new PackError('檔案太小,不像是課程包');

  const bytes = new Uint8Array(buf);
  const magic = String.fromCharCode(...bytes.subarray(0, MAGIC.length));
  if (magic !== MAGIC) throw new PackError('這不是 .echopack 課程包');

  const headerLen = new DataView(buf).getUint32(MAGIC.length, true);
  const headerStart = MAGIC.length + 4;
  const dataStart = headerStart + headerLen;
  if (dataStart > buf.byteLength) throw new PackError('課程包損毀(標頭長度不合)');

  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(headerStart, dataStart)));
  } catch {
    throw new PackError('課程包標頭無法解析');
  }
  if (!Array.isArray(header.lessons) || !header.lessons.length) {
    throw new PackError('課程包裡沒有課程');
  }

  // Index the clips so each sentence can pick up its own audio.
  const clips = new Map();
  for (const f of header.files || []) {
    const from = dataStart + f.o;
    const to = from + f.n;
    if (to > buf.byteLength) throw new PackError('課程包損毀(音檔超出檔案範圍)');
    clips.set(f.p, new Blob([buf.slice(from, to)], { type: 'audio/mpeg' }));
  }

  const lessons = header.lessons.map(l => ({
    ...l,
    custom: true,
    fromPack: true,
    sentences: l.sentences.map(s => ({ ...s, audio: clips.get(`${l.id}/${s.id}`) || null })),
  }));

  const withAudio = lessons.reduce(
    (n, l) => n + l.sentences.filter(s => s.audio).length, 0);
  const total = lessons.reduce((n, l) => n + l.sentences.length, 0);

  return { title: header.title || lessons[0].title, lessons, total, withAudio };
}

/** Store an imported pack. Ids are namespaced so two packs cannot collide. */
export async function installPack(pack) {
  const stamp = Date.now();
  for (const [i, lesson] of pack.lessons.entries()) {
    await saveUserLesson({
      ...lesson,
      id: `pack-${stamp.toString(36)}-${i + 1}`,
      topic: lesson.topic || 'custom',
      at: stamp + i,
    });
  }
  return pack.lessons.length;
}
