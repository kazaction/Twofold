// Tiny IndexedDB wrapper.
// Stores:
//   kv       – settings and (optionally wrapped) secrets
//   files    – mirror of encrypted repo files we know about: path -> { sha, data? }
//   outbox   – events not yet pushed: id -> encrypted bytes
//   pending  – encrypted attachment blobs not yet pushed: path -> bytes
//   cache    – encrypted attachment blobs downloaded from the repo: path -> bytes

const DB_NAME = 'twofold';
const VERSION = 1;
const STORES = ['kv', 'files', 'outbox', 'pending', 'cache'];
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

export async function get(store, key) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, key, value) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).put(value, key);
  return done(t);
}

export async function putMany(store, pairs) {
  if (!pairs.length) return;
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  const s = t.objectStore(store);
  for (const [k, v] of pairs) s.put(v, k);
  return done(t);
}

export async function del(store, key) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).delete(key);
  return done(t);
}

export async function delMany(store, keys) {
  if (!keys.length) return;
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  const s = t.objectStore(store);
  for (const k of keys) s.delete(k);
  return done(t);
}

export async function entries(store) {
  const db = await open();
  const s = db.transaction(store).objectStore(store);
  const [keys, vals] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
  return keys.map((k, i) => [k, vals[i]]);
}

export async function count(store) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).count());
}

export async function wipe() {
  const db = await open();
  const t = db.transaction(STORES, 'readwrite');
  for (const s of STORES) t.objectStore(s).clear();
  return done(t);
}
