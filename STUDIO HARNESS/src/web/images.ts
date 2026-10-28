import { parseDestination } from "../net/destination.js";
import { requestBinary, type HttpBinaryResponse } from "../net/http.js";
import { sniffImage } from "./favicons.js";

/**
 * A picture from the web, fetched for the window that shows it in a reply.
 *
 * A reply may embed any image the model can name - a product shot, a chart a
 * page published, a diagram from documentation - and the window must not
 * fetch it itself, for the reason `favicons.ts` gives at length: an `<img>`
 * pointing at third-party hosts from a desktop app tells each of them what a
 * person is reading, on every render of a transcript. So the harness asks,
 * once, and the window only ever asks the harness. The webview's policy
 * allows `data:` pictures and nothing remote, and stays that way.
 *
 * The address is the model's, so it is judged as the model's: a private or
 * loopback host is refused, on the first request and on every redirect.
 * Bytes are accepted only when they begin the way an image begins, under a
 * cap, within a timeout; the header's content type is not consulted.
 *
 * Kept in memory, bounded by total size: a transcript scrolled back and forth
 * asks for the same pictures again, and the window's own cache does not
 * survive a reload.
 */

export interface WebImage {
  readonly bytes: Buffer;
  readonly mimeType: string;
}

export interface WebImageSource {
  fetch(url: string): Promise<WebImage | null>;
}

export interface WebImageProxyOptions {
  /** Injectable for tests; production reaches the network. */
  readonly requestBinary?: (options: Parameters<typeof requestBinary>[0]) => Promise<HttpBinaryResponse>;
}

const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const CACHE_MAX_BYTES = 96 * 1024 * 1024;
const TIMEOUT_MS = 12_000;

export class WebImageProxy implements WebImageSource {
  readonly #requestBinary: NonNullable<WebImageProxyOptions["requestBinary"]>;
  readonly #held = new Map<string, Promise<WebImage | null>>();
  readonly #sizes = new Map<string, number>();
  #total = 0;

  constructor(options: WebImageProxyOptions = {}) {
    this.#requestBinary = options.requestBinary ?? requestBinary;
  }

  fetch(url: string): Promise<WebImage | null> {
    let parsed: URL;
    try {
      parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return Promise.resolve(null);
      parseDestination(parsed.href);
    } catch {
      return Promise.resolve(null);
    }
    const key = parsed.href;
    const held = this.#held.get(key);
    if (held !== undefined) {
      // Most recently used goes to the back of the eviction order.
      this.#held.delete(key);
      this.#held.set(key, held);
      return held;
    }
    const fetched = this.#fetch(key).then((image) => {
      // A miss is not kept: the host may answer next time.
      if (image === null) this.#held.delete(key);
      else this.#account(key, image.bytes.byteLength);
      return image;
    });
    this.#held.set(key, fetched);
    return fetched;
  }

  async #fetch(url: string): Promise<WebImage | null> {
    try {
      const response = await this.#requestBinary({
        url,
        author: "model",
        timeoutMs: TIMEOUT_MS,
        maxBytes: IMAGE_MAX_BYTES,
        maxRedirects: 4,
        headers: { accept: "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8" },
      });
      if (response.status !== 200) return null;
      const mimeType = sniffImage(response.bytes);
      return mimeType === null ? null : { bytes: response.bytes, mimeType };
    } catch {
      return null;
    }
  }

  #account(key: string, size: number): void {
    this.#sizes.set(key, size);
    this.#total += size;
    for (const oldest of this.#held.keys()) {
      if (this.#total <= CACHE_MAX_BYTES) break;
      if (oldest === key) continue;
      this.#total -= this.#sizes.get(oldest) ?? 0;
      this.#sizes.delete(oldest);
      this.#held.delete(oldest);
    }
  }
}
