import { ExtendError } from "../errors.js";
import { NdjsonDecoder, encodeNdjson, serializedNdjsonFrame } from "./wire/framing.js";
import {
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcSuccessResponse,
  JSONRPC_VERSION,
} from "./wire/jsonrpc.js";
import { PendingRequests } from "./wire/pending.js";
import { createStudioUuid } from "../../contracts/uuid.js";
import { observeOperation, observeSynchronousOperation } from "../../observability/operation.js";
import { createObservationWriter, diagnosticRecorder } from "../../observability/recorder.js";
import { diagnosticJsonContent } from "../../observability/diagnostic-value.js";
import { currentExecutionContext } from "../../execution/context.js";

/**
 * One conversation with one MCP server.
 *
 * Everything below this is decided: framing knows how bytes become messages,
 * `pending.ts` knows how a request finds its answer, `era.ts` knows which
 * protocol a server speaks. This joins them to something that is actually
 * running, and owns the two things none of them can own — what happens when
 * the other end goes away, and what happens to everyone waiting when it does.
 *
 * **The channel is injected.** A connection is given something that can carry
 * bytes and report that it ended; it does not know whether that is a child
 * process or an HTTP stream. That is what lets every rule here be tested
 * without starting a process, and it is the same reason the wire layer is
 * pure. The child-process channel is a small adapter and the only part that
 * cannot be tested this way.
 *
 * **Nothing here decides permission.** A connection carries requests for tools
 * that were already admitted. `CallGate` is still the only door, and a server
 * that is not selected for a project is never connected at all — so hiding it
 * is mechanical rather than a policy this file could get wrong.
 */

/** What a connection needs from whatever is carrying its bytes. */
export interface McpChannel {
  /** Sends one framed message. Rejects if the channel is already gone. */
  send(line: string): void;
  /** Every chunk that arrives, in order. */
  onData(listener: (chunk: string | Uint8Array) => void): void;
  /**
   * The server's diagnostics. Always subscribed, because a pipe nobody reads
   * fills and then blocks the process writing into it — a server that logs
   * enough would otherwise hang rather than fail.
   */
  onStderr(listener: (chunk: string | Uint8Array) => void): void;
  /** The channel ended, for any reason. Called at most once. */
  onClose(listener: (reason?: unknown) => void): void;
  /** Ends it from our side. Idempotent. */
  close(): void;
  /**
   * Resolves once the transport's resources are actually released.
   *
   * Optional because it only means something for a transport with an operating
   * system process behind it. `close()` requests the end; this is how a caller
   * knows the end happened, which matters when the next thing it does is
   * delete a directory the process was running in.
   */
  whenExited?(): Promise<void>;
}

