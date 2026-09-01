/**
 * The wire shapes, and nothing else.
 *
 * A browser importing `@pookiepied/core` would drag in `withAuth` and `OwnedDb`,
 * which reference `ExecutionContext` and `D1Database` — types that only exist in
 * a Workers tsconfig. That is not a packaging inconvenience; it is the boundary
 * being stated correctly: a client may depend on what the API *says*, never on
 * how the worker implements it.
 */
export type { AuthService, Identity, Role, Session, User, UserStatus } from "./types.js";
export type { CheckKind, HealthCheck, HealthReport, HealthStatus, ProbeResult } from "./health.js";
