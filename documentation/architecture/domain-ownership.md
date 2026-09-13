# Domain Ownership Matrix — Task 008.3 (ex-008.48)

> **SEQ start gate — C-01 / C-08.** One Harness process composing domain subsystems. Each subsystem owns its rules, state, repository, invariants and lifecycle. One database *file* is acceptable; cross-domain *raw table* access is not. New behaviour crosses domains via a typed port / event / application service.

### Durable vs process-local classification

| Owner | What | Primary location | Handle |
|---|---|---|---|
| **Flue** | transcript, submissions, run/durability state | `~/.studio/data/flue.db` (`src/platform/paths.ts:110`, `src/db.ts:25`) | opaque via `sqlite` from `@flue/runtime/node` (`src/db.ts:3`); no exposed `DatabaseSync` |
| **App (Studio)** | registries, grants, trust, project selections, model settings | `~/.studio/data/studio.db` (`src/platform/paths.ts:96`, `src/storage/database.ts:57`) | `StudioDatabase { handle: DatabaseSync }` (`src/storage/database.ts:30`) — **must be hidden behind repositories** |
| **OS keychain** | all secrets | Win Credential Manager / macOS Keychain / Linux Secret Service via `@napi-rs/keyring` (`src/credentials/keyring-store.ts:1`) | `SecureCredentialStore` (`src/credentials/credential-store.ts:96`); service `Project Studio` (`src/credentials/keyring-store.ts:17`) |
| **Filesystem** | undo history | `~/.studio/data/snapshots/<projectKey>/` shadow git (`src/platform/paths.ts:130`, `src/snapshots/store.ts:59`) | no table — git log is the record |
| **Process-local** | admission credential, approval queue, MCP connections, sandbox instance, gate, execution context, logger handle | heap / `node:sqlite` `:memory:` in tests | `AdmissionCredential` (`src/admission/credential.ts:11`), `PendingRequests` etc. |

Enforcement: `assertNoSecretColumns` runs inside every migration txn **and** on every `openDatabase` (`src/storage/migrations.ts:340,392,415`, `src/storage/database.ts:106`). `SECRET_WORDS` / `NOT_SECRET_COLUMNS` (`src/storage/migrations.ts:269,290`). `PROJECT_STUDIO_DB_PATH` / `PROJECT_STUDIO_STORE_PATH` overrides go through `resolveConfigured` — relative is relative to `~/.studio`, `..` is refused (`src/platform/paths.ts:194`).

---

## Approved Composition Roots

> **Rule:** Only the roots below may construct cross-domain infrastructure (`StudioDatabase`, `SecureCredentialStore`, `McpSupervisor`, etc.). Domain modules (e.g., `src/models/bootstrap.ts`, `src/permissions/*`, `src/tools/*`) must receive dependencies via constructor/port, not via `getDatabase()` or `new KeyringCredentialStore()` inside business logic. This is enforced by `tests/unit/architecture.test.ts` (new 008.3).

| Root | File | May construct | Must not |
|---|---|---|---|
| **Harness process startup** | `STUDIO HARNESS/src/app.ts:28` `createHarnessApplication()` | `StudioRuntime`, `PermissionApprovalBroker`, `AdmissionSession`, `Observability`, `Flue` turn boundary | — |
| **Host / client startup** | `STUDIO HARNESS/src/host/harness-launcher.ts:77` `launchHarness`, `STUDIO/src-tauri/src/harness/supervisor.rs:50` `HarnessSupervisor::spawn_child`, `STUDIO/src/platform/harness/client.ts:33` `createHarnessClient` | Child process, FD 3/4, endpoint, token | Must not touch `studio.db` tables |
| **CLI entrypoints** | `STUDIO HARNESS/src/models/local/cli.ts:8`, `src/auth/cli.ts:8` | `ProviderSettingsStore(getDatabase())` for that CLI only, `KeyringCredentialStore` for that command | Must not be imported by `src/agents/*` or `src/tools/*` |
| **Test factories** | `tests/unit/*`, `tests/integration/*` | `openDatabase({path:":memory:"})`, `InMemoryCredentialStore`, `ScriptedChannel` | Must not use `getDatabase()` singleton in assertions |

Domain modules that need `StudioDatabase` or `SecureCredentialStore` receive them via `StudioRuntime` constructor or `createAgentSandbox` factory, never by calling `getDatabase()` directly. There is no exception to this: `getDatabase()` no longer exists. This sentence used to name `src/models/bootstrap.ts:149` `new ProviderSettingsStore(getDatabase())` as "the **last** allowed direct call outside roots", to be moved in `008.3-04`. It was never moved — the accessor itself was **deleted** under meta-task #24 (`f25d715`), which removed the exception rather than relocating it. The only surviving mention in `src/` is the tombstone comment at `storage/database.ts:207`. Corrected under meta-task #38: the rule was describing a carve-out for a function that no longer exists.

---

## 1 — admission

| Aspect | Detail |
|---|---|
| **Logic** | Inbound Harness-client authentication. `createAdmissionCredential` (`src/admission/credential.ts:19`, 32 random bytes base64url), `createAdmissionVerifier` constant-time compare (`src/admission/verifier.ts:52`), `Bearer` extraction (`src/admission/verifier.ts:60`), `invalidate()` (`src/admission/verifier.ts:99`). Global middleware `createAdmissionMiddleware` (`src/transport/http/middleware/admission.ts:34`) + scope guard `requireAdmissionScope` (`src/transport/http/middleware/admission.ts:53`). Types `AuthContext` (`src/admission/context.ts`), scopes `ALL_ADMISSION_SCOPES` (`src/admission/scopes.ts`). |
| **State** | **Process-local only.** One `AdmissionCredential` + frozen `AuthContext` per launch. `credential` is memory-only, never logged/persisted (`src/admission/verifier.ts:126` redacts in launcher). |
| **Invariants** | One verifier protects Flue + MCP + permissions + future APIs (ADR 0028). Loopback-only listener `PROJECT_STUDIO_HARNESS_HOSTNAME=127.0.0.1` + `PORT=0` (`src/host/harness-launcher.ts:91`). Per-launch generation, private bootstrap via **FD 4** (`src/host/harness-launcher.ts:12,125`), readiness via **FD 3** (`src/host/harness-launcher.ts:11,133`). Expired token → `401` or `expired`; stale client must re-launch for new endpoint (`src/admission/verifier.ts:83`). `timingSafeEqual` on SHA-256 digests for length hiding. |
| **Tables** | **none** — `studio.db: none`, `flue.db: none`. Admission token must never enter either DB (checked by `008.4` migration proof). |
| **Credential scopes** | **none** — not `SecureCredentialStore`. Separate from keychain entirely. |
| **Filesystem** | none. Bootstrap channel is an FD, not a file/env/argv/log/DB (`src/host/harness-launcher.ts:95` deletes env var before spawn). |
| **Lifecycle** | **Created:** `launchHarness` → `createAdmissionSession` (`src/host/harness-launcher.ts:82`) or `app.ts:42` from env; **Owned by:** Harness process; **Destroyed:** `verifier.invalidate()` on `shutdown` (`src/app.ts:90,105`) + process exit. Rotated on every restart. |
| **Refs** | `src/admission/credential.ts:1`, `src/admission/verifier.ts:75`, `src/host/harness-launcher.ts:77`, `src/transport/http/create-app.ts:27` |

