import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createBackupText, parseBackupText, preserveApiKey, backupSummary } from '../js/backup.js';
import { withAutomaticLearning, learningProblems } from '../js/learning.js';

test('RC-05: complete backup round-trips media and never exports API key', async () => {
  const records = {
    kv: [{ k: 'settings', v: { apiKey: 'never-export-this', dailyGoalMin: 15 } }, { k: 'x', v: 2 }],
    cards: [{ id: 'l1:s1', due: 1 }], sessions: [{ id: 1, day: '2026-09-23' }],
    lessons: [{ id: 'mine', sentences: [{ id: 's1', text: 'Hi.' }] }],
    recordings: [{ id: 'r1', blob: new Blob(['audio'], { type: 'audio/webm' }) }],
    chats: [{ id: 1, text: 'hello' }], videos: [{ id: 'v1', title: 'one' }],
  };
  const text = await createBackupText({ all: async name => records[name] },
    { appVersion: 'test', now: new Date('2026-09-23T00:00:00Z') });
  assert.doesNotMatch(text, /never-export-this/);
  const parsed = parseBackupText(text);
  assert.equal(await parsed.stores.recordings[0].blob.text(), 'audio');
  assert.equal(parsed.stores.recordings[0].blob.type, 'audio/webm');
  assert.deepEqual(backupSummary(parsed), { exportedAt: '2026-09-23T00:00:00.000Z', total: 8, lessons: 1, recordings: 1 });
  const restored = preserveApiKey(parsed, 'local-secret');
  assert.equal(restored.kv.find(row => row.k === 'settings').v.apiKey, 'local-secret');
  assert.equal(restored.kv.find(row => row.k === 'settings').v.dailyGoalMin, 15);
});

test('RC-05: legacy learning-record exports migrate without inventing missing stores', () => {
  const legacy = { exportedAt: '2026-09-22T12:00:00Z', settings: { apiKey: 'old-secret', dailyGoalMin: 20 },
    cards: [{ id: 'a' }], sessions: [], lessons: [], dailyCompletions: { day: true },
    vocabularyBookmarks: [{ id: 'w' }], lessonLearningProgress: { l1: {} } };
  const parsed = parseBackupText(JSON.stringify(legacy));
  assert.equal(parsed.appVersion, 'legacy');
  assert.equal(parsed.stores.kv.find(row => row.k === 'settings').v.apiKey, undefined);
  assert.deepEqual(parsed.stores.kv.find(row => row.k === 'dailyCompletions').v, { day: true });
  assert.deepEqual(parsed.stores.recordings, []);
});

test('RC-05: malformed, unknown, unsafe and oversized backups are rejected', () => {
  assert.throws(() => parseBackupText('{no'), /JSON/);
  assert.throws(() => parseBackupText(JSON.stringify({ format: 'other' })), /不支援/);
  const base = { format: 'echo-backup', version: 1, exportedAt: '2026-09-23T00:00:00Z',
    stores: { kv: [], cards: [], sessions: [], lessons: [], recordings: [], chats: [], videos: [] } };
  assert.throws(() => parseBackupText(JSON.stringify({ ...base, stores: { ...base.stores, extra: [] } })), /未知/);
  assert.throws(() => parseBackupText('{"__proto__":{},"format":"echo-backup"}'), /不安全/);
  assert.throws(() => parseBackupText(JSON.stringify(base), { maxBytes: 10 }), /過大/);
});

test('RC-03: every built-in lesson gets 4-6 stable local preparation candidates', async () => {
  const dir = new URL('../content/lessons/', import.meta.url);
  const files = (await readdir(dir)).filter(name => name.endsWith('.json'));
  assert.equal(files.length, 111);
  for (const file of files) {
    const raw = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
    const first = withAutomaticLearning(raw);
    const second = withAutomaticLearning(structuredClone(raw));
    assert.ok(first.learning.vocabulary.length >= 4 && first.learning.vocabulary.length <= 8, raw.id);
    assert.deepEqual(learningProblems(first), [], raw.id);
    assert.equal(first.learning.version, second.learning.version, raw.id);
    if (raw.learning) assert.deepEqual(first.learning, raw.learning, `${raw.id}: authored learning changed`);
  }
});
