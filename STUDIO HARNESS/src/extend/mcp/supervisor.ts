import { ExtendError } from "../errors.js";
import { McpConnection, type McpChannel, type McpConnectionOptions } from "./connection.js";
import { handshake, type McpSession } from "./handshake.js";
import type { McpServerRecord } from "./registry.js";
import { getBackoffDelay, type BackoffOptions } from "../../reliability/backoff.js";
import { transition, type LifecycleEvent, type LifecycleState } from "./wire/lifecycle.js";
import { createChildExecutionContext, createRetryExecutionContext, createRootExecutionContext,
  currentExecutionContext, runWithExecutionContext, type ExecutionContext } from "../../execution/context.js";
import { createObservationWriter } from "../../observability/recorder.js";
import { observationFailure } from "../../observability/operation.js";
import { performance } from "node:perf_hooks";

/**
 * The live half of MCP: which servers are running, and what to do when one is
 * not.
 *
 * `lifecycle.ts` knows which transitions are legal and `backoff.ts` knows how
 * long to wait before trying again; neither has ever seen a process. This joins
 * them to a real one. It is the only place in the harness that holds a running
 * server, which is what section 003.3a means by **live objects, never durable**
 * — nothing here is written down, and everything here can be rebuilt from
 * SQLite by starting the servers again.
 *
 * **Nothing is started that nobody asked for.** An entry appears the first time
 * something calls `ensure` and disappears when something calls `stop`. A server
 * installed but never used costs nothing, and there is no background sweep
 * launching processes on a timer.
 *
 * **A failure is fast and a recovery is quiet.** `ensure` waits for the attempt
 * in progress and no longer — a tool call must not sit through fifteen seconds
 * of retries — and a failed attempt schedules the next one in the background,
 * so a server that was briefly broken is running again by the time anyone asks
 * a second time. `backoff.ts` decides when to stop trying, and a server that has
 * given up stays given up until someone restarts it, because retrying a
 * misconfigured command forever hides the misconfiguration.
 *
 * **Nothing here decides permission.** A running connection is a conversation,
 * not an authorization. `CallGate` is still the only door, and a server this
 * class has never been asked to start is one nothing can reach.
 */

/**
 * How a server becomes a channel.
 *
 * Injected rather than built here, for two reasons that point the same way.
 * Starting a real server needs a working directory and, for a server that reads
 * a key from its environment, a secret fetched from the OS credential store at
 * this exact moment — neither of which this class should hold or could hold
 * safely. And a launcher that returns a scripted channel is what lets every
 * rule below be tested against a server that fails on the third attempt, which
 * no real program can be relied on to do.
 */
export interface McpLauncher {
  /**
   * What makes two launches the same launch.
   *
   * The supervisor holds one process per key, and this is the whole of `C-18`'s
   * second half. Two projects may share a process **only** when the command,
   * the arguments, the environment, and the working directory are identical. A
   * filesystem server started in project A and handed to project B would give B
   * a server rooted in A — the folder wall failing with correct tools, the wrong
   * project, and no error anywhere.
   *
   * It belongs to the launcher because the launcher is what varies it. The
   * supervisor does not know what a project root is and must not learn.
   */
  key(record: McpServerRecord): string;
  open(record: McpServerRecord): Promise<McpChannel>;
}

export interface McpSupervisorOptions {
  readonly launch: McpLauncher;
  /** Passed straight to `backoff.ts`. A test injects `random` here. */
  readonly backoff?: BackoffOptions;
  readonly connection?: McpConnectionOptions;
  /** Runs after the handshake, including background retry recovery. */
  readonly onReady?: (record: McpServerRecord, connection: McpConnection) => Promise<void> | void;
  /** Invalidates dependent catalog state when a live server is unavailable. */
  readonly onUnavailable?: (record: McpServerRecord, reason: unknown) => void;
  /** Receives server notifications without teaching the connection about MCP policy. */
  readonly onNotification?: (
    record: McpServerRecord,
    method: string,
    params: unknown,
  ) => void;
}

/** What is true about a server right now. All of it derived, none of it stored. */
export interface McpServerStatus {
  readonly id: string;
  /**
   * Which launch this is. Two entries may share an id and never a key.
   *
   * Exposed because "one server" is no longer the same statement as "one
   * process", and a caller counting processes has to be able to tell them
   * apart.
   */
  readonly key: string;
  readonly state: LifecycleState["kind"];
  /** Failed starts so far. Zero unless the state is `failed` or `given-up`. */
  readonly attempts: number;
  readonly era?: McpSession["era"];
  readonly protocolVersion?: string;
  /** Why the last attempt failed, in the words the failure used. */
  readonly lastError?: string;
  /** The last of what the server wrote to `stderr`, when one is connected. */
  readonly diagnostics: readonly string[];
}