## 2 — application / runtime

| Aspect | Detail |
|---|---|
| **Logic** | Central composition. `StudioRuntime` (`src/application/studio-runtime.ts:123`) wires DB, `PermissionGrantStore`, `WorkspaceTrustStore`, `ExtensionSelectionStore`, `ExtensionInventory`/`ExtensionReconciler`, `McpServerRegistry`, `McpSupervisor`, `McpCapabilityCatalog`, `McpManagementService`, per-turn `CallGate`+`PermissionKernel`+`LocalSandbox`+`TurnSnapshots`. `createAgentSandbox` → `SandboxFactory` (`src/application/studio-runtime.ts:231`). Global singleton helpers `configureStudioRuntime`/`getStudioRuntime` (`src/application/studio-runtime.ts:357,366`). |
| **State** | **Process-local orchestrator + durable handles.** Holds `StudioDatabase` handle and all domain stores in public `readonly` fields (`src/application/studio-runtime.ts:124-133`). Per-turn state via `#turns` set and `prepareModelTurn` (`src/application/studio-runtime.ts:225`). |
| **Invariants** | Composition roots are Harness startup (`src/app.ts:28`), Host/client startup (`src/host/harness-launcher.ts:77`), and test factories — domain modules must not construct unrelated infrastructure. Transport/agents must consume ports/façades, not concrete runtime internals. Cross-domain operations need event/transaction/compensation. |
| **Tables** | none owned directly; **exposes** raw `db` to sub-stores. |
| **Credential scopes** | injects `SecureCredentialStore` (`src/application/studio-runtime.ts:149`), defaults to `KeyringCredentialStore`. |
| **Filesystem** | `projectRoot` resolved from `cwd` (`src/application/studio-runtime.ts:150`), `projectKey` for snapshots. |
| **Lifecycle** | **Created:** `app.ts:57` (`new StudioRuntime`); **Started:** `runtime.start()` → `extensions.reconcile` (`src/application/studio-runtime.ts:216`); `registerFlueTurnBoundary` (`src/app.ts:65`) injects `prepareModelTurn`. **Destroyed:** `runtime.stop()` → `supervisor.stopAll()` + `closeDatabase()` (`src/application/studio-runtime.ts:349`). |
| **⚠️ Violations** | **God object** — `StudioRuntime` is a public bag of repositories/infrastructure (`db`, `grants`, `trust`, `selection`, `inventory`, `extensions`, `registry`, `supervisor`, `catalog`, `management` all `public readonly`). Service-locator via `getStudioRuntime()` global (`src/application/studio-runtime.ts:366`) consumed by `src/agents/studio.ts:9`. **Raw handle exposure** — `StudioDatabase.handle: DatabaseSync` (`src/storage/database.ts:31`) is public; 9+ stores call `this.#db.handle.prepare/exec` directly (grep `handle`): `grant-store.ts:104`, `trust.ts:55`, `registry.ts:233`, `selection.ts:45`, `settings-store.ts:59`, `retrieval/settings.ts:92`, etc. Other domains issue raw SQL against any table. **Fix required by 008.3:** narrow to orchestration + lifecycle, hide handle behind domain repositories/ports, replace global with bounded application façade, transport routes take ports not `StudioRuntime` concrete (`src/transport/http/create-app.ts:13`, `src/transport/http/routes/mcp.ts:115`). Tracked as `StudioRuntime`-narrowing + handle-hiding items. |

## 3 — identity

| Aspect | Detail |
|---|---|
| **Logic** | `StudioUuid` branded string + `createStudioUuid()` (`src/contracts/uuid.ts:11,16` → `randomUUID`) + `isStudioUuid` (`src/contracts/uuid.ts:20`). |
| **State** | **stateless pure function** — no durable or process-local accumulation. |
| **Invariants** | One Project Studio UUID policy for generated session/approval/grant/task/idempotency identities (`src/contracts/uuid.ts:1` comment). Flue-owned opaque ids and stable domain keys (capability, provider, MCP ids) stay outside this generator. UUID v4 format (`src/contracts/uuid.ts:13`). Used for `ExecutionContext.requestId` (`src/execution/context.ts:77`), `grant.id` (`src/permissions/grant-store.ts:174`), `broker` pending id (`src/application/approval-broker.ts:39`). |
| **Tables** | none. |
| **Credential scopes** | none. |
| **Filesystem** | none. |
| **Lifecycle** | caller-owned; created on demand, no creator/destroyer. |
| **Refs** | `src/contracts/uuid.ts`, `src/admission/verifier.ts:110`, `src/execution/context.ts:49` |

## 4 — auth

