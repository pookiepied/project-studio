import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as resolveName } from "node:dns/promises";

import { StudioError } from "../contracts/errors.js";
import { createObservationWriter, type ObservationInput } from "../observability/recorder.js";
import {
  judgeHostPort,
  parseHostPort,
  type HostPort,
  type UrlAuthor,
} from "./destination.js";

/**
 * The one place the harness opens an outbound connection itself.
 *
 * `retrieval/http.ts` reads a page *through a service*, so it can never reach an
 * address on this machine and never needed to. This one connects directly, which
 * is what makes loopback and private addresses reachable at all — and therefore
 * what makes the `C-17` policy in `destination.ts` load-bearing rather than
 * theoretical.
 *
 * Three rules define it, and each exists because leaving it out is a known
 * attack rather than a missing nicety:
 *
 * 1. **The address is pinned.** The name is resolved once, every address it
 *    returned is judged, and the socket is opened to the address that was
 *    judged. Judging a name and then letting the stack resolve it again is DNS
 *    rebinding written as a race: the check and the connection ask two different
 *    questions and can get two different answers.
 * 2. **Every redirect is a new destination**, judged again before it is
 *    followed. ADR 0022 says every destination is checked, and a `Location`
 *    header is a destination chosen by the far end.
 * 3. **A response has a ceiling and a deadline**, as `process/exec.ts` has, so
 *    neither a slow server nor an endless one can hold a turn open.
 *
 * No new dependency: `node:http` and `node:https` are also what make pinning
 * possible at all. `fetch` gives no seam between resolving a name and opening
 * the socket; a raw request takes the address, the `Host` header, and the TLS
 * `servername` as three separate things, which is exactly the seam required.
 */

export type HttpFailure =
  /** The name resolved to nothing, or the socket never opened. */
  | "unreachable"
  /** The deadline passed with the response unfinished. */
  | "timeout"
  /** The body went past the ceiling. It is not read; the socket is dropped. */
  | "too_large"
  /** The server kept redirecting. */
  | "too_many_redirects";

const MESSAGE_BY_FAILURE: Record<HttpFailure, string> = {
  unreachable: "That address could not be reached.",
  timeout: "That address did not answer in time.",
  too_large: "That address sent more data than can be read.",
  too_many_redirects: "That address kept redirecting the request.",
};

export class HttpError extends StudioError {
  readonly domain = "network" as const;
  declare readonly kind: HttpFailure;

  constructor(kind: HttpFailure, options: { message?: string; cause?: unknown } = {}) {
    super(kind, options.message ?? MESSAGE_BY_FAILURE[kind], {
      // A host that is down may be up on the next attempt, and a deadline may
      // have been unlucky. A body that is too big and a server that loops are
      // properties of the far end, so repeating the same call repeats them.
      retryable: kind === "unreachable" || kind === "timeout",
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = "HttpError";
  }
}

/** 30 seconds, matching the reading service so one call does not feel unlike another. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** 8 MiB, the same ceiling `process/exec.ts` puts on a child's output. */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Enough to pass through a canonical-host or add-a-slash hop and stop.
 *
 * A chain longer than this is a loop or an attempt to walk somewhere by small
 * steps, and every step is judged anyway.
 */
const DEFAULT_MAX_REDIRECTS = 5;

export interface HttpRequestOptions {
  readonly url: string;
  /**
   * Who chose the address. Passed straight to the `C-17` policy: a person who
   * typed a host into a settings form may reach their own network, and a model
   * that produced one inside a turn may not.
   */
  readonly author: UrlAuthor;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Text or bytes. The socket layer has always accepted both - `write` does -
   * so widening the type only names what was already true; the multipart
   * uploads the transcription endpoints need are the first callers that had
   * to say it.
   */
  readonly body?: string | Uint8Array;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** The address that actually answered, after any redirects. */
  readonly url: string;
}

/** A response whose body is bytes, not text: audio, primarily. */
export interface HttpBinaryResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: Buffer;
  readonly url: string;
}

/**
 * A response whose body has not been read yet.
 *
 * For a caller that must act on bytes as they arrive. **The caller owns the
 * body**: it either consumes it or destroys it, and it enforces its own ceiling,
 * because a ceiling this function applied would have to buffer to count — which
 * is the one thing this shape exists to avoid.
 */
export interface HttpStream {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly url: string;
  readonly body: IncomingMessage;
}

/** One judged address a name resolved to, in the resolver's own order. */
interface PinnedAddress {
  readonly address: string;
  readonly family: number;
}

/**
 * Resolves a host and judges **every** address it returned.
 *
 * All of them, not the one that will be used. A name that answers with a public
 * address and a loopback address is a name being used to smuggle a destination,
 * and picking the first passing entry would let the same answer through by
 * chance of ordering.
 *
 * Every judged address is returned, in order, because the first is not always
 * the one that answers: Windows resolves `localhost` to `::1` before
 * `127.0.0.1`, and a local server bound to `0.0.0.0` (IPv4 only) refuses the
 * IPv6 one. The caller connects to these and only these, so the pin holds —
 * a fallback moves between addresses that were all judged, never to a fresh
 * resolution.
 */
async function pinAddresses(
  hostPort: HostPort,
  author: UrlAuthor,
): Promise<readonly PinnedAddress[]> {
  let resolved: readonly { address: string; family: number }[];
  try {
    // `verbatim` keeps the resolver's own order rather than sorting IPv4 first.
    // The order decides only which judged address is tried first.
    resolved = await resolveName(hostPort.host, { all: true, verbatim: true });
  } catch (error) {
    throw new HttpError("unreachable", { cause: error });
  }

  if (resolved.length === 0) throw new HttpError("unreachable");

  for (const entry of resolved) {
    judgeHostPort({ host: entry.address, port: hostPort.port }, author);
  }

  const seen = new Set<string>();
  const pinned: PinnedAddress[] = [];
  for (const entry of resolved) {
    if (seen.has(entry.address)) continue;
    seen.add(entry.address);
    pinned.push({ address: entry.address, family: entry.family });
  }
  return pinned;
}

/**
 * Socket errors that mean "nothing listens at this address", raised before a
 * connection exists — so not one byte of the request was sent, and trying the
 * next judged address cannot repeat a side effect. A reset, a timeout, or
 * anything after the socket opened is not here: those may follow a request
 * the far end already received.
 */
const NOT_LISTENING_HERE = new Set([
  "ECONNREFUSED",
  "EADDRNOTAVAIL",
  "EAFNOSUPPORT",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

function connectErrorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpError) || error.kind !== "unreachable") return undefined;
  const cause = (error as { cause?: unknown }).cause;
  const code =
    typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return typeof code === "string" && NOT_LISTENING_HERE.has(code) ? code : undefined;
}

