# ADR 0035 — Runtime composition, ports, and ownership

**Status:** Accepted · 2026-08-15
**Supersedes:** [0034](0034-modular-monolith-exception.md) — the modular-monolith
exception. 0034 kept its text; this states what actually holds.

## Context

`StudioRuntime` publishes ten repositories, reads a process-global database,
closes a connection it does not own, and is handed whole to two consumers. ADR
0034 recorded an exception permitting this so the 008.3 gate could be recorded
closed. The exception was taken instead of the fix.

Before deciding, the actual consumers were counted rather than assumed. Across
`src/` and `tests/`, on the ten public members:

| Member | External consumers | Where |
|---|---|---|
| `management` | 9 | `transport/http/routes/mcp.ts` |
| `registry` | 3 | `transport/http/routes/mcp.ts` |
| `supervisor` | 1 | `transport/http/routes/mcp.ts` (`statusOf`) |
| `trust` | 1 | `tests/integration/mcp-runtime.test.ts` — **no `src/` consumer** |
| `db`, `grants`, `selection`, `inventory`, `extensions`, `catalog` | **0** | — |

`StudioRuntime` is instantiated exactly twice: `src/app.ts:57` and one test.

This changes the shape of the problem. Six members are internal wiring that was
never consumed; three serve one route module; one serves only a test. The god
object is not load-bearing — it is unenclosed.

## Decision

### 1. Six members become private, unchanged

`db`, `grants`, `selection`, `inventory`, `extensions`, `catalog` have no
consumer outside the class. They become `#private`. No caller changes.

### 2. The MCP HTTP surface depends on a port, not the runtime

`routes/mcp.ts` needs seven operations. It currently reaches three members and
composes `registry.get` with `supervisor.status` itself, in a route-local
`statusOf` helper — a domain composition living in the transport layer.

That composition moves into `McpManagementService`, which gains `list()` and
`get(id)` returning record-with-status. The route then depends on one interface:

```ts
export interface McpAdministration {
  list(): readonly McpServerView[];
  get(id: string): McpServerView | undefined;
  save(input: McpServerInput, auth: AuthContext): McpServerView;
  remove(id: string, auth: AuthContext): Promise<boolean>;
  setEnabled(projectId: string, id: string, enabled: boolean, auth: AuthContext): void;
  setCredential(id: string, secret: string, auth: AuthContext): Promise<void>;
  deleteCredential(id: string, auth: AuthContext): Promise<void>;
}
```

`createMcpRoutes` takes an `McpAdministration`. `registry` and `supervisor`
become private. `trust` becomes private and the one test uses a constructor
option instead of reaching in.

**All ten members are then private, and the whitelist is empty** — not shrunk.

### 3. The database is injected; the process globals are deleted

`StudioRuntime` takes `database: StudioDatabase` as a required option.
`getDatabase()` and `closeDatabase()` are **deleted**, not deprecated.

Three call sites move to explicit ownership:

- `app.ts` — opens the database once with `openDatabase()`, passes it to
  `bootstrapModelProviders` and to `StudioRuntime`, and closes it in `shutdown`.
- `models/bootstrap.ts:149` — takes the database as a parameter.
- `models/local/cli.ts` — a separate entry point and therefore a separate
  composition root; it opens and closes its own connection.

### 4. One owner closes the connection

`StudioRuntime.stop()` no longer calls `closeDatabase()`. It did not open the
connection and must not close it. `app.ts` is the sole owner.

`stop()` also becomes `async` and awaits child-process exit. It currently
returns while spawned MCP servers are still alive; see §Consequences.

### 5. `app_setting` gets one owning repository

`models/local/settings-store.ts` and `retrieval/settings.ts` both write the
table directly. A single `storage/app-settings.ts` owns it, exposing typed key
namespaces; both become consumers. The table-ownership test then passes with no
exception.

### 6. The agent service locator stays, narrowed and documented

`agents/studio.ts` is default-exported to Flue's `defineAgent` and loaded by
Flue's own module resolution. **There is no injection point** — that is why
`getStudioRuntime()` exists, and removing it is not possible without changing
how Flue loads agents.

It stays, with two constraints: the locator returns an `AgentHost` port
(`start`, `reconcile`, `projectRoot`, `createAgentSandbox`) rather than the
concrete class, and it has exactly one call site, asserted by an architecture
test.

Recording a framework boundary honestly is better than a wrapper that hides a
global while still being one.

## Consequences

- The 008.3 gate closes with every whitelist empty.
- `stop()` becoming async fixes a real defect, not only a test failure: the
  Harness returns from shutdown while MCP child processes are still running. On
  Windows this surfaces as `EBUSY` removing a directory that is a live child's
  `cwd`; on any platform it is an orphaned-process leak.
- `app.ts` grows: it becomes the honest composition root, holding the database,
  the runtime, observability, and admission. That is where the growth belongs.
- The `trust` test reaching into the runtime must change. It is one line.

## What is not decided here

Whether `PermissionApprovalBroker` takes a durable repository — meta-task
decision #16. If it does, it gains a constructor argument supplied by the same
composition root. The shape above is unaffected either way.