| Aspect | Detail |
|---|---|
| **Logic** | Sign-in/session. `SessionStore` (`src/auth/session.ts:22` — load/save/clear), `StudioAuthClient` (`src/auth/auth-client.ts:26`), `SessionAccessTokenProvider` with shared `Promise` dedupe (`src/auth/session-token-provider.ts:53,76`), `loginWithGoogle` PKCE loopback (`src/auth/google-login.ts:47`), `resolveStudioAuthConfig` URL + timeout validation (`src/auth/config.ts:87`). |
| **State** | **Durable half in keychain, ephemeral refresh state in memory.** Half-written session (one token present) → treated as null (`src/auth/session.ts:42`). Proactive refresh at `skewMs=60s` (`src/auth/session.ts:98`). Shared `#refreshing` promise is per-process, not per-caller-signal (`src/auth/session-token-provider.ts:58`). |
| **Invariants** | Access + refresh stored as **two** separate keychain entries (`src/auth/session.ts:19`) — not one JSON blob (platform 1280-unit cap). Refresh token written first (`src/auth/session.ts:52`). On `session_expired`/`not_permitted` → `sessions.clear()` (`src/auth/session-token-provider.ts:119`). `https` required except `http` loopback for test mocks (`src/auth/config.ts:58`). No token in DB or logs. |
| **Tables** | **none** — explicitly must not enter `studio.db` or `flue.db` (`src/storage/migrations.ts:340` guard). |
| **Credential scopes** | `session:studio-access`, `session:studio-refresh` (`src/auth/session.ts:19`), via `SecureCredentialStore`. Distinct from `provider:*` and `mcp:*`. |
| **Filesystem** | none beyond keychain. |
| **Lifecycle** | **Created:** `app.ts` bootstrap (unwired) + `SessionStore(credentials)` injected into `SessionAccessTokenProvider`; **Destroyed:** `sessions.clear()` on sign-out (`src/auth/login.ts:47`) or expired refresh. |
| **Refs** | `src/auth/session.ts`, `src/auth/session-token-provider.ts:26` (abort handling), `src/credentials/credential-store.ts:66` scopes |

## 5 — credentials

| Aspect | Detail |
|---|---|
| **Logic** | Unified secret storage. `SecureCredentialStore` interface (`src/credentials/credential-store.ts:96`), `KeyringCredentialStore` (`src/credentials/keyring-store.ts:29` via `@napi-rs/keyring` `Entry`), `InMemoryCredentialStore` (`src/credentials/memory-store.ts:17` — tests only), validation `assertValidKey`/`assertValidSecret` (`src/credentials/credential-store.ts:104,129`), `credentialAccount` (`src/credentials/credential-store.ts:147`). |
| **State** | **OS-owned durable.** Windows Credential Manager / macOS Keychain / Linux Secret Service. No file fallback by design (`src/credentials/credential-store.ts:7`). `MAX_SECRET_LENGTH=1280` (`src/credentials/credential-store.ts:90`, UTF-16 units, tightest = Windows). `CREDENTIAL_SCOPES = ["session","provider","mcp"]` (`src/credentials/credential-store.ts:66`). |
| **Invariants** | One scope per secret-kind; `scope:id` is keychain account. No secret in `studio.db` — `assertNoSecretColumns` blocks column names containing `secret`/`password`/`token`/`key` etc. (`src/storage/migrations.ts:269`). Secrets never in logs/transcripts/errors (report strips, `translate` discards platform message `src/credentials/keyring-store.ts:81`). |
| **Tables** | **none** — anti-table. Presence is absence by design. |
| **Credential scopes** | **owns all:** `session` (auth), `provider` (BYOK + retrieval), `mcp` (per-server). Added `mcp` via single list fix (`src/credentials/credential-store.ts:109` comment). |
| **Filesystem** | Platform store location only (outside `~/.studio`). |
| **Lifecycle** | **Created:** `StudioRuntime` defaults to `new KeyringCredentialStore()` (`src/application/studio-runtime.ts:149`), injected to `SessionStore`, `RetrievalService`, `McpManagementService`, `PiCredentialStore`; **Destroyed:** `credentials.delete(key)` per `McpManagementService.remove/deleteCredential` order credential-before-DB (`src/application/mcp-management.ts:62`). Probe via `isKeyringAvailable` (`src/credentials/keyring-store.ts:108`). |
| **Refs** | `src/credentials/credential-store.ts`, `src/credentials/keyring-store.ts:17` service name |

## 6 — context

| Aspect | Detail |
|---|---|
| **Logic** | Context-window assembly. `ContextOptimizer` interface + `PassthroughContextOptimizer` (`src/context/context-optimizer.ts:7,11`). Planned compaction lives here. |
| **State** | **process-local, stateless passthrough today.** No durable state; per-turn envelope `canonical/optimized/optimizer`. |
| **Invariants** | Optimizer must not drop tool-call history silently. ~~Future work must preserve idempotency-key linking.~~ **There is no idempotency key to link** — it was deleted with the `@flue` patches under meta-task #12, and this clause would have had a reader believing a thing existed that does not. If Flue admits a key upstream, the clause returns with it. |
| **Tables** | none. |
| **Credential scopes** | none. |
| **Filesystem** | none. |
| **Lifecycle** | constructed per-turn or injected via Flue provider cache placement (Pi owns cache). No dedicated owner yet — **deferred**. |

## 7 — extend / MCP

| Aspect | Detail |
|---|---|
| **Logic** | Extension spine + MCP stack. `ExtensionInventory` (`src/extend/inventory.ts:68`), `ExtensionReconciler` (`src/extend/reconcile.ts:73`), `ExtensionSelectionStore` (`src/extend/selection.ts:29`), `McpServerRegistry` (`src/extend/mcp/registry.ts:204`), `McpSupervisor` (`src/extend/mcp/supervisor.ts:135`), `McpLauncher` (`src/extend/mcp/launcher.ts:71`), `StdioChannel`/`HttpChannel` (`src/extend/mcp/stdio-channel.ts:71`, `http-channel.ts:114`), `McpConnection` (`src/extend/mcp/connection.ts:77`), `McpCapabilityCatalog` (`src/extend/mcp/capabilities.ts:187`), `handshake` (`src/extend/mcp/handshake.ts:153`), `input-security` (`src/extend/mcp/input-security.ts:44`), `wire/*` backoff/era/pending. Management façade `McpManagementService` (`src/application/mcp-management.ts:27`). |
| **State** | **Durable:** `mcp_server` + `extension_selection` in `studio.db` (see below). **Ephemeral:** `McpSupervisor` per-server child handles, `PendingRequests` (`src/extend/mcp/wire/pending.ts:49`), `NdjsonDecoder`, `McpCapabilityCatalog.#tools/#connections/#availableNames` (`src/extend/mcp/capabilities.ts:190`). |
| **Invariants** | Three-layer split: installed (`mcp_server`) → selected per project (`extension_selection`) → callable per `CallGate` (never implied). **No secret column** — `authEnvVar` is name only, value from keychain at spawn (`src/extend/mcp/registry.ts:23`). Commands are absolute-path argv, never shell strings; shim extensions `.cmd/.bat/.ps1` refused (`src/extend/mcp/registry.ts:82,100`). `reachKey` (`src/extend/mcp/registry.ts:316`) is single list of fields driving grant revoke + restart + dedup. Namespace `mcp:<id>` (`src/extend/mcp/registry.ts:299`) segregates capabilities. `isSecretFieldName` blocks secrets in payloads. `availability-before-permission` (fix ADR 0029): disabled/disconnected tools never prompt nor external `tools/call`. |
| **Tables** | `studio.db: mcp_server` (`migrations:7`), `extension_selection` (`migrations:6`). `flue.db: none`. `mcp_server` guarded from secret columns (`auth_env_var` allowed, secrets refused). |
| **Credential scopes** | `mcp:<serverId>` (`src/extend/mcp/launcher.ts:32`, `src/credentials/credential-store.ts:66`). Injected via `authEnvVar` for stdio or `Authorization`/custom header for HTTP; keychain key `mcp:<id>` (`src/application/mcp-management.ts:105`). Bearer vs header vs none (`src/extend/mcp/registry.ts:34`). |
| **Filesystem** | spawn via `process/exec.ts` only (`src/process/exec.ts:213`); `env` does not inherit `process.env` (`src/extend/mcp/launcher.ts`). No snapshot/DB storage beyond DB rows + keychain. |
| **Lifecycle** | **Created:** `StudioRuntime` (`src/application/studio-runtime.ts:162-187`) — `registry`, `selection`, `supervisor`, `catalog`, `inventory`, `reconciler`, `management`. **Started:** `runtime.start()` → `reconcile` → `supervisor.launch` + `catalog.refresh` (`src/application/studio-runtime.ts:178`). **Per-turn:** `prepareModelTurn` refreshes dirty catalogs (`src/application/studio-runtime.ts:227`). **Destroyed:** `management.remove` → delete keychain **before** DB, `revokeNamespace`, `selection.forget`, `supervisor.stop`, `extensions.changed()` (`src/application/mcp-management.ts:56`); `stopAll` on shutdown (`src/application/studio-runtime.ts:350`). |
| **Violation** | Selection/registry still accessed via `this.#db.handle` raw SQL (`src/extend/selection.ts:45`, `src/extend/mcp/registry.ts:233`); cross-domain orchestration (DB + supervisor + keychain + grant revocation) must move to typed `McpManagementService` port — partially done, still raw inside service collaborators. |

