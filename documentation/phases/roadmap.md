# Project Studio V2 Roadmap

This roadmap is the canonical implementation order for the local-first harness. Cross-cutting
work may be added when it removes risk from the next milestones, but it must not reorder the
capability path without an architecture decision.

## Completed

### Phases 1-4: Harness Foundation

- Strict TypeScript workspace.
- Flue/Pi continuing-agent loop.
- File-backed SQLite canonical persistence.
- Accepted submissions, observation, cancellation, continuity, and restart recovery.
- Deterministic provider and typed tool continuation.
- Gateway-neutral model and context-optimizer boundaries.

### Phase 5: Observability Foundation

- OpenTelemetry traces and metrics through Flue instrumentation.
- No-network, in-memory, and OTLP exporter modes.
- Structured correlated logs, safe errors, and content redaction.
- Runtime composition through `src/app.ts`.

### Phase 6: Provider Bootstrap

- One lifecycle for selecting and registering model sources.
- Gateway-neutral `project-studio/default` model identity.
- Deterministic provider behind the shared adapter contract.
- Capability metadata, configuration validation, and startup rejection for unavailable sources.

### Phase 7: Studio Gateway Integration

- Operational `studio-cloud` model source, selected at process bootstrap.
- Native Pi-facing Studio Gateway adapter parsing the gateway's own SSE contract, with streamed
  reasoning/text, preserved multiple tool calls, tool-result continuation, finish reasons, usage,
  safe typed errors, and cancellation, proven against a real generated Flue server.
- Injected `AccessTokenProvider` boundary; `PROJECT_STUDIO_GATEWAY_TOKEN` is a development-only
  bootstrap token, not credential storage.
- Required explicit default model; catalog loading is an explicit callable service.
- No automatic fallback between sources; `local`/BYOK recognized but not operational.
- Gateway trust boundary documented: private worker behind the public API's service binding; the
  public API owns end-user authentication.

### Phase 7.5: Architecture And Modularity Review

An audit pass over the real code after the first external model transport, not a feature phase.

- Removed `contracts/events.ts`: a product event envelope with no importer in `src/` or `tests/`,
  and already inaccurate (it modelled no reasoning event while reasoning streaming was shipping).
  The UI projection will be designed against a real consumer in Phase 18.
- Split the gateway wire vocabulary out of `event-mapper.ts` into `stream-events.ts`. Decoding what
  the gateway emits and projecting it onto Pi are separate responsibilities that change for
  different reasons; an architecture test now fails if the wire module imports Pi or Flue.
- Confirmed the deferred Phase 7 review gates: `tests/integration/studio-flue.test.ts` spawns the
  generated `dist/server.mjs` and drives it over HTTP, and the documentation claims no account/
  per-run switching and no automatic catalog loading.

Recorded, deliberately not changed:

- `application/harness-client.ts` returns Flue's `FlueConversationSnapshot`,
  `AgentConversationObservation`, and `AgentPromptResponse` directly. Product-owned projections are
  Phase 18 work with a real UI consumer; inventing them now would repeat the dead-abstraction
  mistake.
- `PassthroughContextOptimizer` has no production caller. It is a declared port from ADR 0003, kept
  as a decided seam, and it is exercised only by a unit test today.

### Phase 8: Product Authentication, Secure Credentials, And Local BYOK

Ordered so that storage exists before anything needs to store a secret. A session token is itself a
credential, so wiring login first would have required a temporary plaintext step.

1. **Public API proxy.** Done. `/studio/gateway/v1/*` on the public API verifies the caller's Studio
   token and forwards to the private gateway over the existing service binding, attaching the
   caller's identity as a trusted header and never forwarding the client's Authorization header.
   SSE bodies stream through. Covered by typecheck only: the api worker has no test harness.
2. **Secure OS credential storage.** Done. `SecureCredentialStore` over the platform keychain, with
   no fallback, one entry per secret, and limits validated against the real store. See ADR 0007.
3. **Harness-owned login.** Done. A PKCE loopback Google flow, the session stored in the credential
   store, and a single-flight refreshing `AccessTokenProvider` that replaces
   `PROJECT_STUDIO_GATEWAY_TOKEN`. `pnpm auth sign-in | status | sign-out`. See ADR 0008.
   Running against production still needs a Google "Desktop app" OAuth client id, set as
   `PROJECT_STUDIO_GOOGLE_CLIENT_ID` here and `GOOGLE_DESKTOP_CLIENT_ID` on the auth worker;
   everything else is implemented and tested against a mock Google.