/**
 * Opens one hop to the first judged address that accepts a connection.
 *
 * Falls through to the next address only on a refusal at connect time
 * (`NOT_LISTENING_HERE`); any other failure, the caller's stop, or the
 * deadline ends the hop as it always did. Each fallback is a stable,
 * address-free observation: which family failed, which is tried next, and the
 * socket code — never the address, the URL, or the error text.
 */
async function sendPinned(
  url: URL,
  pinned: readonly PinnedAddress[],
  options: Parameters<typeof sendOnce>[2],
  record: (input: ObservationInput) => void,
): Promise<IncomingMessage> {
  let lastError: unknown = new HttpError("unreachable");
  for (let index = 0; index < pinned.length; index += 1) {
    const candidate = pinned[index];
    if (candidate === undefined) continue;
    try {
      return await sendOnce(url, candidate.address, options);
    } catch (error) {
      lastError = error;
      const code = connectErrorCode(error);
      const next = pinned[index + 1];
      if (code === undefined || next === undefined || options.signal.aborted) throw error;
      record({
        name: "net.http.address_fallback",
        phase: "progress",
        attributes: {
          stage: "connect_refused",
          errorCode: code,
          failedFamily: candidate.family,
          nextFamily: next.family,
          candidateIndex: index,
          candidateCount: pinned.length,
        },
      });
    }
  }
  throw lastError;
}

/** Reads a response body, stopping at the ceiling rather than after it. */
async function readBody(response: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        // Destroyed rather than left to finish: the point of a ceiling is that
        // the bytes past it are never received, not that they are discarded
        // after arriving.
        response.destroy();
        reject(new HttpError("too_large"));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.on("error", (error) => reject(new HttpError("unreachable", { cause: error })));
  });
}

/** The same read, keeping bytes as bytes: audio responses arrive as audio. */
async function readBodyBytes(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        response.destroy();
        reject(new HttpError("too_large"));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => resolve(Buffer.concat(chunks)));
    response.on("error", (error) => reject(new HttpError("unreachable", { cause: error })));
  });
}

/**
 * Headers that may survive a move to a different origin.
 *
 * A redirect is chosen by the far end, so following one with the credentials
 * meant for the first host hands them to the second. This is the shape of the
 * bug that has leaked API keys out of every HTTP client that did not do it.
 */
const REDIRECT_SAFE_HEADERS = new Set(["accept", "content-type", "user-agent"]);

function stripOriginBound(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (REDIRECT_SAFE_HEADERS.has(name.toLowerCase())) kept[name] = value;
  }
  return kept;
}