## 8 — models

| Aspect | Detail |
|---|---|
| **Logic** | Provider registry + adapters. `ModelRegistry` (`src/models/model-registry.ts:13`), adapters `TestAdapter`/`LocalAdapter`/`StudioCloudAdapter` (`src/models/adapters/*`), `ProviderSettingsStore` (`src/models/local/settings-store.ts:51`), `ProviderConfig` (`src/models/provider-config.ts:9`), `bootstrapModelProviders` (`src/models/bootstrap.ts:228`), `StudioGatewayClient` (`src/models/studio-cloud/client.ts:79`). Identity `STUDIO_MODEL_ID` = `project-studio/default` (`src/contracts/models.ts`). |
| **State** | **Durable:** `custom_provider`, `provider_connection`, `app_setting(local.default_model)` in `studio.db`. **Process-local:** `ModelRegistry.#adapters` map, `Pi` cache placement, `LocalRuntime` provider cache. |
| **Invariants** | `ModelDescriptor` is authoritative for capabilities/modalities/streaming/tools (`src/models/model-registry.ts:39`). Unsupported modality → explicit fail. `studio-cloud` vs `local` source switch validated at startup before OTEL (`src/app.ts:37`). Custom OpenAI-compatible endpoints remain **local-only** (`src/models/local/*`). No credentials in DB. |
| **Tables** | `studio.db: custom_provider`, `provider_connection`, `app_setting` (key `local.default_model`). `flue.db: none`. |
| **Credential scopes** | `provider:<providerId>` (BYOK local keys) via `PiCredentialStore` (`src/models/local/credential-bridge.ts:53`), platform limit enforced. |
| **Filesystem** | `studio.db` only; no model artifacts on disk besides potentially Pi cache (`~/.studio/cache/` via `AppCache`). |
| **Lifecycle** | **Created:** `bootstrapModelProviders` at Harness startup (`src/app.ts:38`) → `ModelRegistry` + adapter(s); `ProviderSettingsStore(getDatabase())` lazily. **Destroyed:** no persistent handles; adapter shutdown via OTEL close. |
| **Refs** | `src/models/bootstrap.ts:188`, `src/models/local/settings-store.ts:80`, `src/storage/migrations.ts:33` v1 |

## 9 — net

| Aspect | Detail |
|---|---|
| **Logic** | Destination judging + outbound HTTP. `judgeDestination` / `judgeHostPort` / `destinationResource` / `classifyHost` (`src/net/destination.ts:198,217,241`), `requestDirect` / `requestStream` (`src/net/http.ts:336,260`), `isOwnPort` (`src/net/own-ports.ts`). |
| **State** | **stateless pure functions + DNS pin per request.** No durable. |
| **Invariants** | **C-17 policy:** public = always allowed; loopback allowed + port-scoped approval; private: model=refused, user=allowed; metadata/`own-port`=always refused (`src/net/destination.ts:342`). Every DNS answer judged, socket pinned to judged address (`src/net/http.ts:137,218`). Every redirect re-judged as `author=model` regardless of original (`src/net/http.ts:311`), credentials stripped (`src/net/http.ts:191`). Own-port classified before any loopback allow (`src/net/destination.ts:221`). `process.env` never used for routing. |
| **Tables** | none. |
| **Credential scopes** | none stored; **strips** `Authorization`/non-safe headers on cross-origin redirect (`src/net/http.ts:192`). |
| **Filesystem** | none. |
| **Lifecycle** | stateless; caller-owned (`fetch` tool, MCP `HttpChannel`). Timeout 30s, ceiling 8 MiB (`src/net/http.ts:75,79`). |
| **Refs** | `src/net/destination.ts:97` (IPv4 classification), `src/net/http.ts:1` (only place that opens a connection itself) |

## 10 — observability