4. **Local BYOK provider runtime.** Done. `LocalModelProviderAdapter` over Pi's `Models`
   collection, with the OS keychain presented as Pi's `CredentialStore`, 36 built-in providers,
   and custom OpenAI-compatible providers covering Ollama, LM Studio, and proxy services.
   `pnpm providers list | connect | disconnect`. See ADR 0009.
5. **Connect/disconnect/select contracts.** Done. `LocalProviderService` exposes list, connect
   (API key or interactive), disconnect, add/remove custom provider, list models, and select
   default model; the CLI is now a thin caller over the same methods a settings screen will use.
   Custom providers and the chosen default model live in the application database, with the
   environment variables demoted to a development override. `pnpm providers list | models |
   connect | disconnect | add | remove | select | default`.

Two cross-cutting foundations were established here rather than deferred, because subphase 5 was
the first product state that had to outlive a process, and because every subsystem from Phase 9 on
needs both:

- **The application-owned database** (`src/storage/`). A separate SQLite file from Flue's, on the
  same `node:sqlite` driver, with versioned append-only migrations and a guard that fails a
  migration whose column names look like credential storage. Secrets stay in the OS keychain; the
  database holds what the keychain cannot enumerate. See ADR 0010.
- **The shared error contract** (`src/contracts/errors.ts`, `src/observability/error-reporter.ts`).
  One base class with a `${domain}.${kind}` code, per-subsystem vocabulary preserved, a safe report
  shape carrying no stack or cause, and one reporting path that logs, annotates the span, and
  counts. Unclassified throws are reported as such so the gap stays measurable. Every existing
  error class was rebased with no call-site changes. See ADR 0011.

`local` is now operational. Selecting it without a configured default model is a clean startup
failure, never a silent fallback to the gateway.

### Phase 9: Capability And Permission Kernel

Foundation done. See ADR 0012.

- `PermissionKernel` is the single source of authority for native, MCP, and
  skill capabilities. It decides but never executes and never prompts; the
  approver is injected. Policy beats grants beats default, so a grant can never
  overturn a rule. An unregistered capability is denied, not asked about.
- Capability identity, effects, and provenance are declared by the integrator,
  never by the model or by a server describing itself.
- `ExecutionScope` carries authority and is refused when incomplete, so grants
  cannot leak across conversations or from a parent agent to a subagent.
- Grants are persisted, listable, and revocable; revoking marks rather than
  deletes.
- `LocalSandbox` contains the filesystem and withholds the host environment.
  ~~Superseded in part by ADR 0019: `execute` is now admitted for a **native**
  capability when the policy opted in, as *uncontained by consent* rather than
  as containment. `network` is still refused, and anything a user connected is
  still refused for both.~~ **Superseded again by ADR 0041, and this time by
  building the missing thing rather than by consenting around it.** A program
  the model chose and a server a third party wrote are both contained by the
  operating system — an AppContainer on Windows, `bwrap` on Linux — and a host
  whose kernel cannot supply that is **refused** rather than run open. macOS is
  out of scope by decision and enforces nothing. Measured on both platforms
  rather than declared; the evidence is in `tests/integration/`.

Remaining in this phase:

- **Remote sandbox provider** for the `os`/`remote-vm` tier, over Flue's
  `SandboxFactory` seam. Tencent CubeSandbox (Apache 2.0, E2B-compatible) is the
  intended target; it needs x86_64 Linux with KVM, so it is a remote service
  rather than something that runs on the user's desktop.
- ~~Cancellation, timeout, and concurrency policy.~~ Done — ADR 0017.
- ~~Idempotency and unknown-outcome handling on top of `CapabilityDescriptor`.~~
  Done, in the same work. An abandoned call is the moment `idempotent` exists
  for, and the error now says whether a retry is safe.
- Audit surface for grants. `CallGate.inFlight` is the first piece.

## Next

### Phase 10: Native Agent Tools

The audit is done. OpenCode ships 17 registry entries, but never all at once: `apply_patch` and
`edit`/`write` are mutually exclusive per model, three are behind experimental flags, and `invalid`
is not a capability. Of the rest, seven are primitives and ten are harness features wearing a tool
costume. Flue supplies `SessionEnv` and `bash` — plumbing, not model-facing tools — so there is no
overlap to avoid. See ADR 0013.

