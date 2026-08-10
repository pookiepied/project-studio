import type { IncomingMessage } from "node:http";

import { judgeDestination } from "../../net/destination.js";
import { HttpError, requestStream } from "../../net/http.js";
import { ExtendError } from "../errors.js";
import type { McpChannel } from "./connection.js";
import { JSONRPC_VERSION } from "./wire/jsonrpc.js";

/**
 * A remote MCP server, over Streamable HTTP.
 *
 * The sibling of `StdioChannel`, and the second proof that the channel seam is
 * in the right place: `McpConnection`, the framing, the era probe, and the
 * handshake are unchanged and do not know which of the two they are talking
 * through. If any of them had needed a special case for HTTP, the seam would
 * have been wrong.
 *
 * **The shape mismatch is this file's whole job.** A connection expects a duplex
 * stream of newline-delimited messages. Streamable HTTP is a series of POSTs,
 * each answering with either one JSON body or an event stream carrying several.
 * Everything below turns the second into the first, so that nothing above has to
 * know.
 *
 * **HTTP+SSE is not implemented and never will be** — `C-16`. That is the older
 * two-endpoint transport, deprecated in the revision this client adopts. This is
 * Streamable HTTP, one endpoint, `2025-03-26` and later.
 *
 * **Every network rule is reused, not restated.** `net/http.ts` judges the
 * destination, pins the address it judged, re-judges every redirect, and holds
 * the deadline. This file adds no address handling of its own — a transport that
 * did would be a second place the rebinding rule could be got wrong.
 */

export interface HttpChannelOptions {
  /** The server's single endpoint, as the user typed it. */
  readonly url: string;
  /**
   * The value of the `Authorization` header, or of `authHeaderName` when the
   * server uses its own.
   *
   * Read from the credential store by the caller, held for as long as this
   * channel lives, and never written down. The same rule the stdio channel
   * applies to a secret in the child's environment.
   */
  readonly secret?: string;
  /** The header the secret goes in. `Authorization` when absent. */
  readonly authHeaderName?: string;
  /** How long one exchange may take. */
  readonly timeoutMs?: number;
  /** How large one answer may be. */
  readonly maxBytes?: number;
}

/** 30 seconds, the same budget one request gets on a connection. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** 8 MiB per exchange, the ceiling every other reader in the harness uses. */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The header a legacy server uses to keep a session.
 *
 * Sent back on every later request, and on the `DELETE` that ends the session.
 * The modern era removed sessions entirely, so for a modern server this stays
 * `undefined` and nothing is ever sent — which is why it is read from the
 * response rather than configured.
 */
const SESSION_HEADER = "mcp-session-id";

/**
 * Reassembles Server-Sent Events into the `data` payloads they carry.
 *
 * Deliberately minimal. An MCP server uses one field of this format — `data`
 * holding one JSON-RPC message — so `event`, `id`, and `retry` are read past
 * rather than interpreted. Multi-line `data` is joined with a newline, which is
 * the specified behaviour and is what a server pretty-printing JSON produces.
 */
class EventStreamDecoder {
  #buffer = "";
  #data: string[] = [];

  /** Feeds a chunk and returns the messages that became complete. */
  feed(chunk: string): readonly string[] {
    this.#buffer += chunk;
    const messages: string[] = [];

    // `\r\n` is as legal as `\n` here, and a server behind a proxy that
    // rewrites line endings would otherwise deliver one unbroken line.
    const lines = this.#buffer.split(/\r?\n/);
    // The last piece has no terminator yet, so it is not a line — it is the
    // start of the next one.
    this.#buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line === "") {
        // A blank line ends an event. An event with no `data` is a keep-alive
        // and carries nothing to hand on.
        if (this.#data.length > 0) messages.push(this.#data.join("\n"));
        this.#data = [];
        continue;
      }
      if (line.startsWith(":")) continue; // a comment, also used as a keep-alive
      const separator = line.indexOf(":");
      const field = separator === -1 ? line : line.slice(0, separator);
      if (field !== "data") continue;
      const value = separator === -1 ? "" : line.slice(separator + 1);
      this.#data.push(value.startsWith(" ") ? value.slice(1) : value);
    }

    return messages;
  }
}

export class HttpChannel implements McpChannel {
  readonly #url: string;
  readonly #secret: string | undefined;
  readonly #authHeaderName: string;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;

  #data: ((chunk: string | Uint8Array) => void) | undefined;
  #diagnostics: ((chunk: string | Uint8Array) => void) | undefined;
  #close: ((reason?: unknown) => void) | undefined;
  #ended = false;
  #sessionId: string | undefined;
  /**
   * Stops an exchange that is still in flight when the channel is closed.
   *
   * One controller for the channel rather than one per exchange: closing means
   * every exchange ends, and there is no case where one should survive.
   */
  readonly #stop = new AbortController();
  /** Buffered for the same reason the stdio channel buffers — see there. */
  readonly #buffered: string[] = [];
  readonly #bufferedDiagnostics: string[] = [];