| Aspect | Detail |
|---|---|
| **Logic** | Structured logging + OTEL + redaction + error contract. `createLogger` (`src/observability/logger.ts:96`), `redactSensitiveString`/`REDACTION_RULES` (`src/observability/redaction.ts:59`, `redaction-rules.ts:65`), `toErrorReport`/`ErrorReporter` (`src/observability/error-reporter.ts:49`), `initializeObservability` (`src/observability/index.ts:55`), `startObservabilitySdk` (`src/observability/sdk.ts:244`), `registerFlueInstrumentation` (`src/observability/flue.ts:32`). |
| **State** | **Process-local singleton** `ObservabilityHandle` (`src/observability/index.ts:49`) + global OTEL providers. Per-request correlation via `ExecutionContext` (`src/observability/logger.ts:29`) and span `trace_id/span_id`. |
| **Invariants** | One correlation vocabulary (`request_id`, `trace_id`, `flue_*` etc., `src/observability/logger.ts:34`) **without secrets**; redaction applied **before** logs/reports/transcripts/API (`src/observability/logger.ts:75`, `src/observability/error-reporter.ts`). Exporter/logging failure **must not** block agent or change user outcome; exporter wrapped as `Fallible*Exporter`. Child tails captured with pid/exit/signal/op context (`src/observability/redaction.ts` etc.). |
| **Tables** | none. |
| **Credential scopes** | none owned; **redacts** session/provider/mcp/Harness/MCP/provider/Gateway/keychain shapes (redaction catalog). |
| **Filesystem** | `~/.studio/logs/` (`src/platform/paths.ts:134`) + `~/.studio/cache/` for OTEL. Logger default is `stdout`/`stderr` unless `write` injected. |
| **Lifecycle** | **Created:** `initializeObservability()` in `app.ts:40`; Flue boundary registered (`src/app.ts:65`). **Destroyed:** `observability.shutdown()` on `SIGTERM` (`src/app.ts:95`) and on startup failure (`src/app.ts:111`). Startup failures retain pid/signal/stdout/stderr tails. |
| **Refs** | `src/observability/logger.ts:59`, `src/observability/index.ts:94` fallback exporters, `src/observability/sdk.ts:138` drop-on-failure |

## 11 — permissions

| Aspect | Detail |
|---|---|
| **Logic** | Kernel + stores. `PermissionKernel` (`src/permissions/kernel.ts:108`, `evaluate` `src/permissions/kernel.ts:222`, `authorize` `src/permissions/kernel.ts:362`), `PermissionGrantStore` (`src/permissions/grant-store.ts:70`), `WorkspaceTrustStore` (`src/permissions/trust.ts:44`), `policy.ts:BASE_POLICY`, `scopes.ts`, `matcher.ts`, `mode.ts`, `PermissionApprovalBroker` (`src/application/approval-broker.ts:31`), `trust.ts:posture`. |
| **State** | **Durable:** `permission_grant` + `workspace_trust` in `studio.db`. **Process-local:** `Kernel.#registry` map + `ApprovalBroker.#pending` (`src/application/approval-broker.ts:32`) + `mode()` closure. |
| **Invariants** | **Kernel decides, never executes, never prompts** — approver injected (`src/permissions/kernel.ts:44`). Order: trust precondition → policy → stored grants → default/mode (`src/permissions/kernel.ts:222` comment). Grant cannot overturn policy. Trust denied = `deny` not `ask` (prevents approval-collection). `resource` derived from args, never raw arg, before authorize (`src/tools/gate.ts:268`). Pending approvals are **memory-only** (decision in `008.6`/`008.3` gate to record whether they become durable). `revokeNamespace` by prefix exact-match not `LIKE` (`src/permissions/grant-store.ts:278`). |
| **Tables** | `studio.db: permission_grant` (migrations 2,3,5,8 — adds `resource_pattern`, `project_id`, `definition_hash`), `workspace_trust` (migration 4). `flue.db: none`. |
| **Credential scopes** | none. |
| **Filesystem** | none. |
| **Lifecycle** | **Created:** `GrantStore`+`TrustStore` with `db` in `StudioRuntime` (`src/application/studio-runtime.ts:157`); `Kernel` per `CallGate` sandbox (`src/application/studio-runtime.ts:253`); `Broker` in `app.ts:56` injected to `Kernel`. **Grants:** `grant()` on `allow` answer (`src/permissions/kernel.ts:427`), `revoke`/`revokeNamespace`/`revokeConversation` on removal. **Destroyed:** in-process only; pending map cleared on abort (`src/application/approval-broker.ts:42`). |
| **Refs** | `src/permissions/policy.ts:100` BASE_POLICY, `src/permissions/matcher.ts:96` resource matching, `src/permissions/grant-store.ts:95` find precedence |

## 12 — platform / process

| Aspect | Detail |
|---|---|
| **Logic** | OS specifics + process spawn. `platform/paths.ts` (`studioHome`, `databasePath`, `flueDatabasePath`, `snapshotsDirectory`, `resolveConfigured` etc., `src/platform/paths.ts:56,96,110,130,194`), `vendor/resolver.ts`, `process/exec.ts` (`runProcess` `src/process/exec.ts:213`, `assertRunnableCommand` `src/process/exec.ts:103`, `killProcessTree` `src/process/exec.ts:156`, `buildEnvironment` `src/process/exec.ts:66`). |
| **State** | **Stateless helpers + env-based config.** `PROJECT_STUDIO_HOME` overrides `~/.studio` (`src/platform/paths.ts:57`), `PROJECT_STUDIO_STORE_PATH`/`PROJECT_STUDIO_DB_PATH` overrides DB (`src/storage/database.ts:58`, `src/db.ts:25`). |
| **Invariants** | **Never resolve against `cwd`** — harness runs with project as `cwd`, so `vendor`/`DB` cwd-relative is a bug (`src/platform/paths.ts:22`, `src/db.ts:14`). Installation read-only, vendored binaries via `installationRoot()`/`shippedBinaryDirectory()` (`src/platform/paths.ts:74,79`), not cwd. `managedBinaryDirectory = ~/.studio/tools/bin` (`src/platform/paths.ts:91`). `resolveConfigured` refuses `..` outside home (`src/platform/paths.ts:199`). `process/exec` — command is absolute argv, `shell:false` (`src/process/exec.ts:228`), `.exe/.com` only on Win, PATH blanked (`src/process/exec.ts:90`), descendant kill via `taskkill /T` or `kill(-pid)` process group (`src/process/exec.ts:162,200`). Env built from policy, never `process.env` except allowlisted `SystemRoot` etc. (`src/process/exec.ts:39`). |
| **Tables** | none. |
| **Credential scopes** | none; `buildEnvironment` explicitly blanks `PATH` so spawned binaries can't inherit tokens. |
| **Filesystem** | **Defines all surfaces:** `~/.studio/config/` (back-up), `data/` (durable: db, snapshots, projects, sessions), `tools/bin` (re-downloadable), `logs/` (disposable), `cache/`, `tmp/` (`src/platform/paths.ts:30`). `durableDirectories()` enumerates for backup (`src/platform/paths.ts:162`). |
| **Lifecycle** | pure functions; `ensureDirectory` mkdir-on-demand (`src/platform/paths.ts:173`). Process lifetime via `runProcess` caller (tools, git, MCP supervisor). |
| **Refs** | `src/platform/paths.ts:1` (category rule), `src/process/exec.ts:24` MAX_OUTPUT 8MiB |

