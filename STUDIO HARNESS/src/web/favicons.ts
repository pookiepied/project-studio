import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseDestination } from "../net/destination.js";
import { requestBinary, requestStream, type HttpBinaryResponse, type HttpStream } from "../net/http.js";

/**
 * A site's icon, fetched once and kept.
 *
 * A search result or a page read is drawn with the site's own mark beside
 * it, the way a browser's tab does, because a letter in a disc says which
 * host only after you have read the host. The mark is fetched here, by the
 * harness, and never by the window: an `<img>` pointing at a hundred
 * third-party hosts from a desktop app would be a hundred requests that
 * say which pages a person is reading, on every render of a transcript.
 * The harness asks each host once, from one place, keeps the answer on
 * disk, and the window only ever asks the harness.
 *
 * ---- Two places an icon lives ----------------------------------------------
 *
 * `/favicon.ico` first, because it is one request and most sites answer
 * it. Failing that, the page itself, read as far as its head and scanned
 * for a `<link rel="icon">`, whose address may be relative to the page's
 * final address after redirects. Nothing else is tried: the point is a
 * mark, not the best mark, and a host that answers neither is drawn with
 * its letter and not asked again for a day.
 *
 * ---- What is accepted ------------------------------------------------------
 *
 * Bytes that begin the way an image begins - ICO, PNG, GIF, JPEG, WebP, or
 * an SVG document - and nothing over the cap. The header's content type is
 * not consulted: sites send icons as `text/plain` and HTML as `image/x-icon`,
 * and the bytes are the only honest witness. An SVG is kept as text and
 * served as one; the window shows every kind in an `<img>`, which executes
 * nothing.
 *
 * The host is judged the way a model-supplied address is judged - it came
 * from a search result the model ran - so a private or loopback name is
 * refused before any request is made.
 */

export interface Favicon {
  readonly bytes: Buffer;
  readonly mimeType: string;
}

export interface FaviconSource {
  lookup(host: string): Promise<Favicon | null>;
}

export interface FaviconStoreOptions {
  /** Where icons and misses are kept between runs. */
  readonly directory: string;
  /** Injectable for tests; production reaches the network. */
  readonly requestBinary?: (options: Parameters<typeof requestBinary>[0]) => Promise<HttpBinaryResponse>;
  readonly requestStream?: (options: Parameters<typeof requestStream>[0]) => Promise<HttpStream>;
  readonly now?: () => number;
}

/** A host that answered with no icon is left alone this long. */
const MISS_TTL_MS = 24 * 60 * 60 * 1_000;
const ICON_MAX_BYTES = 256 * 1024;
const PAGE_MAX_BYTES = 128 * 1024;
const TIMEOUT_MS = 6_000;

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/x-icon": "ico",
  "image/png": "png",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([mime, extension]) => [extension, mime]),
);

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const ICON_LINK = /<link\b[^>]*>/gi;
const REL = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/** The image kind the bytes declare themselves to be, or null for not an image. */
export function sniffImage(bytes: Buffer): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "image/x-icon";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  const head = bytes.subarray(0, 512).toString("utf8").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

