/* IndexedDB wrapper — all learner state lives on-device, nothing is uploaded. */

const DB_NAME = 'echo';
const DB_VERSION = 2;
export const DATA_STORES = ['kv', 'cards', 'sessions', 'lessons', 'recordings', 'chats', 'videos'];

/** @type {Promise<IDBDatabase>|null} */
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'k' });
      }
      if (!db.objectStoreNames.contains('cards')) {
        const s = db.createObjectStore('cards', { keyPath: 'id' });
        s.createIndex('due', 'due');
        s.createIndex('lessonId', 'lessonId');
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        s.createIndex('day', 'day');
      }
      if (!db.objectStoreNames.contains('lessons')) {
        db.createObjectStore('lessons', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('recordings')) {
        db.createObjectStore('recordings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('chats')) {
        db.createObjectStore('chats', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('videos')) {
        db.createObjectStore('videos', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  get:   (store, key)  => tx(store, 'readonly',  s => s.get(key)),
  all:   (store)       => tx(store, 'readonly',  s => s.getAll()),
  put:   (store, val)  => tx(store, 'readwrite', s => s.put(val)),
  del:   (store, key)  => tx(store, 'readwrite', s => s.delete(key)),
  clear: (store)       => tx(store, 'readwrite', s => s.clear()),

  /** Bulk put in a single transaction. */
  putAll(store, vals) {
    return open().then(dbi => new Promise((resolve, reject) => {
      const t = dbi.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      vals.forEach(v => os.put(v));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    }));
  },

  /** Everything in `store` whose indexed value is <= max. */
  byIndexUpTo(store, index, max) {
    return open().then(dbi => new Promise((resolve, reject) => {
      const t = dbi.transaction(store, 'readonly');
      const req = t.objectStore(store).index(index).getAll(IDBKeyRange.upperBound(max));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  },
};

/** Replace every learner-data store atomically. Any failed put aborts all clears/writes. */
export function replaceStoresInDatabase(dbi, stores) {
  return new Promise((resolve, reject) => {
    const transaction = dbi.transaction(DATA_STORES, 'readwrite');
    let cause;
    try {
      for (const name of DATA_STORES) {
        const store = transaction.objectStore(name);
        store.clear();
        for (const value of stores[name] || []) store.put(value);
      }
    } catch (error) { cause = error; transaction.abort(); }
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(cause || transaction.error || Error('備份還原失敗'));
  });
}

export function replaceAllStores(stores) {
  return open().then(dbi => replaceStoresInDatabase(dbi, stores));
}

/* ---- kv helpers ---- */

export async function kvGet(k, fallback = null) {
  const row = await db.get('kv', k);
  return row ? row.v : fallback;
}

export function kvSet(k, v) {
  return db.put('kv', { k, v });
}

/** Synchronous read/modify/write in one transaction, including across tabs. */
export function kvUpdate(k, fallback, update) {
  return open().then(dbi => new Promise((resolve, reject) => {
    const transaction = dbi.transaction('kv', 'readwrite');
    const store = transaction.objectStore('kv');
    const request = store.get(k);
    let next;
    let cause;
    request.onsuccess = () => {
      try {
        next = update(request.result ? request.result.v : fallback);
        store.put({ k, v: next });
      } catch (error) { cause = error; transaction.abort(); }
    };
    transaction.oncomplete = () => resolve(next);
    transaction.onerror = transaction.onabort = () => reject(cause || transaction.error || Error('資料未儲存'));
  }));
}

/** Wipe every store. Used by Settings → reset. */
export async function wipeAll() {
  for (const s of DATA_STORES) {
    await db.clear(s);
  }
}