## 13 — retrieval

| Aspect | Detail |
|---|---|
| **Logic** | Web search + page reading behind two slots. `RetrievalService` (`src/retrieval/service.ts:36`, `search` `src/retrieval/service.ts:45`, `read` `src/retrieval/service.ts:56`), `RetrievalSettingsStore` (`src/retrieval/settings.ts:37`), `ProviderSlots`/`runWithFallback` (`src/retrieval/slots.ts:38`), providers `tavily`/`brave`/`exa`/`jina`/`firecrawl` (`src/retrieval/providers/*`), `retrieval/http.ts` (reads **through service**, cannot reach private). |
| **State** | **Durable:** `app_setting` keys `retrieval.search.primary/fallback`, `retrieval.reader.primary/fallback` via `RetrievalSettingsStore`. **Ephemeral:** per-call `ProviderSlots` built from keychain. |
| **Invariants** | Two slots, never a pool — `primary`+`fallback` only (`src/retrieval/service.ts:81`). Per-call provider build so rotated keys apply immediately. Missing key → slot skipped, not error; `fallback` promoted (`src/retrieval/service.ts:90`). `blocked` advances slot only for `read`. No tool names provider or reads raw vendor status. |
| **Tables** | `studio.db: app_setting` (retrieval keys). `flue.db: none`. |
| **Credential scopes** | `provider:<retrievalProviderId>` (same `provider` scope as BYOK, e.g. `provider:tavily`). Read via `credentials.get({scope:"provider", id})` (`src/retrieval/service.ts:94`). |
| **Filesystem** | none — network only. |
| **Lifecycle** | **Created:** `RetrievalService` per `registerWebTools` with `settings = new RetrievalSettingsStore(database)` + injected `credentials` (`src/tools/native/index.ts:27`). `settings.select` records choice. **Destroyed:** none; stateless. |
| **Refs** | `src/retrieval/registry.ts:35` defaults tavily/jina, `src/retrieval/slots.ts:16` ProviderSlots |

## 14 — sandbox

| Aspect | Detail |
|---|---|
| **Logic** | Isolation tiers. `LocalSandbox` (`src/sandbox/local-sandbox.ts:38`), `SandboxPolicy` (`src/sandbox/policy.ts:27`), `createSandboxPolicy` (`src/sandbox/policy.ts:107`), `DEFAULT_CAPABILITY_SWITCHES` (`src/sandbox/policy.ts:78`), `requiredIsolation`/`satisfiesIsolation` (`src/sandbox/policy.ts`), path containment `resolveContainedPath`/`isInsideRoot` (`src/sandbox/paths.ts:40,67`). |
| **State** | **Process-local only.** `isolation: "in-process"` (`src/sandbox/local-sandbox.ts:39`). `policy.workspaceRoot` + `readRoots`/`writeRoots` + `allowExec`/`allowNetwork` + `environment`. |
| **Invariants** | Every `readFile`/`writeFile`/`stat`/`readdir`/`mkdir`/`remove` goes through `resolveContainedPath` (`src/sandbox/local-sandbox.ts:141`). `assertSupports` checks `allowExec`/`allowNetwork` then `satisfiesIsolation` (`src/sandbox/local-sandbox.ts:114`). Provenance-based refusal moved from sandbox to **policy `ask`** (ADR 0025) — sandbox no longer checks `trusted`. `environment()` built from policy only, never `process.env` (`src/sandbox/local-sandbox.ts:164`). Workspace root removal refused. Must not claim OS containment. |
| **Tables** | none. |
| **Credential scopes** | none; `environment()` is policy-built, so secrets cannot leak via inherited env. |
| **Filesystem** | Guards `workspaceRoot`; `readRoots`/`writeRoots` scoped. Concrete surface depends on capability calls. |
| **Lifecycle** | **Created:** `StudioRuntime.createAgentSandbox` per agent turn → `createSandboxPolicy({workspaceRoot})` → `new LocalSandbox(policy)` (`src/application/studio-runtime.ts:241`). **Exposed:** via `SessionEnv` to Flue (`src/application/studio-runtime.ts:89,298`) + to `CallGate`. **Destroyed:** GC after turn; no durable handle. Future `SandboxFactory` + `bwrap`/`ProcessContainer`/`Seatbelt` behind same port in `008.8` (Linux `bwrap` with fallback, Win `ProcessContainer` **11 24H2+** guard, Seatbelt deferred — ADR 0023). |
| **Refs** | `src/sandbox/policy.ts:39` `LocalSandbox` policy-refuse, `src/sandbox/local-sandbox.ts:32` in-process comment |

## 15 — snapshots

| Aspect | Detail |
|---|---|
| **Logic** | Undo history. `SnapshotStore` (`src/snapshots/store.ts:43`, `capture` `src/snapshots/store.ts:95`, `restore` `src/snapshots/store.ts:175`, `list` `src/snapshots/store.ts:140`), `ShadowRepository` (`src/snapshots/shadow-repo.ts`), `TurnSnapshots` (`src/snapshots/turn.ts`), `projectKey` (`src/snapshots/shadow-repo.ts`). |
| **State** | **Filesystem-owned durable, no DB.** Shadow git repo per project (`~/.studio/data/snapshots/<projectKey>/`), git log is the record (`src/snapshots/store.ts:9`). Ephemeral `#touched` set for force-added ignored files (`src/snapshots/store.ts:55`). |
| **Invariants** | Shadow repo **outside project** (`src/platform/paths.ts:128` comment) so not in user's `git status` and survives `rm -rf`. `beforeWrite` undo point taken after authorize, before execute (`src/tools/gate.ts:308`). `restore` captures `before restoring <id>` first, then `restore --source`, then explicit `rm` for files added since target (`src/snapshots/store.ts:179`). All git ops via serialized `transaction()` (queue, not parallel). `NUL`-split parsing for filenames with newlines (`src/snapshots/store.ts:39`). Expired/unknown snapshot → `SnapshotError`. |
| **Tables** | **none** — deliberately no table (`src/snapshots/store.ts:17`). |
| **Credential scopes** | none. |
| **Filesystem** | `~/.studio/data/snapshots/<projectKey>/.git` + object store. Operations on `workspaceRoot` via git worktree; guarded by `relative` + `isAbsolute` check on `rm` (`src/snapshots/store.ts:212`). |
| **Lifecycle** | **Created:** `new SnapshotStore({workspaceRoot, root=snapshotsDirectory()})` per `createAgentSandbox` (`src/application/studio-runtime.ts:247`); wrapped in `TurnSnapshots({store, required: mode==='full-auto', reporter})` (`src/application/studio-runtime.ts:246`). Hook `beginTurn()` registered in `#turns` (`src/application/studio-runtime.ts:251`). **Captured:** `beforeWrite` per mutating tool (`src/tools/gate.ts:309`). **Listed/restored:** via snapshot API routes (typed contracts, no UI). **Pruned:** policy deferred to `008.10` decision. |
| **Refs** | `src/snapshots/store.ts:9`, `src/snapshots/shadow-repo.ts`, `src/snapshots/turn.ts` |

