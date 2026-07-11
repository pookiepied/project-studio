import {
  RUNTIME_PROTOCOL_VERSION,
  type AnyRuntimeEvent,
  type ApprovalRequest,
  type OperationRecord,
  type RunCheckpoint,
  type RunState,
  type RunStatus,
  type RuntimeEvent,
  type RuntimeEventPayloads,
  type RuntimeEventType,
} from "@studio/v2-contracts";
import { ACTIVE_STATUSES } from "../agent/lifecycle";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The identity fields every appended event is stamped with. */
export interface EventScope {
  conversationId: string;
  runId: string;
  turnId: string;
}

/**
 * Durable storage layer inside the ExecutionSession DO, backed by DO SQLite.
 * The append-only event log is the source of truth (decision #10); the runs
 * table holds the current RunState projection for fast reads, and checkpoints
 * accelerate replay. Events are written here BEFORE any client broadcast.
 */

export class SessionStore {
  constructor(private readonly sql: SqlStorage) {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_run ON events (run_id, seq);
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        next_step INTEGER NOT NULL,
        messages_hash TEXT NOT NULL,
        completed_tool_ids TEXT NOT NULL,
        pending_tool_ids TEXT NOT NULL,
        active_approval_id TEXT,
        partial_text TEXT,
        messages TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_run ON checkpoints (run_id, version);
      CREATE TABLE IF NOT EXISTS submissions (
        idempotency_key TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operations (
        operation_key TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS approvals (
        approval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        summarized_action TEXT NOT NULL,
        normalized_input TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        status TEXT NOT NULL,
        resolved_by TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals (run_id, status);
      CREATE TABLE IF NOT EXISTS tool_signatures (
        run_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        count INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (run_id, tool_name, input_hash)
      );
      CREATE TABLE IF NOT EXISTS external_tool_calls (
        tool_call_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, server_id TEXT NOT NULL,
        tool_name TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL,
        result TEXT, error TEXT, created_at TEXT NOT NULL, resolved_at TEXT
      );
    `);
  }

  saveExternalCall(runId:string,toolCallId:string,serverId:string,toolName:string,input:unknown):void {
    this.sql.exec(`INSERT INTO external_tool_calls(tool_call_id,run_id,server_id,tool_name,input,status,created_at) VALUES(?,?,?,?,?,'pending',?) ON CONFLICT(tool_call_id) DO NOTHING`,toolCallId,runId,serverId,toolName,JSON.stringify(input),new Date().toISOString());
  }

  loadExternalCall(toolCallId:string):{status:string;result?:unknown;error?:string}|null {
    const rows=this.sql.exec("SELECT status,result,error FROM external_tool_calls WHERE tool_call_id=?",toolCallId).toArray();
    if(!rows.length)return null;return {status:String(rows[0].status),result:rows[0].result?JSON.parse(String(rows[0].result)):undefined,error:rows[0].error?String(rows[0].error):undefined};
  }

  resolveExternalCall(toolCallId:string,result:unknown,error?:string):void {
    this.sql.exec("UPDATE external_tool_calls SET status=?,result=?,error=?,resolved_at=? WHERE tool_call_id=?",error?"failed":"completed",result===undefined?null:JSON.stringify(result),error??null,new Date().toISOString(),toolCallId);
  }

  appendEvent<T extends RuntimeEventType>(
    scope: EventScope,
    type: T,
    payload: RuntimeEventPayloads[T],
  ): RuntimeEvent<T> {
    const eventId = crypto.randomUUID();
    const timestamp = Date.now();
    this.sql.exec(
      `INSERT INTO events (event_id, conversation_id, run_id, turn_id, ts, type, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      eventId,
      scope.conversationId,
      scope.runId,
      scope.turnId,
      timestamp,
      type,
      JSON.stringify(payload),
    );
    const row = this.sql
      .exec("SELECT last_insert_rowid() AS seq")
      .one() as { seq: number };
    return {
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      eventId,
      conversationId: scope.conversationId,
      runId: scope.runId,
      turnId: scope.turnId,
      sequence: row.seq,
      timestamp,
      type,
      payload,
    };
  }

  eventsSince(afterSeq: number, limit = 500): AnyRuntimeEvent[] {
    return this.sql
      .exec(
        `SELECT seq, event_id, conversation_id, run_id, turn_id, ts, type, payload
         FROM events WHERE seq > ? ORDER BY seq LIMIT ?`,
        afterSeq,
        limit,
      )
      .toArray()
      .map(
        (r) =>
          ({
            protocolVersion: RUNTIME_PROTOCOL_VERSION,
            eventId: r.event_id as string,
            conversationId: r.conversation_id as string,
            runId: r.run_id as string,
            turnId: r.turn_id as string,
            sequence: r.seq as number,
            timestamp: r.ts as number,
            type: r.type as RuntimeEventType,
            payload: JSON.parse(r.payload as string),
          }) as AnyRuntimeEvent,
      );
  }

  /** Highest sequence in the log (0 when empty) — sent with snapshots. */
  latestSequence(): number {
    const row = this.sql
      .exec("SELECT COALESCE(MAX(seq), 0) AS seq FROM events")
      .one() as { seq: number };
    return row.seq;
  }

  saveRun(run: RunState): void {
    this.sql.exec(
      `INSERT INTO runs (run_id, status, state, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (run_id) DO UPDATE SET status = excluded.status,
         state = excluded.state, updated_at = excluded.updated_at`,
      run.runId,
      run.status,
      JSON.stringify(run),
      new Date().toISOString(),
    );
  }

  loadRun(runId: string): RunState | null {
    const rows = this.sql
      .exec("SELECT state FROM runs WHERE run_id = ?", runId)
      .toArray();
    return rows.length ? (JSON.parse(rows[0].state as string) as RunState) : null;
  }

  /** The single run currently in a non-terminal status, if any. */
  activeRun(): RunState | null {
    const placeholders = ACTIVE_STATUSES.map(() => "?").join(", ");
    const rows = this.sql
      .exec(
        `SELECT state FROM runs WHERE status IN (${placeholders}) LIMIT 1`,
        ...ACTIVE_STATUSES,
      )
      .toArray();
    return rows.length ? (JSON.parse(rows[0].state as string) as RunState) : null;
  }

  // ── idempotent side effects (RUNTIME-CHECKLIST.md §8) ──────────────────

  /**
   * Atomically reserve an operation before executing it. Returns the record
   * that owns the key: status "reserved" with a fresh createdAt means this
   * caller won and must execute; "completed" means a previous attempt already
   * ran it and `result` can be returned without repeating the side effect.
   */
  reserveOperation(runId: string, toolCallId: string): OperationRecord {
    const operationKey = `${runId}:${toolCallId}`;
    const now = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO operations (operation_key, run_id, tool_call_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'reserved', ?, ?) ON CONFLICT (operation_key) DO NOTHING`,
      operationKey,
      runId,
      toolCallId,
      now,
      now,
    );
    return this.loadOperation(operationKey)!;
  }

  markOperation(
    operationKey: string,
    status: "executing" | "completed" | "failed",
    result?: string,
  ): void {
    this.sql.exec(
      "UPDATE operations SET status = ?, result = ?, updated_at = ? WHERE operation_key = ?",
      status,
      result ?? null,
      new Date().toISOString(),
      operationKey,
    );
  }

  loadOperation(operationKey: string): OperationRecord | null {
    const rows = this.sql
      .exec("SELECT * FROM operations WHERE operation_key = ?", operationKey)
      .toArray();
    if (!rows.length) return null;
    const r = rows[0];
    return {
      operationKey: r.operation_key as string,
      runId: r.run_id as string,
      toolCallId: r.tool_call_id as string,
      status: r.status as OperationRecord["status"],
      result: (r.result as string | null) ?? undefined,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  /**
   * Count repeated calls to the same tool with the same normalized input.
   * Enforcement is optional and configured per run; recording also gives us
   * diagnostics without imposing a hard cap.
   */
  recordToolSignature(runId: string, toolName: string, normalizedInput: string): number {
    const now = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO tool_signatures (run_id, tool_name, input_hash, count, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (run_id, tool_name, input_hash)
       DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`,
      runId,
      toolName,
      normalizedInput,
      now,
    );
    const row = this.sql
      .exec(
        `SELECT count FROM tool_signatures
         WHERE run_id = ? AND tool_name = ? AND input_hash = ?`,
        runId,
        toolName,
        normalizedInput,
      )
      .one() as { count: number };
    return row.count;
  }

  // ── approvals (RUNTIME-CHECKLIST.md §9) ────────────────────────────────

  saveApproval(approval: ApprovalRequest): void {
    this.sql.exec(
      `INSERT INTO approvals (approval_id, run_id, tool_call_id, tool_name,
         summarized_action, normalized_input, risk_level, status, resolved_by,
         expires_at, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (approval_id) DO UPDATE SET status = excluded.status,
         resolved_by = excluded.resolved_by, resolved_at = excluded.resolved_at`,
      approval.approvalId,
      approval.runId,
      approval.toolCallId,
      approval.toolName,
      approval.summarizedAction,
      JSON.stringify(approval.normalizedInput),
      approval.riskLevel,
      approval.status,
      approval.resolvedBy ?? null,
      approval.expiresAt ?? null,
      approval.createdAt,
      approval.resolvedAt ?? null,
    );
  }

  loadApproval(approvalId: string): ApprovalRequest | null {
    const rows = this.sql
      .exec("SELECT * FROM approvals WHERE approval_id = ?", approvalId)
      .toArray();
    if (!rows.length) return null;
    const r = rows[0];
    return {
      approvalId: r.approval_id as string,
      runId: r.run_id as string,
      toolCallId: r.tool_call_id as string,
      toolName: r.tool_name as string,
      summarizedAction: r.summarized_action as string,
      normalizedInput: JSON.parse(r.normalized_input as string),
      riskLevel: r.risk_level as ApprovalRequest["riskLevel"],
      status: r.status as ApprovalRequest["status"],
      resolvedBy: (r.resolved_by as string | null) ?? undefined,
      expiresAt: (r.expires_at as string | null) ?? undefined,
      createdAt: r.created_at as string,
      resolvedAt: (r.resolved_at as string | null) ?? undefined,
    };
  }

  /**
   * Duplicate-submission guard (RUNTIME-CHECKLIST.md §2): atomically claim an
   * idempotency key for a run. Returns the run id that owns the key — the new
   * one if the claim won, or the earlier run's id if this is a duplicate send.
   */
  claimSubmission(idempotencyKey: string, runId: string): string {
    this.sql.exec(
      `INSERT INTO submissions (idempotency_key, run_id, created_at)
       VALUES (?, ?, ?) ON CONFLICT (idempotency_key) DO NOTHING`,
      idempotencyKey,
      runId,
      new Date().toISOString(),
    );
    const row = this.sql
      .exec("SELECT run_id FROM submissions WHERE idempotency_key = ?", idempotencyKey)
      .one() as { run_id: string };
    return row.run_id;
  }

  async saveCheckpoint(
    runId: string,
    data: {
      status: RunStatus;
      nextStepNumber: number;
      completedToolCallIds: string[];
      pendingToolCallIds: string[];
      activeApprovalId?: string;
      partialAssistantText?: string;
    },
    messagesJson: string,
  ): Promise<RunCheckpoint> {
    const version = this.nextCheckpointVersion(runId);
    const checkpoint: RunCheckpoint = {
      checkpointId: crypto.randomUUID(),
      runId,
      version,
      status: data.status,
      nextStepNumber: data.nextStepNumber,
      modelMessagesHash: await sha256(messagesJson),
      completedToolCallIds: data.completedToolCallIds,
      pendingToolCallIds: data.pendingToolCallIds,
      activeApprovalId: data.activeApprovalId,
      partialAssistantText: data.partialAssistantText,
      createdAt: new Date().toISOString(),
    };
    this.sql.exec(
      `INSERT INTO checkpoints (checkpoint_id, run_id, version, status, next_step,
         messages_hash, completed_tool_ids, pending_tool_ids, active_approval_id,
         partial_text, messages, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      checkpoint.checkpointId,
      runId,
      version,
      checkpoint.status,
      checkpoint.nextStepNumber,
      checkpoint.modelMessagesHash,
      JSON.stringify(checkpoint.completedToolCallIds),
      JSON.stringify(checkpoint.pendingToolCallIds),
      checkpoint.activeApprovalId ?? null,
      checkpoint.partialAssistantText ?? null,
      messagesJson,
      checkpoint.createdAt,
    );
    return checkpoint;
  }

  private nextCheckpointVersion(runId: string): number {
    const row = this.sql
      .exec(
        "SELECT COALESCE(MAX(version), 0) AS v FROM checkpoints WHERE run_id = ?",
        runId,
      )
      .one() as { v: number };
    return row.v + 1;
  }

  latestCheckpoint(
    runId: string,
  ): { checkpoint: RunCheckpoint; messagesJson: string } | null {
    const rows = this.sql
      .exec(
        `SELECT checkpoint_id, version, status, next_step, messages_hash,
           completed_tool_ids, pending_tool_ids, active_approval_id, partial_text,
           messages, created_at
         FROM checkpoints WHERE run_id = ? ORDER BY version DESC LIMIT 1`,
        runId,
      )
      .toArray();
    if (!rows.length) return null;
    const r = rows[0];
    return {
      checkpoint: {
        checkpointId: r.checkpoint_id as string,
        runId,
        version: r.version as number,
        status: r.status as RunStatus,
        nextStepNumber: r.next_step as number,
        modelMessagesHash: r.messages_hash as string,
        completedToolCallIds: JSON.parse(r.completed_tool_ids as string),
        pendingToolCallIds: JSON.parse(r.pending_tool_ids as string),
        activeApprovalId: (r.active_approval_id as string | null) ?? undefined,
        partialAssistantText: (r.partial_text as string | null) ?? undefined,
        createdAt: r.created_at as string,
      },
      messagesJson: r.messages as string,
    };
  }
}