/** The icon a page's head names, resolved against the page's own address. */
export function iconLinkIn(html: string, pageUrl: string): string | null {
  for (const tag of html.match(ICON_LINK) ?? []) {
    const rel = REL.exec(tag);
    const relValue = (rel?.[1] ?? rel?.[2] ?? rel?.[3] ?? "").toLowerCase().split(/\s+/);
    if (!relValue.includes("icon")) continue;
    const href = HREF.exec(tag);
    const hrefValue = href?.[1] ?? href?.[2] ?? href?.[3];
    if (hrefValue === undefined || hrefValue === "") continue;
    try {
      return new URL(hrefValue, pageUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

export class FaviconStore implements FaviconSource {
  readonly #directory: string;
  readonly #requestBinary: NonNullable<FaviconStoreOptions["requestBinary"]>;
  readonly #requestStream: NonNullable<FaviconStoreOptions["requestStream"]>;
  readonly #now: () => number;
  readonly #memory = new Map<string, Promise<Favicon | null>>();

  constructor(options: FaviconStoreOptions) {
    this.#directory = options.directory;
    this.#requestBinary = options.requestBinary ?? requestBinary;
    this.#requestStream = options.requestStream ?? requestStream;
    this.#now = options.now ?? Date.now;
  }

  lookup(host: string): Promise<Favicon | null> {
    const key = host.trim().toLowerCase();
    if (!HOST.test(key)) return Promise.resolve(null);
    const held = this.#memory.get(key);
    if (held !== undefined) return held;
    const looked = this.#resolve(key).catch(() => null);
    this.#memory.set(key, looked);
    return looked;
  }

  async #resolve(host: string): Promise<Favicon | null> {
    // A private name is refused here, the way a model's fetch is, before
    // anything is asked of the network or the disk.
    try {
      parseDestination(`https://${host}/`);
    } catch {
      return null;
    }

    const kept = await this.#fromDisk(host);
    if (kept !== undefined) return kept;

    const found = (await this.#fromIconPath(host)) ?? (await this.#fromPage(host));
    await this.#toDisk(host, found);
    return found;
  }

  async #fromDisk(host: string): Promise<Favicon | null | undefined> {
    for (const [extension, mimeType] of Object.entries(MIME_BY_EXTENSION)) {
      try {
        const bytes = await readFile(join(this.#directory, `${host}.${extension}`));
        return { bytes, mimeType };
      } catch {
        // Not this kind.
      }
    }
    try {
      const miss = await stat(join(this.#directory, `${host}.miss`));
      if (this.#now() - miss.mtimeMs < MISS_TTL_MS) return null;
    } catch {
      // Never asked.
    }
    return undefined;
  }

  async #toDisk(host: string, icon: Favicon | null): Promise<void> {
    try {
      await mkdir(this.#directory, { recursive: true });
      if (icon === null) {
        await writeFile(join(this.#directory, `${host}.miss`), "");
      } else {
        await writeFile(join(this.#directory, `${host}.${EXTENSIONS[icon.mimeType] ?? "bin"}`), icon.bytes);
      }
    } catch {
      // The disk is a convenience; the answer stands without it.
    }
  }

  async #fetchIcon(url: string): Promise<Favicon | null> {
    try {
      const response = await this.#requestBinary({
        url,
        author: "model",
        timeoutMs: TIMEOUT_MS,
        maxBytes: ICON_MAX_BYTES,
        maxRedirects: 3,
        headers: { accept: "image/*,*/*;q=0.5" },
      });
      if (response.status !== 200) return null;
      const mimeType = sniffImage(response.bytes);
      return mimeType === null ? null : { bytes: response.bytes, mimeType };
    } catch {
      return null;
    }
  }

  #fromIconPath(host: string): Promise<Favicon | null> {
    return this.#fetchIcon(`https://${host}/favicon.ico`);
  }

  /**
   * The page, read only as far as its head. A page is usually far larger
   * than any sensible cap, and the link is in its first kilobytes, so the
   * body is streamed and dropped at `</head>` or at the cap, whichever
   * comes first.
   */
  async #fromPage(host: string): Promise<Favicon | null> {
    let page: HttpStream;
    try {
      page = await this.#requestStream({
        url: `https://${host}/`,
        author: "model",
        timeoutMs: TIMEOUT_MS,
        maxRedirects: 3,
        headers: { accept: "text/html" },
      });
    } catch {
      return null;
    }
    if (page.status !== 200) {
      page.body.destroy();
      return null;
    }
    const head = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const finish = () => {
        page.body.destroy();
        resolve(Buffer.concat(chunks).toString("utf8"));
      };
      page.body.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        size += chunk.length;
        if (size >= PAGE_MAX_BYTES || chunk.toString("latin1").includes("</head>")) finish();
      });
      page.body.on("end", finish);
      page.body.on("error", finish);
    });
    const link = iconLinkIn(head, page.url);
    return link === null ? null : this.#fetchIcon(link);
  }
}