/** One hop: judge, pin, connect, and hand back the response unread. */
async function sendOnce(
  url: URL,
  pinned: string,
  options: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string | Uint8Array | undefined;
    readonly signal: AbortSignal;
  },
): Promise<IncomingMessage> {
  const secure = url.protocol === "https:";
  const send = secure ? httpsRequest : httpRequest;

  return new Promise<IncomingMessage>((resolve, reject) => {
    const outgoing = send(
      {
        // **This line is the pin.** The address that was judged is what the
        // socket is opened to, so there is no second resolution to disagree
        // with the first — the name never reaches the connection layer at all.
        host: pinned,
        port: Number(url.port === "" ? (secure ? 443 : 80) : url.port),
        path: `${url.pathname}${url.search}`,
        method: options.method,
        // The name still travels, as the header where it belongs. `url.host`
        // carries the port when it is not the default, which is what a virtual
        // host expects to see.
        headers: { ...options.headers, host: url.host },
        signal: options.signal,
        // TLS is verified against the name the caller asked for, not against the
        // address we pinned to. Dropping this turns pinning into a certificate
        // failure on every https request.
        ...(secure ? { servername: url.hostname } : {}),
      },
      resolve,
    );

    outgoing.on("error", (error: NodeJS.ErrnoException) => {
      if (options.signal.aborted) {
        reject(new HttpError("timeout", { cause: error }));
        return;
      }
      reject(new HttpError("unreachable", { cause: error }));
    });

    if (options.body !== undefined) outgoing.write(options.body);
    outgoing.end();
  });
}

/**
 * Runs a request against an address the policy allows, and returns the response.
 *
 * Redirects are followed by hand, and **each hop is judged as though a model
 * chose it**, whatever the caller's author was. That is deliberate and it is the
 * one place this function is stricter than `judgeDestination`: the first address
 * was chosen by whoever the caller says, but a `Location` header was chosen by
 * the far end, and the far end is never the user.
 */
export async function requestStream(options: HttpRequestOptions): Promise<HttpStream> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  const deadline = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  // The caller's stop and our deadline both end this, and they are told apart
  // below rather than merged — our own impatience must not be reported as the
  // user's.
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;

  // Bound at the start: a fallback is recorded only into the capture epoch the
  // request began in.
  const record = createObservationWriter();
  let target = options.url;
  let author: UrlAuthor = options.author;
  let headers: Record<string, string> = { ...options.headers };
  let method = options.method ?? "GET";
  let body = options.body;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const hostPort = parseHostPort(target);
    // Judged before the name is resolved, so a refused literal never becomes a
    // DNS query, and judged again per address inside `pinAddresses`.
    judgeHostPort(hostPort, author);
    const url = new URL(target);
    const pinned = await pinAddresses(hostPort, author);

    let response: IncomingMessage;
    try {
      response = await sendPinned(url, pinned, { method, headers, body, signal }, record);
    } catch (error) {
      if (deadline.aborted && error instanceof HttpError) throw new HttpError("timeout");
      if (options.signal?.aborted) throw options.signal.reason;
      throw error;
    }

    const status = response.statusCode ?? 0;
    const location = response.headers.location;

    if (status >= 300 && status < 400 && location !== undefined) {
      // The body of a redirect is never wanted, and leaving it unread keeps the
      // socket from being held open by a server that sends one anyway.
      response.resume();

      const next = new URL(location, url);
      if (next.host !== url.host) headers = stripOriginBound(headers);
      // 303 means "ask again with GET", and 301/302 are treated the same way by
      // every browser and by every server that relies on them.
      if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      target = next.toString();
      author = "model";
      continue;
    }

    const flat: Record<string, string> = {};
    for (const [name, value] of Object.entries(response.headers)) {
      if (typeof value === "string") flat[name] = value;
      else if (Array.isArray(value)) flat[name] = value.join(", ");
    }

    return { status, headers: flat, url: url.toString(), body: response };
  }

  throw new HttpError("too_many_redirects");
}

/**
 * The same request, with the body read to the end and returned as text.
 *
 * What almost every caller wants. The exception is a transport that has to act
 * on messages as they arrive rather than after the last one — Streamable HTTP
 * holds a stream open and sends several — and that caller takes `requestStream`
 * and its own ceiling. Written as a wrapper so there is one judge-and-pin path
 * and not two.
 */
export async function requestDirect(options: HttpRequestOptions): Promise<HttpResponse> {
  const stream = await requestStream(options);
  const body = await readBody(stream.body, options.maxBytes ?? DEFAULT_MAX_BYTES);
  return { status: stream.status, headers: stream.headers, body, url: stream.url };
}

/**
 * The same request, with the body read to the end and kept as bytes.
 *
 * Written as a wrapper on the same `requestStream`, for the same reason
 * `requestDirect` is: one judge-and-pin path, not two. The 303 rule holds -
 * a redirect turns the request into a GET, and a GET has no body to keep.
 */
export async function requestBinary(options: HttpRequestOptions): Promise<HttpBinaryResponse> {
  const stream = await requestStream(options);
  const bytes = await readBodyBytes(stream.body, options.maxBytes ?? DEFAULT_MAX_BYTES);
  return { status: stream.status, headers: stream.headers, bytes, url: stream.url };
}
