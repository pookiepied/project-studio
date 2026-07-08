/**
 * Persistent cache for remote app icons (Composio logos, etc.), so the same
 * image isn't re-fetched from the network on every render/mount across the
 * app picker, featured cards, and browse grid. IndexedDB works identically
 * in the Tauri webview and the web app, so one implementation covers both.
 */
const DB_NAME = "studio-icon-cache";
const STORE = "icons";
const DB_VERSION = 1;
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedIcon {
  dataUrl: string;
  cachedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function readCache(url: string): Promise<string | undefined> {
  try {
    const db = await openDB();
    const entry = await new Promise<CachedIcon | undefined>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(url);
      req.onsuccess = () => { db.close(); resolve(req.result as CachedIcon | undefined); };
      req.onerror = () => { db.close(); resolve(undefined); };
    });
    if (!entry || Date.now() - entry.cachedAt > TTL_MS) return undefined;
    return entry.dataUrl;
  } catch {
    return undefined;
  }
}

async function writeCache(url: string, dataUrl: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ dataUrl, cachedAt: Date.now() } satisfies CachedIcon, url);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch {
    // Best-effort — silently skip on quota/security errors
  }
}

// Dedupe concurrent requests for the same icon (e.g. the same app appearing
// in both the app picker and a featured card mounting at the same time).
const inflight = new Map<string, Promise<string | undefined>>();

// A browse grid can mount 50-200 icons at once, all wanting to fetch
// simultaneously. Cap how many are actually in flight so a big grid doesn't
// blast the logo host with a burst request it may rate-limit or drop —
// the rest just queue instead of failing.
const MAX_CONCURRENT_FETCHES = 4;
let activeFetches = 0;
const queue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeFetches < MAX_CONCURRENT_FETCHES) {
    activeFetches++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    queue.push(() => {
      activeFetches++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeFetches--;
  const next = queue.shift();
  if (next) next();
}

/**
 * Resolves to a cached data-URL for the icon at `url`. Serves the cached
 * copy if it's younger than 7 days; otherwise fetches, caches, and returns
 * the fresh copy. Resolves to `undefined` on any failure (missing CORS
 * headers on the logo host, network error, etc.) so callers can fall back
 * to loading `url` directly or to a placeholder.
 */
export async function getCachedIcon(url: string): Promise<string | undefined> {
  const cached = await readCache(url);
  if (cached) return cached;

  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = (async () => {
    await acquireSlot();
    try {
      const res = await fetch(url);
      if (!res.ok) return undefined;
      const dataUrl = await blobToDataUrl(await res.blob());
      await writeCache(url, dataUrl);
      return dataUrl;
    } catch {
      return undefined;
    } finally {
      releaseSlot();
      inflight.delete(url);
    }
  })();
  inflight.set(url, promise);
  return promise;
}