export interface McpConnectionOptions {
  /** Stable registry identity; never the launch key, which can contain paths. */
  readonly serverId?: string;
  /**
   * How long one request may wait. A per-request deadline rather than one for
   * the connection: a slow tool must not be indistinguishable from a dead
   * server, and only the request knows which it is.
   */
  readonly requestTimeoutMs?: number;
  /**
   * How much of the server's diagnostics to keep. Bounded, because `stderr`
   * from a broken server is unbounded and the last lines are the ones that say
   * why it broke.
   */
  readonly stderrLines?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The request an oversize line answers, read from its kept first characters.
 *
 * Only an id among the first two top-level members counts: servers write
 * `jsonrpc` and `id` ahead of the result, and an `"id"` found deeper would
 * belong to something inside the result and fail the wrong request.
 */
export function oversizeResponseId(raw: string): number | undefined {
  const match = /^\s*\{\s*(?:"jsonrpc"\s*:\s*"2\.0"\s*,\s*)?"id"\s*:\s*(\d+)\s*,/.exec(raw);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/**
 * Two hundred lines of diagnostics.
 *
 * Enough that a stack trace and the lines around it survive, and small enough
 * that a server logging in a loop cannot grow our memory. The *last* lines are
 * kept rather than the first: the failure is at the end.
 */
const DEFAULT_STDERR_LINES = 200;

export class McpConnection {
  readonly connectionId = createStudioUuid();
  readonly #channel: McpChannel;
  readonly #pending = new PendingRequests();
  readonly #responseFrames = new Map<number, string | undefined>();
  readonly #decoder = new NdjsonDecoder();
  readonly #timeoutMs: number;
  readonly #stderrLimit: number;
  readonly #stderr: string[] = [];
  readonly #serverId: string | undefined;
  /**
   * Ids whose caller wants the whole answer rather than its result.
   *
   * Only the era probe does, and only once per connection, so this is empty for
   * the entire working life of a server. An id is removed however its request
   * settles, including by timeout, so nothing accumulates here.
   */
  readonly #wantsEnvelope = new Set<number>();
  #onClose: ((reason?: unknown) => void) | undefined;
  #onNotification: ((method: string, params: unknown) => void) | undefined;
  readonly #bufferedNotifications: { readonly method: string; readonly params: unknown }[] = [];
  #closeReason: unknown;
  #closed = false;

  constructor(channel: McpChannel, options: McpConnectionOptions = {}) {
    this.#serverId = options.serverId;
    this.#channel = channel;
    this.#timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#stderrLimit = options.stderrLines ?? DEFAULT_STDERR_LINES;

    channel.onData((chunk) => this.#receive(chunk));
    channel.onStderr((chunk) => this.#recordDiagnostics(chunk));
    channel.onClose((reason) => this.#ended(reason));
    this.#connectionObservation("channel_attached");
  }

  /** Whether this connection has ended, from either side. */
  get closed(): boolean {
    return this.#closed;
  }

  /** How many requests are waiting for an answer. */
  get inFlight(): number {
    return this.#pending.size;
  }

  /**
   * The last of what the server wrote to `stderr`.
   *
   * Kept so a failure can say what the server said. A server that exits
   * immediately usually explains itself here and nowhere else, and without
   * this the only report available is "it stopped", which no one can act on.
   */
  get diagnostics(): readonly string[] {
    return [...this.#stderr];
  }

  /**
   * Sends a request and waits for its answer.
   *
   * The id is taken before the message is built, so the value on the wire and
   * the value waited for are the same one. Registration happens **before** the
   * send: a server fast enough to answer synchronously would otherwise reply to
   * an id nothing is waiting for yet.
   */
  async request(
    method: string,
    params?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return observeOperation("mcp", "mcp.request", () => this.#send(method, params, false, signal), { connectionId: this.connectionId, method });
  }

  /**
   * Sends a request and returns the whole answer, error responses included.
   *
   * `request` unwraps: a JSON-RPC error becomes a rejection and its `code` is
   * gone. That is right for every ordinary call — a caller asking for a tool
   * list has no use for a number — and wrong for exactly one, because the era
   * probe reads the code to tell a modern refusal from a legacy server that
   * does not know the method. Unwrapping first and re-deciding after would mean
   * reconstructing what was just discarded.
   *
   * Only transport failures reject here: a timeout, a dead channel, a send that
   * could not happen. An answer of any shape resolves, because for this one
   * caller an error *is* the answer.
   */
  async requestEnvelope(
    method: string,
    params?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return observeOperation("mcp", "mcp.request_envelope", () => this.#send(method, params, true, signal), { connectionId: this.connectionId, method });
  }

  /**
   * Called once when the connection ends, from either side.
   *
   * The supervisor needs this and cannot get it from the channel: the channel
   * carries a single close listener and this class already took it. Registering
   * after the end still fires, because a connection that died between being
   * built and being watched is otherwise a server that is never restarted.
   */
  onClose(listener: (reason?: unknown) => void): void {
    this.#onClose = listener;
    if (this.#closed) listener(this.#closeReason);
  }

  onNotification(listener: (method: string, params: unknown) => void): void {
    this.#onNotification = listener;
    while (this.#bufferedNotifications.length > 0) {
      const notification = this.#bufferedNotifications.shift();
      if (notification !== undefined) listener(notification.method, notification.params);
    }
  }

  async #send(
    method: string,
    params: unknown,
    wantsEnvelope: boolean,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    if (this.#closed) {
      throw new ExtendError("disconnected");
    }

    const id = this.#pending.nextId();
    const recordObservation = createObservationWriter();
    // Human browser input can contain passwords; live frames and keystrokes
    // never enter diagnostics, even when tool-content capture is enabled.
    const captureContent = method !== "studio/browser" && diagnosticRecorder.capturesContent(currentExecutionContext()?.flueInstanceId);
    const waiting = this.#pending
      .register(id, { timeoutMs: this.#timeoutMs, ...(signal ? { signal } : {}) })
      // However this settles, the id stops being special. Written as part of
      // the returned chain rather than as a side effect, so it cannot be
      // skipped by a path that settles some other way.
      .finally(() => this.#wantsEnvelope.delete(id));

    if (wantsEnvelope) this.#wantsEnvelope.add(id);
    if (captureContent) this.#responseFrames.set(id, undefined);

    try {
      const wire = encodeNdjson({
          jsonrpc: JSONRPC_VERSION,
          id,
          method,
          ...(params === undefined ? {} : { params }),
        });
      recordObservation({ name: "mcp.send", phase: "progress", attributes: { connectionId: this.connectionId, rpcId: id, method },
        ...(captureContent ? { content: diagnosticJsonContent(wire) } : {}) });
      this.#channel.send(wire);
    } catch (error) {
      // The send failed, so no answer is coming. Settling here rather than
      // leaving it to the timeout turns a thirty-second wait into an immediate
      // and accurate failure, and keeps the map empty.
      this.#pending.reject(id, error);
    }

    try {
      const answer: unknown = await waiting;
      const frame = this.#responseFrames.get(id);
      recordObservation({ name: "mcp.receive", phase: "progress", attributes: { connectionId: this.connectionId, rpcId: id, method },
        ...(frame === undefined ? {} : { content: diagnosticJsonContent(frame) }) });
      return answer;
    } catch (error) {
      const frame = this.#responseFrames.get(id);
      recordObservation({ name: "mcp.receive", phase: "progress", outcome: "failed", attributes: { connectionId: this.connectionId, rpcId: id, method },
        ...(frame === undefined ? {} : { content: diagnosticJsonContent(frame) }) });
      throw error;
    } finally { this.#responseFrames.delete(id); }
  }

  /**
   * Sends a notification, which by definition has no answer.
   *
   * No id, so nothing is registered and nothing can leak. A notification that
   * silently failed to send is acceptable in a way a request never is — there
   * is no caller waiting to be misled.
   */
  notify(method: string, params?: unknown): void {
    if (this.#closed) return;
    observeSynchronousOperation("mcp", "mcp.notify", () => this.#channel.send(
      encodeNdjson({
        jsonrpc: JSONRPC_VERSION,
        method,
        ...(params === undefined ? {} : { params }),
      }),
    ));
  }

  /** Ends the connection and fails everything still waiting. */
  close(reason?: unknown): void {
    if (this.#closed) return;
    this.#channel.close();
    this.#ended(reason);
  }

  /** Waits for the transport to release its resources. See `McpChannel`. */
  async whenExited(): Promise<void> {
    await this.#channel.whenExited?.();
  }

  #receive(chunk: string | Uint8Array): void {
    for (const message of this.#decoder.feed(chunk, this.#responseFrames.size > 0)) {
      if (!message.ok) {
        // A line we could not read is recorded and the stream continues. One
        // bad line from a chatty server must not take down a connection that
        // is otherwise answering, and the record is what makes a later "why is
        // nothing coming back" answerable.
        this.#record(`unreadable message (${message.reason}): ${message.raw}`);
        // An answer too large to keep still names its request in its first
        // characters. Failing that request now is the difference between an
        // accurate refusal and a caller waiting out the whole deadline for
        // an answer that has already arrived and been dropped.
        const id = message.reason === "oversize" ? oversizeResponseId(message.raw) : undefined;
        if (id !== undefined && this.#pending.reject(id, new ExtendError("too_large"))) {
          this.#connectionObservation("response_oversize", { rpcId: id });
        }
        continue;
      }

      const value = message.value;
      if (isJsonRpcSuccessResponse(value)) {
        this.#connectionObservation("response", { rpcId: value.id, isError: false });
        if (value.id !== null) {
          const settled = this.#pending.resolve(value.id, this.#wanted(value.id) ? value : value.result);
          if (settled && typeof value.id === "number" && this.#responseFrames.has(value.id)) {
            this.#responseFrames.set(value.id, serializedNdjsonFrame(message));
          }
        }
        continue;
      }

      if (isJsonRpcErrorResponse(value)) {
        this.#connectionObservation("response", { rpcId: value.id, isError: true, rpcErrorCode: value.error.code });
        if (value.id !== null && this.#wanted(value.id)) {
          // An error is a legitimate answer to the one caller that asked for
          // the envelope, so it resolves rather than rejects.
          const settled = this.#pending.resolve(value.id, value);
          if (settled && typeof value.id === "number" && this.#responseFrames.has(value.id)) {
            this.#responseFrames.set(value.id, serializedNdjsonFrame(message));
          }
          continue;
        }

        if (value.id === null) {
          // An error with no id answers no request. It is the server reporting
          // something about the connection itself, and the only useful thing
          // to do with it is keep it where a failure can quote it.
          this.#record(`server error: ${value.error.message}`);
          continue;
        }
        const settled = this.#pending.reject(
          value.id,
          new ExtendError("internal", { message: value.error.message }),
        );
        if (settled && typeof value.id === "number" && this.#responseFrames.has(value.id)) {
          this.#responseFrames.set(value.id, serializedNdjsonFrame(message));
        }
        continue;
      }

      if (isJsonRpcNotification(value)) {
        this.#connectionObservation("notification", { method: value.method });
        const notification = {
          method: value.method,
          params: value.params,
        };
        if (this.#onNotification === undefined) this.#bufferedNotifications.push(notification);
        else this.#onNotification(notification.method, notification.params);
        continue;
      }

      // A request or notification from the server. The modern era removed
      // server-to-client requests in favour of multi round-trip results, so
      // anything arriving here is either legacy-era or unsolicited. Recorded
      // rather than dropped, so that "the server asked us something and we
      // ignored it" is visible instead of invisible.
      this.#record(`unhandled message from server: ${JSON.stringify(value)}`);
    }
  }

  /** Whether this id's caller asked for the whole answer. Ids are numbers. */
  #wanted(id: string | number): boolean {
    return typeof id === "number" && this.#wantsEnvelope.has(id);
  }

  #recordDiagnostics(chunk: string | Uint8Array): void {
    const text =
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    for (const line of text.split("\n")) {
      if (line.trim() !== "") this.#record(line);
    }
  }

  #record(line: string): void {
    this.#stderr.push(line);
    // Trimmed from the front: the newest lines are the ones that say why.
    while (this.#stderr.length > this.#stderrLimit) this.#stderr.shift();
  }

  #connectionObservation(stage: string, attributes: Readonly<Record<string, unknown>> = {}): void {
    // A shared connection's incoming messages have no proven conversation owner.
    // Do not inherit the first launch caller's async context or content consent.
    diagnosticRecorder.record({ name: "mcp.connection", phase: "progress", identity: {},
      attributes: { stage, connectionId: this.connectionId,
        ...(this.#serverId === undefined ? {} : { serverId: this.#serverId }), ...attributes } });
  }

  /**
   * The connection ended.
   *
   * Everything still waiting is failed here, and this is the reason this class
   * exists rather than the caller wiring the pieces together. A dead channel
   * with requests still in the map means promises that never settle, which
   * surfaces as an agent that appears to hang with nothing in any log.
   */
  #ended(reason?: unknown): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#connectionObservation("connection_ended", { pending: this.#pending.size });
    this.#closeReason =
      reason ??
      new ExtendError("disconnected", {
        message:
          this.#stderr.length === 0
            ? "The server stopped."
            : `The server stopped. It last said: ${this.#stderr[this.#stderr.length - 1]}`,
      });
    // Everything waiting is failed before anyone is told the connection ended,
    // so a listener that reacts by starting a replacement cannot observe a dead
    // connection that still has requests in its map.
    this.#pending.rejectAll(this.#closeReason);
    this.#onClose?.(this.#closeReason);
  }
}
