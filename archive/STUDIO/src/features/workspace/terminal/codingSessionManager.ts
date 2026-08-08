export type CodingSessionRuntime = "local" | "cloud";
export type CodingSessionStatus = "starting" | "active" | "idle" | "exited";

export interface CodingSessionRecord {
  id: string;
  runtime: CodingSessionRuntime;
  kind: "terminal" | "opencode" | "coding-agent" | "cli-bridge";
  cwd: string | null;
  status: CodingSessionStatus;
  createdAt: number;
  lastActiveAt: number;
}

export const MAX_ACTIVE_LOCAL_SESSIONS = 6;
export const MAX_ACTIVE_CLOUD_SESSIONS = 4;

class CodingSessionManager {
  private sessions = new Map<string, CodingSessionRecord>();

  acquire(record: Omit<CodingSessionRecord, "createdAt" | "lastActiveAt">): CodingSessionRecord {
    const limit = record.runtime === "local" ? MAX_ACTIVE_LOCAL_SESSIONS : MAX_ACTIVE_CLOUD_SESSIONS;
    const activeCount = [...this.sessions.values()].filter(session => session.runtime === record.runtime && session.status !== "exited").length;
    if (activeCount >= limit) {
      throw new Error(`Studio allows up to ${limit} active ${record.runtime} coding sessions. Close an existing session and try again.`);
    }
    const now = Date.now();
    const session = { ...record, createdAt: now, lastActiveAt: now };
    this.sessions.set(session.id, session);
    return session;
  }

  update(id: string, status: CodingSessionStatus): void {
    const session = this.sessions.get(id);
    if (session) this.sessions.set(id, { ...session, status, lastActiveAt: Date.now() });
  }

  release(id: string): void {
    this.sessions.delete(id);
  }

  list(): CodingSessionRecord[] {
    return [...this.sessions.values()];
  }
}

export const codingSessionManager = new CodingSessionManager();