interface Entry {
  execution: ExecutionContext | undefined;
  readonly record: McpServerRecord;
  /** The launcher's answer, kept so an entry can report and remove itself. */
  readonly key: string;
  state: LifecycleState;
  connection: McpConnection | undefined;
  session: McpSession | undefined;
  starting: Promise<McpConnection> | undefined;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  lastError: string | undefined;
  attempts: number;
  /**
   * Bumped every time an attempt begins and every time the server is stopped.
   *
   * This is what makes an abandoned attempt harmless. A start that was in
   * flight when the user switched the server off still finishes — a process was
   * spawned and cannot be un-spawned — and finds its generation stale, so it
   * closes what it built instead of installing it. Without it, switching off
   * during startup leaves a process running that nothing has a handle to.
   */
  generation: number;
}

/** The words a failure used, or the best available description of one. */
function describe(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  return "The server stopped for an unknown reason.";
}

export class McpSupervisor {
  readonly #entries = new Map<string, Entry>();
  readonly #launch: McpLauncher;
  readonly #backoff: BackoffOptions;
  readonly #connectionOptions: McpConnectionOptions;
  readonly #onReady: McpSupervisorOptions["onReady"];
  readonly #onUnavailable: McpSupervisorOptions["onUnavailable"];
  readonly #onNotification: McpSupervisorOptions["onNotification"];

  constructor(options: McpSupervisorOptions) {
    this.#launch = options.launch;
    this.#backoff = options.backoff ?? {};
    this.#connectionOptions = options.connection ?? {};
    this.#onReady = options.onReady;
    this.#onUnavailable = options.onUnavailable;
    this.#onNotification = options.onNotification;
  }

  /**
   * Returns a live connection to this server, starting it if necessary.
   *
   * Single-flight: two callers that arrive while a server is starting wait on
   * the same attempt and get the same connection. Two processes for one server
   * is the failure this guards, and it is the one that is hardest to see — both
   * work, so nothing looks wrong until something counts them.
   */
  async ensure(record: McpServerRecord): Promise<McpConnection> {
    const entry = this.#entryFor(record);

    if (entry.state.kind === "given-up") {
      // The message names the switch that fixes it, because the alternative is
      // a user retrying a call that this class has already decided never to
      // attempt again.
      throw new ExtendError("internal", {
        message:
          `${record.title} failed to start too many times and will not be tried again. ` +
          `Switch it off and on again to try once more.` +
          (entry.lastError === undefined ? "" : ` It last said: ${entry.lastError}`),
      });
    }

    const live = entry.connection;
    if (entry.state.kind === "ready" && live !== undefined && !live.closed) {
      return live;
    }

    return entry.starting ?? this.#beginStart(entry);
  }

  /**
   * What is true about a server right now, or `undefined` if it is not running.
   *
   * A server may have more than one process — the same program, started for two
   * projects with different roots — so this answers about the first one found.
   * `statuses()` is what a caller that needs all of them uses. Kept because
   * almost every caller has exactly one and asking it to know about keys would
   * be making them carry `C-18` for no benefit.
   */
  status(id: string): McpServerStatus | undefined {
    for (const entry of this.#entries.values()) {
      if (entry.record.id === id) return this.#statusOf(entry);
    }
    return undefined;
  }

