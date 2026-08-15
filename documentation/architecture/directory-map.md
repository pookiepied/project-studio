# STUDIO — Architecture

Root-level shape of the repo and how the two halves fit together. Reasoning is
in [mental-model.md](./mental-model.md); the harness's own ADRs in
`STUDIO HARNESS/docs/decisions/` are authoritative for anything inside it.

---

## Repository

```
STUDIO/                  desktop app — React 19, Vite, Tailwind v4, Tauri v2
STUDIO HARNESS/          the harness — TypeScript, Flue + Pi, Hono
documentation/           this layer: meta docs spanning both halves
tasks/                   batches of work in progress, with checklists
archive/                 previous attempts and superseded work, kept for mining
README.md
```

`archive/` holds v1 STUDIO (~83k lines), the Backend/Cloud service (in
production, deployed from elsewhere), the Discord bot, and old api/auth/docs.
Nothing there is live from this repo. It is reference material, not dead weight
— the vendoring manifest, the Rust OAuth loopback server, and the MCP/skill
libraries are all worth pulling forward.

---

## The two halves

They are separate processes and neither contains the other (ADR 0001). This is
the single structural lesson from v1, where the agent loop lived inside a React
context provider and every feature had to be threaded through three runtimes.

**Transport:** HTTP + SSE over localhost, via Hono. `FlueHarnessClient` in
`src/application/harness-client.ts` is the headless client;
`createFlueClient({ baseUrl, token })` with `observe(..., { live: "sse" })`
provides authenticated streaming.

Sub-millisecond overhead, and it buys three things: the harness is testable
standalone, it runs headless, and it can serve a web build. The cost is a
sidecar process to supervise. Worth it.

The client admission and local-access boundary is defined in
`STUDIO HARNESS/docs/decisions/0028-harness-client-admission-and-local-access.md`.
The target is one global Harness admission middleware, a per-launch in-memory
credential, an explicit loopback listener, and a Studio Host that owns the
Harness process. Optional browser access belongs to a separate frontend gateway;
it must not expose the Harness listener. The current repository has the Flue
HTTP/streaming primitive, the global admission contract/middleware, and a
headless launcher that binds the Harness to loopback with structured readiness.
Studio Host lifecycle and the desktop caller remain pending.

**Frontend seam:** `STUDIO/src/features/chat/session/useChatSession.ts` is
already the single seam — everything above it codes against a `ChatSession`
interface and knows nothing about transport. Connecting the harness is an edit
to that one file plus deleting `features/chat/demo/`. Nothing else in the app
may import from `demo/`.

---

## Harness layout

Established, not proposed. See `STUDIO HARNESS/src/`.

```
agents/          agent definitions (defineAgent)
application/     domain services and runtime composition
admission/       inbound Harness client authentication (ADR 0028)
transport/       HTTP route composition and framework adapters
auth/            sign-in, sessions
context/         context assembly
contracts/       shared types, model ids, and the one effect table (ADR 0020)
credentials/     keychain-backed, via @napi-rs/keyring
extend/          what can be added — MCP servers, skills, hooks — over one spine
                 mcp/ has two channels; nothing above them knows which is in use
models/          registry, adapters (test / local BYOK / studio-cloud), catalog
net/             destination.ts - every outbound address is checked here first
                 http.ts        - the only place we open a connection ourselves
observability/   OpenTelemetry, error contract, the redaction catalog
permissions/     the kernel — decides, never executes, never prompts
platform/        OS specifics
process/         exec.ts — the only place a child process starts
retrieval/       web search and page reading providers - two slots, never a pool
sandbox/         isolation tiers
snapshots/       shadow git per project — the undo history
storage/         SQLite, versioned migrations
tools/           filesystem, search, git, shell, web — all behind one CallGate
vendor/          bundled binaries, installation-relative resolution
```

### What we own, restated

Flue owns the loop, durability, compaction, and sandbox primitives. Pi owns
providers and cache placement. **We own the policy layer**, and that is where
the product lives:

- which tools are always-loaded vs. discoverable, and the `tool_discover` filter
- the `expandedTools` session set (mental-model §3.4)
- the MCP / connector / skill inventory rendered as plain English
- the permission kernel and `CallGate`
- the registry, secrets, vendored binaries, error contract
- the entire desktop application

---

## Where things live at runtime

Three locations, decided once in ADR 0014. Nothing resolves against the working
directory.

- **Installation** — read-only. Vendored binaries resolve here, never against
  cwd. A cwd-relative lookup would let any repository ship its own `rg.exe`.
- **`~/.studio/`** — ours, writable, six categories. Snapshots live in
  `~/.studio/data/snapshots/`, outside the project.
- **The project** — belongs to the user.

---

## Build order

The harness continues on its own roadmap; the app connects at the end.

| Phase | | Status |
|---|---|---|
| 1–8 | foundation, loop, persistence, observability, providers, gateway, auth | done |
| 9 | permission and containment kernel | foundation done |
| 10 | native tools | implemented in dirty tree; local/manual posture |
| 11 | MCP and audit remediation | **in progress** |
| 12 | Skills | |
| 13 | Subagents and tasks | |
| 14–17 | projects, memory, workflows, evals | |
| 18 | product integration — the frontend seam | |

**The chain is clear** — snapshots, call bounds, trust/modes, native registrars,
and the P1/P2 MCP/permission remediation are source-backed in the dirty tree.
Task 007 records the remaining listener/Host, Gateway wire, restart-durability,
and intentionally deferred product boundaries.

**Do C-01 and C-02 together**, once MCP lands and a real multi-turn session with
discovery can run. They measure whether the Flue/Pi bet holds, and they are
cheap to run and expensive to skip.

The dogfooding rule stands: if STUDIO is not being used for real work shortly
after Phase 18, cut scope rather than add.