The surface is capped at eleven tools, grouped by family, one tool per capability.

**It was ten, and the eleventh is `web_search`.** Searching and reading a page are two
capabilities, not one: the model has a question in the first case and an address in the second, and
one tool taking either would be a single schema hiding two jobs. The cap is a discipline against
tools that are harness features in costume — it is not a number to defend by merging two real
capabilities.

| Family | Tools | Status |
|---|---|---|
| Filesystem | `read`, `write`, `edit` | Done, and reversible — see ADR 0016 |
| Search | `glob`, `grep` | Done, over vendored ripgrep 14.1.1 |
| Version control | `git` | Done — complete subcommand coverage, one capability |
| Execution | `shell` | Done — contained by the OS where the kernel supplies it, refused where it does not, ADR 0041 |
| Network | `fetch`, `web_search` | Done — ADRs 0022 and 0023 |
| Delegation | `task`, `skill` | Phases 13 and 12 |

Foundations landed first, because every tool stands on them:

- **`src/process/`** — the one place a child process starts. A command is an executable plus an
  argument vector, never a string, and no shell is involved. That is what lets git and ripgrep be
  substrate rather than arbitrary execution.
- **`src/vendor/`** — vendored, then system, then a refusal naming the fix. Which slots are filled
  is packaging, not code.
- **`src/tools/gate.ts`** — the single door between a model's request and running code. Registering
  a tool registers its capability with the kernel in the same call. Resource resolution happens
  before authorization, so an unresolved `..` can never be matched against a scoped rule.
- **Argument-level permissions** — policy and grants now match on what a call touches, so `git:log`
  and `git:push` are decided separately.
- **`src/snapshots/`** — a shadow git repository per project, outside the project. The gate takes a
  snapshot before each turn's first write, keyed on the declared `write` effect. This is a
  prerequisite rather than a feature: modes need undo, and `shell` needs modes. See ADR 0016.

- **`src/contracts/effects.ts`** — one table saying what each effect requires: isolation, a restore
  point, whether it may ever be silent, and whether an untrusted folder allows it. Six files used to
  hold their own copy of that rule inline, and one of them disagreed — which is how `shell` came to
  write with no undo behind it. See ADR 0020.
- **`src/permissions/trust.ts` and `mode.ts`** — workspace trust as a precondition ahead of policy
  and grants, and two modes (ADR 0057; three before it) that resolve a *default* `ask` and never a policy one. See ADR 0018.
- **`src/tools/bounds.ts`** — a deadline, real mid-call cancellation, and a concurrency queue on
  every call. `runProcess` bounded a subprocess; this bounds a call, which is what a tool hanging in
  pure JavaScript needs. See ADR 0017.

The remaining order in this phase is fixed by that chain:

1. ~~**Gate bounds** (`T-02`).~~ Done — ADR 0017.
2. ~~**Trust and modes** (`T-03`, `T-09`).~~ Done — ADR 0018.
3. ~~**`shell`**.~~ Done — ADR 0019. The one tool where the model names the program, so it gives up
   the first of ADR 0013's three properties and keeps the other two.
4. ~~**`fetch`**.~~ Done — ADRs 0022 and 0023, and it arrived with `web_search` beside it. The
   network-effect question is answered in two parts: the resource is the destination host, so
   `fetch:example.com` uses the approval ladder unchanged; and what comes back is untrusted
   content, which no permission dialog addresses and which ships as a rule and a label rather than
   as taint machinery.

`task` and `skill` stay in Phases 13 and 12, so **Phase 10 is closed at nine of ten** — every tool
that belongs to this phase.

### Phase 11: MCP

Add a registry and separate transports for local MCP and authenticated cloud MCP. Reuse the same
capability, permission, cancellation, telemetry, and result policy as native tools. Include tool
provenance, collision handling, health, reconnect, and connection teardown.

Design and protocol research: `tasks/phase-11-mcp/002-design.md`. The protocol split into two eras on
2026-07-28 — a stateless core with no `initialize` handshake, no session id, and no
server-initiated requests. We speak the modern revision by default and probe for the legacy one.

That research found five collisions with what is already shipped. The first one blocked everything
else: a connected capability declaring `execute` or `network` is refused absolutely (ADR 0019,
ADR 0024), and the only honest declaration for a server tool we did not write is exactly those
two. See §3 of the task file.

