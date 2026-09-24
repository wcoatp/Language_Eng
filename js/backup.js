/* SDD-003: portable, validated Echo backup format. No network access. */
import { DATA_STORES } from './db.js';

export const BACKUP_FORMAT = 'echo-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const TAG = '__echoBackupType';
const DANGEROUS = new Set(['__proto__', 'prototype', 'constructor']);

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function unbase64(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 === 1) {
    throw Error('備份中的二進位資料格式錯誤');
  }
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encode(value, seen = new WeakSet()) {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value instanceof Blob) return { [TAG]: 'Blob', type: value.type, data: base64(new Uint8Array(await value.arrayBuffer())) };
  if (value instanceof ArrayBuffer) return { [TAG]: 'ArrayBuffer', data: base64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) return { [TAG]: 'ArrayBuffer', data: base64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (typeof value !== 'object') throw Error('備份包含不支援的資料型別');
  if (seen.has(value)) throw Error('備份資料不能包含循環參照');
  seen.add(value);
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(await encode(item, seen));
    seen.delete(value);
    return out;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (DANGEROUS.has(key)) throw Error('備份包含不安全的欄位名稱');
    out[key] = await encode(item, seen);
  }
  seen.delete(value);
  return out;
}

function assertSafe(value, depth = 0) {
  if (depth > 80) throw Error('備份資料層級過深');
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (DANGEROUS.has(key)) throw Error('備份包含不安全的欄位名稱');
    assertSafe(value[key], depth + 1);
  }
}

function decode(value) {
  if (!value || typeof value !== 'object') return value;
  if (value[TAG] === 'Blob') return new Blob([unbase64(value.data)], { type: typeof value.type === 'string' ? value.type : '' });
  if (value[TAG] === 'ArrayBuffer') return unbase64(value.data).buffer;
  if (value[TAG]) throw Error('備份包含未知的二進位型別');
  if (Array.isArray(value)) return value.map(decode);
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = decode(item);
  return out;
}

function cleanSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const { apiKey, ...safe } = value;
  return safe;
}

function legacyEnvelope(data) {
  const stores = Object.fromEntries(DATA_STORES.map(name => [name, []]));
  stores.kv = [
    { k: 'settings', v: cleanSettings(data.settings) },
    { k: 'dailyCompletions', v: data.dailyCompletions || {} },
    { k: 'vocabularyBookmarks', v: data.vocabularyBookmarks || [] },
    { k: 'lessonLearningProgress', v: data.lessonLearningProgress || {} },
  ];
  for (const name of ['cards', 'sessions', 'lessons']) stores[name] = Array.isArray(data[name]) ? data[name] : [];
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: data.exportedAt, appVersion: 'legacy', stores };
}

function validateEnvelope(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('這不是有效的 Echo 備份');
  if (data.format !== BACKUP_FORMAT || data.version !== BACKUP_VERSION) throw Error('不支援這個備份格式或版本');
  if (!Number.isFinite(Date.parse(data.exportedAt))) throw Error('備份缺少有效的匯出時間');
  if (!data.stores || typeof data.stores !== 'object' || Array.isArray(data.stores)) throw Error('備份缺少資料 stores');
  const unknown = Object.keys(data.stores).filter(name => !DATA_STORES.includes(name));
  if (unknown.length) throw Error(`備份包含未知資料區：${unknown.join(', ')}`);
  for (const name of DATA_STORES) {
    const rows = data.stores[name];
    if (!Array.isArray(rows)) throw Error(`備份資料區 ${name} 不是陣列`);
    if (rows.length > 100000) throw Error(`備份資料區 ${name} 筆數異常`);
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error(`備份資料區 ${name} 有無效紀錄`);
      if (name === 'kv' && typeof row.k !== 'string') throw Error('備份 kv 紀錄缺少主鍵');
      if (['cards', 'lessons', 'recordings', 'videos'].includes(name) && typeof row.id !== 'string') throw Error(`備份 ${name} 紀錄缺少主鍵`);
      if (['sessions', 'chats'].includes(name) && row.id != null && !Number.isInteger(row.id)) throw Error(`備份 ${name} 主鍵無效`);
      if (name === 'lessons' && !Array.isArray(row.sentences)) throw Error('備份中的自訂課程缺少句子');
    }
  }
}

export async function createBackup(db, { appVersion = 'unknown', now = new Date() } = {}) {
  const stores = {};
  for (const name of DATA_STORES) {
    let rows = await db.all(name);
    if (name === 'kv') rows = rows.map(row => row.k === 'settings' ? { ...row, v: cleanSettings(row.v) } : row);
    stores[name] = await encode(rows);
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), appVersion, stores };
}

export async function createBackupText(db, options) {
  return JSON.stringify(await createBackup(db, options), null, 2);
}

export function parseBackupText(text, { maxBytes = MAX_BACKUP_BYTES } = {}) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > maxBytes) throw Error('備份檔過大或無法讀取');
  let data;
  try { data = JSON.parse(text); } catch { throw Error('備份不是有效的 JSON'); }
  assertSafe(data);
  if (!data.format && data.exportedAt && ('cards' in data || 'settings' in data)) data = legacyEnvelope(data);
  validateEnvelope(data);
  const stores = {};
  for (const name of DATA_STORES) stores[name] = decode(data.stores[name]);
  return { ...data, stores };
}

export function preserveApiKey(backup, apiKey = '') {
  const stores = Object.fromEntries(DATA_STORES.map(name => [name, [...backup.stores[name]]]));
  const at = stores.kv.findIndex(row => row.k === 'settings');
  const settings = at >= 0 ? stores.kv[at].v : {};
  const row = { k: 'settings', v: { ...(settings || {}), ...(apiKey ? { apiKey } : {}) } };
  if (at >= 0) stores.kv[at] = row; else stores.kv.push(row);
  return stores;
}

export function backupSummary(backup) {
  return { exportedAt: backup.exportedAt, total: DATA_STORES.reduce((sum, name) => sum + backup.stores[name].length, 0),
    lessons: backup.stores.lessons.length, recordings: backup.stores.recordings.length };
}

export function backupFilename(date = new Date()) {
  return `echo-backup-${date.toISOString().slice(0, 10)}.json`;
}