## 16 — storage

| Aspect | Detail |
|---|---|
| **Logic** | Application DB engine. `StudioDatabase` interface + `openDatabase` (`src/storage/database.ts:30,67`), `migrate` + `MIGRATIONS` + `assertNoSecretColumns` (`src/storage/migrations.ts:33,340,375`), `StorageError` (`src/storage/errors.ts:31`). |
| **State** | **Durable single-file SQLite** `~/.studio/data/studio.db` via `node:sqlite` `DatabaseSync` (`src/storage/database.ts:4,96`), `WAL` + `busy_timeout=5000` + `foreign_keys=ON` + `synchronous=NORMAL` (`src/storage/database.ts:95`). `user_version` tracks schema (`src/storage/migrations.ts:249`). Process-singleton `shared` (`src/storage/database.ts:147`). |
| **Invariants** | Separate file from `flue.db` — Flue upgrade cannot collide with app migrations (`src/storage/database.ts:10`). Migrations append-only, never edited, each in its own txn with rollback on guard failure (`src/storage/migrations.ts:406`). Downgrade (`current > latest`) → refusal (`src/storage/migrations.ts:385`). No credential/admission token column — `assertNoSecretColumns` on every open even when `current===latest` (`src/storage/migrations.ts:392`). Empty file (size 0) → `migration` error not WAL (`src/storage/database.ts:74`). Non-reentrant `transaction()` — inner `BEGIN` throws (`src/storage/database.ts:121`). |
| **Tables** | **Owns all app tables:** `schema_migration`, `custom_provider`, `provider_connection`, `app_setting`, `permission_grant` (+ unique `permission_grant_scope`), `workspace_trust`, `extension_selection`, `mcp_server`. Flue tables live in `flue.db` only, invisible here. |
| **Credential scopes** | none — enforcement point for none. |
| **Filesystem** | `databasePath()` file + `-wal`/`-shm` sidecars in `data/`. `resolveDatabasePath` honors `:memory:` for tests (`src/storage/database.ts:62`). |
| **Lifecycle** | **Created:** `getDatabase()` lazy singleton (`src/storage/database.ts:153`) via `openDatabase()` (mkdir + pragma + migrate). **Injected:** every store receives `StudioDatabase` not `DatabaseSync` — **violation** is `handle` field (`src/storage/database.ts:31`) makes this moot. **Destroyed:** `closeDatabase()` (`src/storage/database.ts:158`) on `runtime.stop()` → `app.ts:94` shutdown and startup-failure catch (`src/app.ts:106`). Reopen safe; concurrent reader uses WAL. |
| **⚠️ Violations** | Handle hiding incomplete — see §2. Until `StudioRepository` port lands, any store can `handle.prepare("DELETE FROM ...")` on any table. Architecture tests must gate `only storage adapters access handle` and `no raw SQL outside owning repository` (`008.3` item 10-11). |

## 17 — tools

| Aspect | Detail |
|---|---|
| **Logic** | Native capabilities. `CallGate` (`src/tools/gate.ts:71`, `register` `src/tools/gate.ts:97`, `call` `src/tools/gate.ts:241`), `CallBounds` (`src/tools/bounds.ts:160`), `registerNativeTools` (`src/tools/native/index.ts:19` → filesystem/`src/tools/filesystem/*`, search/`src/tools/search/*`, git/`src/tools/git/index.ts:159`, shell/`src/tools/shell/index.ts:117`, web/`src/tools/web/*`, `workspace-summary.ts`). Generic `ToolDefinition`/`defineStudioTool` (`src/tools/types.ts:26,71`), `ToolError` (`src/tools/errors.ts:38`). |
| **State** | **Process-local gate state.** `CallGate.#tools` map + `Kernel.#registry`, `CallBounds.#permits` FIFO queue (`src/tools/bounds.ts:65`) + deadlines. MCP tools registered dynamically via `catalog.tools()` refresh in `SandboxFactory.tools()` (`src/application/studio-runtime.ts:299`). |
| **Invariants** | **One gate, every tool exactly once** — `CallGate.register` couples `kernel.register` + `bounds.declare` (`src/tools/gate.ts:107`), `CallGate.call` order is `parse → resource derivation → kernel.authorize → sandbox.assertSupports → snapshots.beforeWrite → bounds.run → execute` (`src/tools/gate.ts:258-319`). `parse`/`resource` type-erased once at boundary. `list()` filters by `sandbox.supports` (switch-based) never by permission (`src/tools/gate.ts:200`). `requiresUndoPoint` from effect table, not bare `write` test (`src/tools/gate.ts:308` — catches `execute`-writes like `shell`). Bounds 8 concurrent, 120s deadline, per-capability override, deadline covers queue time (`src/tools/bounds.ts:25,36`). |
| **Tables** | none — tools are code, not rows. Registrations live in ephemeral `CallGate`+`Kernel`. |
| **Credential scopes** | none directly; retrieval providers resolve via credentials store indirectly. |
| **Filesystem** | via `sandbox` (fs/git/shell/edit) or via `net`/`retrieval` (web). `ReadInput`/`WriteInput` paths resolved by `sandbox.resolveRead/Write` (`src/tools/filesystem/read.ts:68`, `write.ts`). |
| **Lifecycle** | **Created:** `CallGate({kernel, sandbox, snapshots, reporter, bounds})` per sandbox (`src/application/studio-runtime.ts:252`); `registerNativeTools(gate,{database, credentials})` (`src/application/studio-runtime.ts:268`). **Registered:** MCP tools refreshed per turn (`src/application/studio-runtime.ts:275`). **Destroyed:** GC after turn; `gate.unregister` on selection change. |
| **Refs** | `src/tools/gate.ts:17` single-door comment, `src/tools/bounds.ts:213` abort vs timeout, `src/tools/shell/resolve.ts:80` absolute program resolution |

