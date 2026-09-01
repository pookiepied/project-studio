import type { HealthReport, HealthStatus, Role, User } from "@pookiepied/core/contracts";

export interface ServiceHealth extends HealthReport {
  origin: "live" | "heartbeat";
  ageSeconds: number;
}

export interface HealthPayload {
  status: HealthStatus;
  services: ServiceHealth[];
  checkedAt: number;
}

export interface SourceSummary {
  source: string;
  requests: number;
  errors: number;
  p50_ms: number;
  p95_ms: number;
}

export interface ActivityEvent {
  ts: string;
  source: string;
  event: string;
  path: string;
  outcome: string;
  status: number;
  duration_ms: number;
  fields: string;
}

export interface AuditEvent {
  id: string;
  actor_id: string | null;
  action: string;
  target: string | null;
  meta_json: string | null;
  created_at: number;
}

export interface SessionRow {
  id: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  ip: string | null;
  ua: string | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `${path} → ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  session: () => get<{ email: string }>("/api/session"),
  health: () => get<HealthPayload>("/api/health"),
  summary: (hours: number) =>
    get<{ hours: number; sources: SourceSummary[] }>(`/api/summary?hours=${hours}`),
  facets: (hours: number) =>
    get<{ sources: { source: string; n: number }[]; events: { event: string; n: number }[] }>(
      `/api/facets?hours=${hours}`,
    ),
  activity: (params: { hours: number; source?: string; event?: string; errorsOnly?: boolean }) => {
    const q = new URLSearchParams({ hours: String(params.hours), limit: "200" });
    if (params.source) q.set("source", params.source);
    if (params.event) q.set("event", params.event);
    if (params.errorsOnly) q.set("only", "errors");
    return get<{ hours: number; events: ActivityEvent[] }>(`/api/activity?${q}`);
  },
  users: () => get<{ users: User[] }>("/api/users"),
  audit: () => get<{ events: AuditEvent[] }>("/api/audit"),
  sessions: (userId: string) =>
    get<{ sessions: SessionRow[] }>(`/api/sessions?user_id=${encodeURIComponent(userId)}`),
  invite: (email: string, role: Role) => post<{ user: User }>("/api/users/invite", { email, role }),
  setStatus: (userId: string, status: "active" | "disabled") =>
    post<{ ok: true }>("/api/users/status", { user_id: userId, status }),
  setRole: (userId: string, role: Role) =>
    post<{ ok: true }>("/api/users/role", { user_id: userId, role }),
  revokeSession: (sessionId: string) =>
    post<{ revoked: boolean }>("/api/sessions/revoke", { session_id: sessionId }),
};