  #statusOf(entry: Entry): McpServerStatus {
    return {
      id: entry.record.id,
      key: entry.key,
      state: entry.state.kind,
      attempts:
        entry.state.kind === "failed" || entry.state.kind === "given-up"
          ? entry.attempts
          : 0,
      ...(entry.session === undefined
        ? {}
        : {
            era: entry.session.era,
            protocolVersion: entry.session.protocolVersion,
          }),
      ...(entry.lastError === undefined ? {} : { lastError: entry.lastError }),
      diagnostics: entry.connection?.diagnostics ?? [],
    };
  }

  /** Every running process, one entry each. Two may share an id. */
  statuses(): readonly McpServerStatus[] {
    return [...this.#entries.values()].map((entry) => this.#statusOf(entry));
  }

  /**
   * Stops a server and forgets it.
   *
   * **Every process of that server**, because the caller is uninstalling it,
   * editing it, or switching it off — and none of those mean "the copy rooted in
   * one particular folder". A `stop` that left a sibling running would be a
   * server the user believes is gone.
   *
   * Forgetting is deliberate. A stopped server has no attempt count worth
   * keeping and no failure worth showing — the user turned it off, and
   * reporting last week's crash for something nobody is running is noise. It
   * also means a server that had given up gets a clean start when it is
   * switched back on, which is what a person switching it back on is asking
   * for.
   *
   * Safe from every state, including part-way through starting.
   */
  stop(id: string): Promise<void> {
    const exits: Promise<void>[] = [];
    for (const entry of [...this.#entries.values()]) {
      // `#stopEntry` answers undefined for an entry with nothing left to
      // wait on. Dropping those here keeps the aggregate below a list of
      // promises rather than a list that mostly is.
      const exit = entry.record.id === id ? this.#stopEntry(entry) : undefined;
      if (exit !== undefined) exits.push(exit);
    }
    // Awaitable for the same reason `stopAll` is: a stdio server runs in the
    // project directory, and a caller that disables one and then removes that
    // directory was racing a process that had only been *asked* to stop.
    return Promise.all(exits).then(() => undefined);
  }

  #stopEntry(entry: Entry): Promise<void> | undefined {
    this.#entries.delete(entry.key);
    // Before anything else: an attempt still in flight, and a close callback
    // from the connection we are about to end, both check this and stop.
    entry.generation += 1;

    if (entry.connection !== undefined) {
      this.#onUnavailable?.(
        entry.record,
        new ExtendError("cancelled", {
          message: `${entry.record.title} was stopped.`,
        }),
      );
    }

    if (entry.retryTimer !== undefined) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = undefined;
    }

    let exited: Promise<void> | undefined;
    if (entry.state.kind === "ready") {
      // Driven through the machine rather than assigned, so the transition it
      // exists to refuse — a `started` arriving after a stop — stays refused.
      this.#apply(entry, { kind: "stop" });
      const connection = entry.connection;
      connection?.close();
      exited = connection?.whenExited();
      this.#apply(entry, { kind: "stopped" });
    }

    entry.connection = undefined;
    entry.session = undefined;
    return exited;
  }

  /**
   * Stops every server and waits for the processes to be gone.
   *
   * Awaited rather than fire-and-forget: a stdio server runs in the project
   * directory, so a caller that tears that directory down next was racing a
   * live process. It surfaced on Windows as `EBUSY` and everywhere else as an
   * orphan nobody noticed.
   */
  async stopAll(): Promise<void> {
    const exits = [...this.#entries.values()]
      .map((entry) => this.#stopEntry(entry))
      // Same as `stop`: an entry with nothing left to wait on answers
      // undefined, and it does not belong in the aggregate.
      .filter((exit): exit is Promise<void> => exit !== undefined);
    await Promise.all(exits);
  }

  #entryFor(record: McpServerRecord): Entry {
    const key = this.#launch.key(record);
    const existing = this.#entries.get(key);
    if (existing !== undefined) return existing;

    const entry: Entry = {
      execution: undefined,
      record,
      state: { kind: "idle" },
      connection: undefined,
      session: undefined,
      starting: undefined,
      retryTimer: undefined,
      lastError: undefined,
      attempts: 0,
      generation: 0,
      key,
    };
    this.#entries.set(key, entry);
    return entry;
  }

  /**
   * Runs the state machine and refuses to continue when it says no.
   *
   * An illegal transition here is our bug, not a server's, so it is raised
   * rather than returned — the state machine's whole value is that a wrong
   * sequence stops immediately instead of producing a second process.
   */
  #apply(entry: Entry, event: LifecycleEvent): void {
    const result = transition(entry.state, event);
    if (!result.ok) {
      throw new ExtendError("internal", { message: result.reason });
    }
    entry.state = result.state;
  }

  #beginStart(entry: Entry): Promise<McpConnection> {
    this.#apply(entry, { kind: "start" });
    entry.generation += 1;
    const parent = currentExecutionContext();
    entry.execution = entry.execution === undefined
      ? parent ? createChildExecutionContext(parent, { kind: "mcp" }) : createRootExecutionContext({ kind: "mcp" })
      : createRetryExecutionContext(entry.execution);

    const started: Promise<McpConnection> = runWithExecutionContext(entry.execution, async () => {
      const record = createObservationWriter();
      const began = performance.now();
      const attributes = { serverId: entry.record.id, generation: entry.generation };
      record({ name: "mcp.start", phase: "start", attributes });
      try {
        const connection = await this.#bringUp(entry, entry.generation);
        record({ name: "mcp.start", phase: "end", outcome: "completed",
          attributes: { ...attributes, connectionId: connection.connectionId, durationMs: performance.now() - began } });
        return connection;
      } catch (error) {
        const failure = observationFailure(error);
        record({ name: "mcp.start", phase: "end", outcome: failure.cancelled ? "cancelled" : "failed",
          attributes: { ...attributes, errorCode: failure.errorCode, durationMs: performance.now() - began } });
        throw error;
      }
      // Cleared however the attempt ends, and only if it is still the current
      // one. Written as a link in the returned chain, because an attempt that
      // fails synchronously would otherwise clear the field before it was set.
    }).finally(() => {
      if (entry.starting === started) entry.starting = undefined;
    });

    entry.starting = started;
    return started;
  }

  async #bringUp(entry: Entry, generation: number): Promise<McpConnection> {
    /**
     * Held out here so the failure path can end it.
     *
     * A handshake can fail while the process is perfectly healthy — a protocol
     * we do not speak is the ordinary case — and that process is running, has
     * our stdin, and will not exit on its own. Closing only on the paths that
     * happen to notice would leave one behind for exactly the failure most
     * likely to happen on a machine with an old server installed.
     */
    let started: { close(): void } | undefined;

    try {
      const channel = await this.#launch.open(entry.record);
      started = channel;

      // Stopped while the process was spawning. The process exists and has to
      // be ended by whoever created it, which is here.
      if (entry.generation !== generation) {
        throw new ExtendError("cancelled", {
          message: `${entry.record.title} was switched off while it was starting.`,
        });
      }

      const connection = new McpConnection(channel, { ...this.#connectionOptions, serverId: entry.record.id });
      // From here the connection owns the channel: closing it closes both, and
      // closing the channel underneath it would leave the connection believing
      // it is alive.
      started = connection;

      const session = await handshake(connection);

      if (entry.generation !== generation) {
        throw new ExtendError("cancelled", {
          message: `${entry.record.title} was switched off while it was starting.`,
        });
      }

      started = undefined;
      entry.connection = connection;
      entry.session = session;
      entry.lastError = undefined;
      this.#apply(entry, { kind: "started" });

      // Registered after the state says ready, so a server that dies in the
      // same tick is handled as a running server that died rather than as a
      // start that never finished — the second would leave the attempt count
      // where it was and retry forever.
      connection.onClose((reason) => this.#connectionEnded(entry, generation, reason));
      connection.onNotification((method, params) => {
        this.#onNotification?.(entry.record, method, params);
      });

      await this.#onReady?.(entry.record, connection);
      if (entry.generation !== generation || entry.state.kind !== "ready") {
        throw new ExtendError("cancelled", {
          message: `${entry.record.title} stopped while its catalog was refreshing.`,
        });
      }

      return connection;
    } catch (error) {
      started?.close();
      if (entry.generation === generation) {
        entry.lastError = describe(error);
        if (entry.state.kind !== "failed" && entry.state.kind !== "given-up") {
          this.#failed(entry);
        }
      }
      throw error;
    }
  }

  /**
   * A connection that was ready is not any more.
   *
   * Only a `ready` server reaches here. A death during startup is already the
   * business of the attempt that is running, and letting both react would count
   * one failure twice and halve the retries a server actually gets.
   */
  #connectionEnded(entry: Entry, generation: number, reason: unknown): void {
    if (entry.generation !== generation) return;
    if (entry.state.kind !== "ready") return;

    entry.lastError = describe(reason);
    this.#onUnavailable?.(entry.record, reason);
    this.#failed(entry);
  }

  /**
   * Records a failure and decides whether there will be another attempt.
   *
   * The retry is scheduled rather than awaited. A caller waiting on `ensure`
   * gets its failure now, with the reason, instead of after every retry has
   * been exhausted; the next caller finds a server that has quietly recovered.
   */
  #failed(entry: Entry): void {
    // Nothing is closed here, because on both paths that reach this the
    // connection is already closed: a start that failed closed what it built,
    // and a connection reports its end only after ending. Closing again would
    // be the one call that could re-enter this method, and a second `failed`
    // from a state that has already recorded one is an illegal transition.
    entry.connection = undefined;
    entry.session = undefined;
    this.#apply(entry, { kind: "failed" });
    if (entry.state.kind === "failed") entry.attempts = entry.state.attempts;

    if (entry.state.kind !== "failed") return;

    // `attempts` counts failed starts, and `getBackoffDelay` counts retries
    // already made — one fewer, because the first failure has not been retried
    // yet. Passing the wrong one of the two shifts every delay by a step and
    // costs a retry, which is exactly the kind of mistake nothing would notice.
    const decision = getBackoffDelay(entry.state.attempts - 1, this.#backoff);

    if (decision.kind === "give-up") {
      this.#apply(entry, { kind: "giveUp" });
      return;
    }

    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = undefined;
      if (this.#entries.get(entry.key) !== entry || entry.state.kind !== "failed") return;
      // Nobody is waiting on this one, so its failure is recorded by the
      // attempt itself and swallowed here. Rethrowing would take down the
      // process for a server that is allowed to be broken.
      void this.#beginStart(entry).catch(() => undefined);
    }, decision.delayMs);

    // A retry for a server nobody has asked about must not hold the process
    // open when everything else has finished.
    entry.retryTimer.unref?.();
  }
}