## 18 — transport

| Aspect | Detail |
|---|---|
| **Logic** | HTTP façade + admission. `createHttpApp` (`src/transport/http/create-app.ts:25` — global `use("*", createAdmissionMiddleware)` then `/api/mcp`, `/api/permissions`, `/` Flue with `AGENT_RUN` scope), `createAdmissionMiddleware` + `requireAdmissionScope` (`src/transport/http/middleware/admission.ts:34,53`), `createMcpRoutes` (`src/transport/http/routes/mcp.ts:115` — CRUD/enablement/credential via `McpManagementService`), `createApprovalRoutes` (`src/transport/http/routes/permissions.ts`), Flue routing `flue()` (`src/transport/http/create-app.ts:34`). `HarnessLauncher` readiness/bootstrap FDs (`src/host/harness-launcher.ts:77`), `FlueHarnessClient` (`src/application/harness-client.ts`, docs `architecture.md`). |
| **State** | **Process-local Hono app + ephemeral per-request contexts.** `AdmissionEnv` carries `authContext` + `executionContext` (`src/transport/http/middleware/admission.ts:13`) — `ExecutionContext` (`src/execution/context.ts:29`) built per request with `X-Project-Studio-Request-Id` UUID propagation (`src/transport/http/middleware/admission.ts:42`). SSE via Flue `observe({live:"sse"})`. |
| **Invariants** | **One global admission middleware before all routes** (`src/transport/http/create-app.ts:27`); Flue agent routes additionally require `AGENT_RUN` (`src/transport/http/create-app.ts:33`). Every handler takes `AuthContext`/`ExecutionContext` from env, not from `StudioRuntime`. Loopback-only (`src/host/harness-launcher.ts:90`), no cwd-relative resolution. Error mapping via `contracts/effects` + `redaction`. Version/compat rules from `008.4` (route inventory, scope contracts). |
| **Tables** | none — handlers delegate to domain services. |
| **Credential scopes** | none owned; routes that touch credentials delegate to `McpManagementService` which owns keychain ordering. `list/send/observe` routes are scoped bearer-only. |
| **Filesystem** | none. Host lifecycle owns child process FDs and `baseUrl = http://host:port`. |
| **Lifecycle** | **Created:** `createHarnessApplication()` in `app.ts:28` → `new PermissionApprovalBroker` + `createAdmissionSession` + `new StudioRuntime` + `configureStudioRuntime` + `createHttpApp` + `registerFlueTurnBoundary`. **Started:** `launchHarness` (tests/headless) or Tauri Host — collects `readiness` line on FD3 with timeout (`src/host/harness-launcher.ts:142`) + bootstrap credential on FD4. **Destroyed:** `shutdown()` (`src/app.ts:88`) → `verifier.invalidate()` + `runtime.stop()` + `closeDatabase()` + `observability.shutdown()`; `stopChild` kills harness group (`src/host/harness-launcher.ts:56`). |
| **⚠️ Violations** | Routes still depend on concrete `StudioRuntime` (`src/transport/http/create-app.ts:13`, `src/transport/http/routes/mcp.ts:9`) instead of typed ports (`McpManagementPort`, `PermissionBrokerPort` etc.). `agents/studio.ts:9` depends on global `getStudioRuntime()` rather than injected façade. Must be replaced by application façades before `CI=true pnpm check` architecture tests. `flue.db` is correctly **not** touched from transport — via Flue adapter only. |

---

### Honest current violations (must be closed by 008.3 gate)

1. **`StudioRuntime` god object.** `src/application/studio-runtime.ts:123` exposes `db`, `grants`, `trust`, `selection`, `inventory`, `extensions`, `registry`, `supervisor`, `catalog`, `management` as `public readonly`. `getStudioRuntime()` global (`src/application/studio-runtime.ts:366`) is a service locator. **Required:** narrow to orchestration/lifecycle, replace with bounded façade, construction only in approved roots (`app.ts`, `host/harness-launcher.ts`, test factories). Exception must be ADR-documented with expiry/review.

2. **Raw `DatabaseSync` handle exposed.** `StudioDatabase.handle` (`src/storage/database.ts:31`) is public; every store issues raw SQL against any table. Cross-domain raw access (e.g. `trust.ts` touching `permission_grant`) is possible and not tested. **Required:** hide behind domain-owned repositories/ports; only storage adapters may touch the handle (architecture test group 10 in `008.3`).

3. **Transport ↔ concrete runtime coupling.** `createHttpApp({runtime: StudioRuntime})` (`src/transport/http/create-app.ts:12`) and `createMcpRoutes(runtime)` (`src/transport/http/routes/mcp.ts:115`) take the whole runtime. Agents take global runtime (`src/agents/studio.ts:9`). **Required:** typed in-process ports for `McpManagement`, `PermissionBroker`, `ProviderSelection`, `ToolRegistration`, `Persistence` — routes/agents consume ports/façades.

4. **Cross-domain transaction/compensation not yet typed.** `McpManagementService.save/remove` already orders keychain → DB → grant revocation → supervisor → extension change (`src/application/mcp-management.ts:44,56`) but still reaches into stores directly; general transaction/event semantics for operations crossing MCP/registry/selection/grants/credentials/supervisor must be formalized before later phases.

### Architecture-test groups to gate (008.3 items 9–12)

- import-boundary + dependency-direction
- only approved roots construct cross-domain infrastructure + only storage adapters access handle
- no new public repository bags / hidden global locators / duplicated policy decisions
- all enforced in `CI=true pnpm check` with focused failure naming the violated owner

### Reference graph

- Paths/surfaces: `src/platform/paths.ts`, `src/snapshots/shadow-repo.ts`, `src/storage/database.ts`, `src/db.ts`
- Secrets: `src/credentials/*`, `src/storage/migrations.ts:340`, `src/auth/session.ts`, `src/extend/mcp/registry.ts:23`
- Trust/permissions: `src/permissions/*`, `src/application/approval-broker.ts`, `src/tools/gate.ts:70`, `src/sandbox/policy.ts`
- Network/process: `src/net/*`, `src/process/exec.ts`
- Observability: `src/observability/*`, `src/execution/context.ts`
- Transport/application: `src/transport/http/*`, `src/application/*`, `src/app.ts`, `src/host/*`
- Decisions: `documentation/decisions/0028-*`, `0014`, `0023`, `0029` (to be amended in `008.16`)

