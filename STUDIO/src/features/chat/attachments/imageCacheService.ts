const DB_NAME = "studio-file-cache";
const STORE = "files";
const DB_VERSION = 1;

type CachedFile =
  | { kind: "image"; dataUrl: string }
  | { kind: "pdf-pages"; pageImages: string[] };

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function cacheKey(name: string, size: number): string {
  return `${name}::${size}`;
}

export async function cacheImageFile(name: string, size: number, file: File): Promise<void> {
  try {
    const dataUrl = await fileToDataUrl(file);
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ kind: "image", dataUrl } as CachedFile, cacheKey(name, size));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch {
    // Best-effort — silently skip on quota/security errors
  }
}

export async function cachePDFPages(name: string, size: number, pageImages: string[]): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ kind: "pdf-pages", pageImages } as CachedFile, cacheKey(name, size));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch {
    // Best-effort
  }
}

export async function getCachedFile(name: string, size: number): Promise<CachedFile | undefined> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(cacheKey(name, size));
      req.onsuccess = () => { db.close(); resolve(req.result as CachedFile | undefined); };
      req.onerror = () => { db.close(); resolve(undefined); };
    });
  } catch {
    return undefined;
  }
}

export function dataUrlToFile(dataUrl: string, name: string, type: string): File {
  const [, base64] = dataUrl.split(",");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type });
}