All blocking questions were settled on 9 August 2026 (§8). The shape is three layers — installed
once on the machine, enabled per project and off by default, approved per call by the kernel
unchanged. Enabling can only subtract; it never grants. Both protocol eras ship together, because
a modern-only client connects to almost nothing published today. `C-15` and `C-16` are answered.

Phase 12 and the connector work inherit the same three layers. Only the first one differs, and
only because a skill grants no authority.

Two servers are bundled with Studio and announced as its own rather than as extensions: the
browser (ADR 0049) and the computer (ADR 0055). On 2026-09-15 the computer's first input run
typed into the person's own window, and ADR 0055 §7 now fixes the rule: the driver never acts
on a window it did not open, focus, read or click, the person sees every screenshot in the
transcript and a rail tab, and a small always-on-top pill says "Studio is using your computer"
while a turn drives it. Consent for the screen under Auto remains open.

### Phase 12: Skills

Add application-owned and workspace-discovered skills, validation, catalog metadata, and agent
assignment. Skills provide instructions and resources, not permissions or executable authority.

**Foundation done, 2026-09-15.** See ADR 0056. Flue already reads the Agent Skills format —
`SKILL.md` with frontmatter, one catalog line in the composed prompt, the body returned by its
`activate_skill` tool — so the harness built no skills engine. It decides the folders
(`<installation>/skills/` bundled, `~/.studio/skills/` the person's), the enablement (the extend
spine's `skill` kind, three scopes, off by default), and mounts the enabled set with `useSkill()`
in the render. Validation is Flue's parser; a folder that fails it is listed as a problem, not
thrown. `allowed-tools` is parsed and ignored: a skill grants nothing, and every tool it names still
passes the gate and the kernel. One bundled skill ships, `create-skill`, which tells the model how
to author one. The settings pane and the project screen render skills with the same scope control
servers use. Proof: `tests/integration/skills-flue.test.ts` drives the built server through off,
on (line in the prompt, body from the tool, one turn), and off again.

Remaining in this phase:

- **Installing a skill** from a folder, an archive, or a URL, from the settings screen. Today the
  person copies the folder by hand, which the pane says.
- **A model-driven install** — the model produces the files, the person approves the move into
  `~/.studio/skills/`. A permission question over a destination outside every root; not yet
  designed.
- **Workspace skills and trust.** Flue reads `<project>/.agents/skills/` on its own, outside the
  enable layer and before the folder is trusted. Gate it on `WorkspaceTrustStore`, or extend the
  runtime patch to switch discovery off. ADR 0056, Consequences.
- **Agent assignment** — which subagent gets which skill. Phase 13's question, once there are
  subagents to assign to.

### Phase 13: Subagents And Tasks

Define specialized profiles and delegation policy. Preserve parent-owned durability and restrict
each subagent to its explicitly declared tools, skills, and context.

### Phase 14: Projects, Workspaces, And Sandboxes

Bind conversations to Project Studio projects, define artifact ownership, and add sandbox
lifecycle policy. Conversation durability and workspace durability remain separate decisions.

### Phase 15: Memory And Context

Add project/user memory contracts and the authenticated cloud memory MCP adapter. Preserve Flue's
canonical transcript. Headroom remains an optional fail-open context optimizer.

### Phase 16: Workflows And Schedules

Use workflows for finite application-controlled jobs and continuing-agent dispatch for durable
conversation work. Add schedule admission, idempotency, retry, and inspection policy.

### Phase 17: Evals

Create deterministic regression suites for model selection, tool policy, MCP behavior, recovery,
permissions, context construction, and end-to-end task quality.

### Phase 18: Product Integration

Connect authentication and the existing React application to the stable harness contracts. Add
product-owned read models for agents, projects, capabilities, telemetry, and administration.

## Working Rules

1. Complete and review one phase before beginning the next.
2. Keep one implementation task active against the shared `main` worktree.
3. Run `pnpm check` before every checkpoint.
4. Commit a reviewed phase before delegation continues.
5. Never rebuild Flue's agent loop, canonical transcript, or submission journal.
6. Never place credentials or tenant authority in model-selected arguments.
7. Use OpenCode only as a behavioral reference, not as the harness architecture.
8. Add no empty subsystem directories or speculative abstractions.
9. Every new subsystem registers a `StudioErrorDomain`, raises `StudioError`, and reports through
   `ErrorReporter`. A subsystem that throws raw errors shows up as `unclassified` in telemetry.
10. Durable product state goes in the application database with a migration. Secrets go in the OS
    credential store, never in a database column.
