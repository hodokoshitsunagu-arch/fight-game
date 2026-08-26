/**
 * AssetCache.js — persistent bytes for the boot assets.
 *
 * The models alone are 115MB, and three's own `Cache` is a plain object that
 * dies with the page, so every reload re-downloads all of it. This keeps the
 * raw bytes in IndexedDB, keyed by URL, and hands them back on the next visit.
 *
 * Deliberately a *byte* cache rather than a parsed-object cache. Parsed FBX
 * hierarchies and GPU textures are not structured-cloneable, and re-parsing
 * bytes is milliseconds against seconds of download — the download is the cost
 * worth removing.
 *
 * Every method is written to fail soft. Storage is one of the least reliable
 * things a browser offers: private windows refuse it, quota runs out mid-write,
 * a user clears site data between two calls, and Safari evicts on its own
 * schedule. None of that may break booting, so a cache failure always degrades
 * to a plain network load rather than propagating.
 */

const DB_NAME = 'fight-game-assets';
const STORE = 'bytes';

/**
 * Bump to invalidate everything.
 *
 * Vite hashes the JS bundle but not files in `public/`, so a replaced model or
 * panorama keeps its URL and would otherwise be served stale forever. There is
 * no free way to detect that — revalidating each asset costs the round trip the
 * cache exists to avoid — so this is manual and deliberate. `clearAssetCache()`
 * is on `window` for the same reason.
 */
const VERSION = 1;

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      // Private windows throw here rather than returning a request.
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'url' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

function transact(db, mode, run) {
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE, mode);
    } catch {
      resolve(null);
      return;
    }
    const request = run(tx.objectStore(STORE));
    tx.onabort = () => resolve(null);
    tx.onerror = () => resolve(null);
    if (request) {
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    } else {
      tx.oncomplete = () => resolve(null);
    }
  });
}

/**
 * @param {string} url
 * @returns {Promise<ArrayBuffer|null>} null on a miss, a stale version, or any
 *   storage failure at all.
 */
export async function readAsset(url) {
  const db = await openDatabase();
  if (!db) return null;
  const record = await transact(db, 'readonly', (store) => store.get(url));
  if (!record || record.version !== VERSION) return null;
  return record.bytes ?? null;
}

/**
 * @param {string} url
 * @param {ArrayBuffer} bytes
 * @returns {Promise<boolean>} whether it actually landed.
 */
export async function writeAsset(url, bytes) {
  const db = await openDatabase();
  if (!db) return false;
  const stored = await transact(db, 'readwrite', (store) =>
    // Quota is the expected failure, not an exceptional one: these assets are
    // 130MB together and a phone may simply refuse. The load carries on.
    store.put({ url, bytes, version: VERSION, storedAt: Date.now() })
  );
  return stored !== null;
}

/** Everything currently held, for a readout. */
export async function assetCacheStats() {
  const db = await openDatabase();
  if (!db) return { available: false, count: 0, bytes: 0 };
  const records = await transact(db, 'readonly', (store) => store.getAll());
  if (!records) return { available: true, count: 0, bytes: 0 };
  const live = records.filter((r) => r.version === VERSION);
  return {
    available: true,
    count: live.length,
    bytes: live.reduce((total, r) => total + (r.bytes?.byteLength ?? 0), 0)
  };
}

/** Drop everything. Reload afterwards to re-fetch. */
export async function clearAssetCache() {
  const db = await openDatabase();
  if (!db) return false;
  await transact(db, 'readwrite', (store) => store.clear());
  return true;
}
