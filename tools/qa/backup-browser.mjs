import { DATA_STORES, replaceStoresInDatabase } from '../../js/db.js';

const name = `echo-qa-backup-${crypto.randomUUID()}`;
const assert = (ok, message = 'assertion failed') => { if (!ok) throw Error(message); };
let failed = 0, db;
async function test(label, run) {
  const row = document.createElement('li');
  try { await run(); row.textContent = `PASS ${label}`; }
  catch (error) { failed++; row.textContent = `FAIL ${label}: ${error.message}`; }
  document.getElementById('results').append(row);
}
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const target = request.result;
      target.createObjectStore('kv', { keyPath: 'k' });
      target.createObjectStore('cards', { keyPath: 'id' });
      target.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      target.createObjectStore('lessons', { keyPath: 'id' });
      target.createObjectStore('recordings', { keyPath: 'id' });
      target.createObjectStore('chats', { keyPath: 'id', autoIncrement: true });
      target.createObjectStore('videos', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function all(store) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
db = await openDb();
await test('RC-06 atomic replacement clears old rows and writes every store', async () => {
  await replaceStoresInDatabase(db, Object.fromEntries(DATA_STORES.map(store => [store,
    store === 'kv' ? [{ k: 'old', v: true }] : []])));
  const next = Object.fromEntries(DATA_STORES.map(store => [store, []]));
  next.kv = [{ k: 'new', v: 1 }]; next.cards = [{ id: 'card' }]; next.sessions = [{ id: 1 }];
  next.lessons = [{ id: 'lesson', sentences: [] }]; next.recordings = [{ id: 'recording', blob: new Blob(['x']) }];
  next.chats = [{ id: 1, text: 'hi' }]; next.videos = [{ id: 'video' }];
  await replaceStoresInDatabase(db, next);
  assert((await all('kv')).length === 1 && (await all('kv'))[0].k === 'new');
  for (const store of DATA_STORES.filter(value => value !== 'kv')) assert((await all(store)).length === 1, store);
});
await test('RC-06 invalid write aborts every clear and preserves previous snapshot', async () => {
  const before = JSON.stringify(await all('kv'));
  const invalid = Object.fromEntries(DATA_STORES.map(store => [store, []]));
  invalid.kv = [{ k: 'should-not-stick', v: true }]; invalid.cards = [{}];
  let rejected = false;
  try { await replaceStoresInDatabase(db, invalid); } catch { rejected = true; }
  assert(rejected, 'invalid write was not rejected');
  assert(JSON.stringify(await all('kv')) === before, 'kv changed despite abort');
  assert((await all('cards'))[0].id === 'card', 'cards changed despite abort');
});
db.close();
await new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase(name);
  request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
});
document.getElementById('summary').textContent = failed ? `${failed} FAILED` : 'ALL PASSED';
document.title = failed ? 'FAIL: SDD-003' : 'PASS: SDD-003';