  constructor(options: HttpChannelOptions) {
    this.#url = options.url;
    this.#secret = options.secret;
    this.#authHeaderName = options.authHeaderName ?? "authorization";
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  /**
   * There is no program to start, so this only checks the address.
   *
   * The stdio channel waits to see whether the program survives, because a
   * server that exits immediately is its most common failure. The equivalent
   * here is the handshake, which is one layer up and already happens. What this
   * does add is an immediate, clear refusal for an address the policy will never
   * allow, instead of one buried in the first exchange.
   */
  static async open(options: HttpChannelOptions): Promise<HttpChannel> {
    // Throws a `DestinationError` naming the reason. The same judgement runs
    // again on every exchange; this one exists so the reason arrives at the
    // person adding the server rather than inside the first call.
    judgeDestination(options.url, "user");
    return new HttpChannel(options);
  }

  /**
   * Sends one message, and feeds whatever comes back to the data listener.
   *
   * Returns before the answer arrives, because that is what a duplex channel
   * does and what everything above expects. A failure therefore cannot be
   * thrown at the caller — it is recorded as a diagnostic, and a failure that
   * means the server is unusable ends the channel, which is how the layer above
   * learns.
   */
  send(line: string): void {
    if (this.#ended) throw new ExtendError("disconnected");
    void this.#exchange(line);
  }

  onData(listener: (chunk: string | Uint8Array) => void): void {
    this.#data = listener;
    while (this.#buffered.length > 0) listener(this.#buffered.shift() as string);
  }

  /**
   * A remote server has no `stderr`, so this carries the transport's own
   * complaints instead.
   *
   * The alternative was an empty method, and an empty method here would mean a
   * failed exchange left no trace anywhere: `send` cannot throw, so without this
   * the only symptom of a server answering `502` on every call would be requests
   * that time out one by one. `connection.diagnostics` is where a failure goes
   * to be quotable, and that is exactly what this needs.
   */
  onStderr(listener: (chunk: string | Uint8Array) => void): void {
    this.#diagnostics = listener;
    while (this.#bufferedDiagnostics.length > 0) {
      listener(this.#bufferedDiagnostics.shift() as string);
    }
  }

  onClose(listener: (reason?: unknown) => void): void {
    this.#close = listener;
    if (this.#ended) listener(undefined);
  }

  /**
   * Ends the channel, and tells a legacy server its session is over.
   *
   * The `DELETE` is best-effort and deliberately not waited for. A server that
   * ignores it or is already gone must not keep us here, and the session is
   * over on our side either way — the request is a courtesy that lets the server
   * release what it was holding.
   */
  close(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#stop.abort(new ExtendError("disconnected"));

    if (this.#sessionId !== undefined) {
      void requestStream({
        url: this.#url,
        author: "user",
        method: "DELETE",
        headers: this.#headers(),
        timeoutMs: this.#timeoutMs,
      })
        .then((stream) => stream.body.resume())
        .catch(() => undefined);
    }

    this.#close?.(undefined);
  }

  #headers(): Record<string, string> {
    const headers: Record<string, string> = {
      // Both are offered because a server chooses per answer: one JSON body for
      // a plain result, an event stream when it wants to send more than one.
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    };
    if (this.#secret !== undefined) {
      headers[this.#authHeaderName] =
        this.#authHeaderName.toLowerCase() === "authorization"
          ? `Bearer ${this.#secret}`
          : this.#secret;
    }
    // Absent for a modern server, which has no sessions at all.
    if (this.#sessionId !== undefined) headers[SESSION_HEADER] = this.#sessionId;
    return headers;
  }

  async #exchange(line: string): Promise<void> {
    let stream;
    try {
      stream = await requestStream({
        url: this.#url,
        // The address came from a settings form, so the `C-17` policy lets it
        // be on this machine or this network. A redirect from it is still
        // judged as the far end's choice — `net/http.ts` does that, and this
        // file must not be the place that seems to decide it.
        author: "user",
        method: "POST",
        headers: this.#headers(),
        body: line,
        timeoutMs: this.#timeoutMs,
        signal: this.#stop.signal,
      });
    } catch (error) {
      if (this.#ended) return;
      // A slow answer is one call going badly; the server is still there and
      // the next call may be fine. A server that cannot be reached at all is
      // the connection being over, and ending it is what lets the supervisor
      // back off and try again instead of every later call failing the same way.
      if (error instanceof HttpError && error.kind === "timeout") {
        this.#record("the server did not answer in time");
        this.#refuse(line, "The server did not answer in time.");
        return;
      }
      this.#fail(error);
      return;
    }

    const session = stream.headers[SESSION_HEADER];
    // Captured on any answer, not only the handshake's: a legacy server may
    // start a session on any response, and reading it once would mean losing it
    // if the first exchange was something else.
    if (session !== undefined && session !== "") this.#sessionId = session;

    if (stream.status === 202 || stream.status === 204) {
      // A notification was accepted. There is nothing to read and nothing to
      // hand on, and reading a body that will not come would hold the socket.
      stream.body.resume();
      return;
    }

    if (stream.status === 404 && this.#sessionId !== undefined) {
      // The specified way a server says a session is over. It is not an error
      // to report — it is the connection ending, and everything waiting must be
      // failed rather than left to time out one at a time.
      stream.body.resume();
      this.#fail(
        new ExtendError("disconnected", {
          message: "The server ended the session.",
        }),
      );
      return;
    }

    if (stream.status < 200 || stream.status >= 300) {
      stream.body.resume();
      this.#record(`the server answered ${String(stream.status)}`);
      this.#refuse(line, `The server answered ${String(stream.status)}.`);
      return;
    }

    await this.#read(stream.body, stream.headers["content-type"] ?? "", line);
  }

  /**
   * Reads one answer and hands each message it carried to the data listener.
   *
   * The ceiling is counted here rather than by `net/http.ts`, because an event
   * stream is read as it arrives and a ceiling applied by the reader would have
   * to buffer the whole thing to count it — which is the reason this transport
   * takes the unread body in the first place.
   */
  async #read(body: IncomingMessage, contentType: string, sent: string): Promise<void> {
    const stream = contentType.includes("text/event-stream");
    const decoder = new EventStreamDecoder();
    let size = 0;
    let collected = "";

    return new Promise<void>((resolve) => {
      const finish = (): void => {
        // A plain JSON answer is one message and is only complete at the end.
        if (!stream && collected.trim() !== "") this.#deliver(collected);
        resolve();
      };

      body.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.#maxBytes) {
          body.destroy();
          this.#record("the server sent more than can be read in one answer");
          this.#refuse(sent, "The server sent more than can be read in one answer.");
          resolve();
          return;
        }
        const text = chunk.toString("utf8");
        if (stream) {
          for (const message of decoder.feed(text)) this.#deliver(message);
        } else {
          collected += text;
        }
      });
      body.on("end", finish);
      body.on("close", finish);
      body.on("error", (error) => {
        this.#record(`the answer could not be read: ${error.message}`);
        resolve();
      });
    });
  }

  /**
   * Answers a request the transport could not carry, on the transport's behalf.
   *
   * In this transport a failed POST **is** the answer to whatever that POST
   * carried: no separate response is coming, ever. Without this, a server
   * answering `502` on every call would show up as requests timing out one by
   * one, thirty seconds apart, with the real reason only in the diagnostics.
   *
   * This is the one place the channel writes a protocol message rather than
   * moving one, and the justification is narrow: it is the translation of an
   * HTTP status into the vocabulary of the layer above, which is this file's
   * entire job. A notification has no id and gets no answer, exactly as when it
   * succeeds.
   */
  #refuse(sent: string, message: string): void {
    let id: unknown;
    try {
      id = (JSON.parse(sent) as { id?: unknown }).id;
    } catch {
      return;
    }
    if (id === undefined || id === null) return;

    this.#deliver(
      JSON.stringify({
        jsonrpc: JSONRPC_VERSION,
        id,
        // Outside the reserved band the era probe reads, so a transport failure
        // can never be mistaken for a server refusing a protocol version.
        error: { code: -32000, message },
      }),
    );
  }

  /** Hands one JSON-RPC message up as a framed line. */
  #deliver(message: string): void {
    // The layer above reads newline-delimited JSON. A message that arrived by
    // any other route still leaves here in the one shape it understands, which
    // is the whole point of this file.
    const line = `${message.trim()}\n`;
    if (this.#data === undefined) this.#buffered.push(line);
    else this.#data(line);
  }

  #record(text: string): void {
    const line = `${text}\n`;
    if (this.#diagnostics === undefined) this.#bufferedDiagnostics.push(line);
    else this.#diagnostics(line);
  }

  /** The channel cannot continue. Everything waiting is failed by the layer above. */
  #fail(reason: unknown): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#stop.abort(reason);
    this.#record(
      reason instanceof HttpError || reason instanceof ExtendError
        ? reason.message
        : String(reason),
    );
    this.#close?.(reason);
  }
}
