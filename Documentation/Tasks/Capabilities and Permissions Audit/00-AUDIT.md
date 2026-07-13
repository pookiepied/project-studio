# Capabilities & Permissions Audit

**Status:** Audit / design. No code changed yet.
**Scope:** How local skills + MCP servers + the main agent connect today, where the
permission model has gaps, and the fix design for four discrete workstreams (A–D).
**Decisions locked with the user:** write this audit before any code; Scope A
escalation grants **full machine-wide** access (reuse the existing global-access gate).

---

## 0. TL;DR

- The **Local Runtime relay is generic, not MCP-specific.** It carries any tool call
  the cloud agent defers to the client, sorted into three buckets: builtins, local
  MCP tools, and unknown.
- **Skills are content, not executables.** They never travel the relay. They are
  deployed to disk + registered as metadata, and surfaced to the agent as *read*
  tools (`skill_read`, `skill_list`, …) exposed by the `studio-skills` cloud worker
  through the `studio-mcp` hub.
- **Third-party / locally-installed MCP servers work through the relay** — but a
  hardcoded 2-name whitelist in the permission layer means they (a) bypass the
  permission gate and (b) leak into cloud conversations they can't execute in. This
  is the root of the "the LLM sees the tool but can't run it" symptom.
- The **registry → context → main-loop** model the user described is the **V2
  target**, partially built (`V2/registry`, `V2/context`, `V2/execution-runtime`
  exist as folders) but not the deployed path.

Four workstreams fall out of this, in recommended order:

| ID | Title | Risk | Size |
|----|-------|------|------|
| **C** | Registry-driven local-server identity (fixes see-but-can't-execute) | Low | S–M |
| **A** | Out-of-project → machine-wide escalation | Low | S |
| **B** | MCP-management + skill-management permission kinds (+ UI) | Med | M |
| **D** | Context-driven tool/capability pool (V2) | High | L |

---

## 1. How it works today

### 1.1 The Local Runtime relay is tool-shaped, not MCP-shaped

Everything the cloud agent hands back to the desktop rides one wire
(`local_tools_pending` → `tool_results`, defined in
[STUDIO/src/runtime/protocol.ts](../../../STUDIO/src/runtime/protocol.ts)). The
desktop entry point is
[executeLocalTools.ts](../../../STUDIO/src/runtime/execution/executeLocalTools.ts),
whose `executeSingleTool` (line 110) sorts each call into **three buckets**:

1. **Builtins** — no `server` field; run in-process:
   `task_write`, `spawn_agent`, `ask_user_question`, `get_location`
   ([builtinTools.ts](../../../STUDIO/src/runtime/execution/builtinTools.ts)).
2. **MCP tools** — has `tc.server`; routed to a Tauri subprocess via `invokeMcpTool`,
   gated by the permission engine (§1.4).
3. **Unknown** — returns a structured "use the Harness tools" error (line 126).

**Consequence:** the subsystem does not care whether a capability is "MCP." Its only
routing questions are *is this a builtin?* and *does it carry a `server` id?* Any
future local capability can ride the same channel by taking one of those two shapes.

### 1.2 Skills are a different animal — they don't use the relay

A skill is a **playbook (SKILL.md), not an executable tool.** Flow
([skillDeployer.ts](../../../STUDIO/src/core/skills/skillDeployer.ts),
[skills/wrangler.toml](../../../skills/wrangler.toml)):

1. Bundled skills ship inside the app binary (Vite `import.meta.glob('?raw')`).
2. On launch, `deployBundledLocalSkills()` writes them to `$HOME/.studio/skills/`
   and registers **metadata** via `POST /v1/skills/local` → `studio-skills` → D1.
   *Local skill content is never uploaded — only manifests.*
3. The `studio-skills` worker exposes `skill_read`, `skill_list`, `skill_search`,
   `skill_validate`, `skill_register_local`, `skill_unregister_local`,
   `skill_install_plan` as **MCP tools through the studio-mcp hub**, advertised to
   **both** the main agent and sub-agents (one tool path everywhere).

So "using a skill" = the agent calls `skill_read` (a cloud-hub tool) to pull the
SKILL.md text into context; the *work* the skill describes is then executed with real
tools (harness, computer-use, …).

**Design implication:** skills need a reliable *catalog surface* and reliable *read
tools in the agent's tool list* — not the Local Runtime. When we later add "create a
skill" as an agent action, that is a **write** and belongs behind the
skill-management permission (Scope B).

### 1.3 Third-party / locally-installed MCP servers

These **do** use the relay:

1. A local server registers in the Tauri local registry
   ([localRegistry.ts](../../../STUDIO/src/core/mcpRegistry/localRegistry.ts):
   `local_registry_list`, `local_registry_sync_payload`).
2. Its tool manifest is pushed to cloud KV
   ([manifestSync.ts](../../../STUDIO/src/runtime/servers/manifestSync.ts) →
   `MCP_KV`), which is what the cloud agent reads to know a tool exists.
3. The agent picks a tool → it comes back as `local_tools_pending` with a `server` id
   → `invokeMcpTool` talks to the subprocess.

### 1.4 The permission engine

Single decision point:
[engine.ts](../../../STUDIO/src/core/permissions/engine.ts) `evaluateToolCall` — a
**pure** function (trusted context in, decision out). Enforced at the execution
boundary in `executeMcpTool`
([executeLocalTools.ts:161](../../../STUDIO/src/runtime/execution/executeLocalTools.ts:161)).
Decision order:

1. **Cloud scope** — a local server called from a cloud conversation → `deny`.
2. **Enablement** — a disabled server → `deny`.
3. **Global access required** — a *global* (no-project) chat using a root-bounded
   server → `prompt` (full-screen grant gate).
4. **Placement** — a path outside granted roots → `deny` in a project chat, or the
   global-access `prompt` in a global chat.
5. **Trust** — an untrusted project workspace mutating → `deny`.
6. **Approval** — risk-class × action-mode (review/autonomous) →
   `allow` or `prompt`. Risk classes live in
   [toolRisk.ts](../../../STUDIO/src/core/permissions/toolRisk.ts) (Harness 33 tools,
   Computer Use 116 tools; unknown tools **fail safe to `high-risk`**).

**Two identity constants drive all of this** — and are the seed of Scope C:

```
scope.ts:26    LOCAL_MCP_SERVER_NAMES = { "studio-harness", "computer-use" }
engine.ts:161  isRootBoundedServer(server) => server === "studio-harness"
```

### 1.5 The cloud tool list (where see-but-can't-execute originates)

[buildChatBody.ts:24](../../../STUDIO/src/runtime/capabilities/buildChatBody.ts:24):

```ts
const scopedMcpServers = filterMcpServersForConversationScope(runningMcpServers, storageScope);
// ...
running_mcp_servers: scopedMcpServers,
```

`filterMcpServersForConversationScope` only strips servers for which
`isLocalMcpServer()` is true — i.e. only `studio-harness` and `computer-use`. Every
other running server (including a third-party local MCP) is advertised to the cloud
agent **in every scope**.

### 1.6 Registry → context → main loop (today vs. target)

- **Today:** local registry (Tauri) → cloud (`studio-registry` D1 + manifests in
  `MCP_KV`). The main loop is the `chat` ChatAgent, reading manifests from KV and
  routing execution through the `studio-mcp` hub. No context worker in the live path.
- **Target (V2, not deployed):** `studio-registry` → `V2/context` (assembles the
  tool/capability pool) → `V2/execution-runtime` (the "main agent loop"). Folders
  exist; the context-driven pool is not wired to production. This is Scope D.

---

## 2. Findings (the gaps)

### F1 — Third-party local MCP bypasses the permission gate  *(→ Scope C)*
Because `isLocalMcpServer()` only knows two names, a locally-installed third-party
server returns `false`, so the entire permission block in `executeMcpTool` is
**skipped** — it runs with no approval, no risk classification, no root bounding.

### F2 — Third-party local MCP leaks into cloud conversations  *(→ Scope C)*
Same root cause via `filterMcpServersForConversationScope`
([§1.5](#15-the-cloud-tool-list-where-see-but-cant-execute-originates)): a
machine-bound server is advertised to a cloud chat, the model calls it, and execution
fails (or is silently impossible). **This is the "LLM sees the tool but can't run it"
symptom.** It is a data/identity bug, not a new-feature gap.

### F3 — No escalation path out of a project folder  *(→ Scope A)*
In a *project* chat, a path outside the granted roots is a hard
`deny("out_of_roots")` ([engine.ts:113](../../../STUDIO/src/core/permissions/engine.ts:113)).
Only *global* (no-project) chats get the `global_access_required` prompt + grant gate.
A project chat that needs to touch one thing outside its folder (e.g. clone a repo
elsewhere) simply fails, and the user has no way to grant.

### F4 — No management-permission class  *(→ Scope B)*
Risk is per-tool only. There is no permission kind for "install/manage an MCP server"
or "create/modify a skill." The user wants one-time consent that then covers all
related management operations, split into two distinct kinds (MCP vs. skill).

### F5 — Capability pool is not unified  *(→ Scope D)*
Registry entries, bundled/local skills, and third-party/vendor MCPs are not assembled
into one pool the main agent and sub-agents draw from on demand. Sub-agents should get
curated slices by task. This is the `V2/context` job, not yet in the live path.

---

## 3. Fix designs

### Scope C — Registry-driven local-server identity  *(do first)*
**Goal:** eliminate the hardcoded whitelist so local-vs-cloud identity and root
bounding come from registry data (transport/type), fixing F1 + F2 together.

- Replace `LOCAL_MCP_SERVER_NAMES` (a constant) with a lookup over the local registry
  record: a server is "local" when it has a local transport/type
  ([localRegistry.ts](../../../STUDIO/src/core/mcpRegistry/localRegistry.ts)
  `LocalRegistryRecord.transport`).
- Feed that identity into **both** consumers: `isLocalMcpServer` (scope filtering in
  `buildChatBody`) and the permission gate in `executeMcpTool`.
- Decide root-bounding by capability class, not by the literal name `studio-harness`
  (a filesystem-capable local server should be root-bounded regardless of name).
- Keep the fail-safe: unknown local tools stay `high-risk`; an unclassified
  third-party tool must **prompt**, never silently run.
- **Verify:** a locally-installed third-party MCP is (a) hidden from cloud chats and
  (b) permission-gated in local chats.

### Scope A — Out-of-project → machine-wide escalation
**Goal:** a project chat reaching outside its roots offers the **same full-screen
machine-wide grant** the global chat already uses, instead of a hard deny.
**Decision locked: escalation grants full global/machine-wide access.**

- In [engine.ts:113](../../../STUDIO/src/core/permissions/engine.ts:113), change the
  project-context `out_of_roots` branch from `deny` to the existing
  `global_access_required` `prompt` (the branch above it at line 106 already does this
  for global chats — extend it to the project case).
- The execution side already handles this: `executeMcpTool` renders the
  `global_access` approval and calls `cb.requestGlobalAccess()`
  ([executeLocalTools.ts:172-214](../../../STUDIO/src/runtime/execution/executeLocalTools.ts:172)).
  Reuse verbatim; no new grant type needed.
- Copy: "This is outside the open project. Grant machine-wide access to continue?"
- **Verify:** a project chat asking to write outside its folder shows the grant gate;
  granting persists a global grant and the call proceeds.

### Scope B — MCP-management + skill-management permissions
**Goal:** two new permission kinds gating management actions, each with its own
approval card. One approval covers all related ops for that kind (per the user).

- Add two permission kinds (`mcp_management`, `skill_management`) alongside the
  existing tool/global-access kinds
  ([model.ts](../../../STUDIO/src/core/permissions/model.ts),
  [types/tools.ts](../../../STUDIO/src/types/tools.ts) `approvalKind`).
- Gate the management tools: MCP install/enable/register
  ([registryClient.ts](../../../STUDIO/src/core/mcpRegistry/registryClient.ts),
  `local_registry_*` invokes) and skill write tools (`skill_register_local`,
  `skill_unregister_local`, future `skill_create`).
- **UI:** reuse the existing components — `ComposerApprovalCard`
  ([ComposerApprovalCard.tsx](../../../STUDIO/src/features/permissions/components/ComposerApprovalCard.tsx))
  / `ToolPermissionCard`
  ([ToolPermissionCard.tsx](../../../STUDIO/src/runtime/ui/ToolPermissionCard.tsx))
  hosted by
  [PermissionLayerHost.tsx](../../../STUDIO/src/features/permissions/PermissionLayerHost.tsx)
  — with two new card variants and imagery (moon/ocean/sky set or equivalent).
- **Not** global permission: scoped to management actions only, granted once, then
  reused for related operations that session.
- **Verify:** first management action prompts once; subsequent related ops proceed
  without re-prompting.

### Scope D — Context-driven tool/capability pool  *(V2, own project)*
**Goal:** wire `V2/context` to assemble one pool from registry + skills + vendor MCPs,
served to the main loop and to sub-agents as curated slices. Large and architectural;
sequence after A–C stabilize the identity + permission foundation. Cross-reference the
existing V2 handoff (`Documentation/V2-COMPLETION-HANDOFF.md`).

---

## 4. Recommended sequence

**C → A → B → D.** C is the highest-leverage, lowest-risk fix and directly resolves
the reported "visible but broken" errors. A is small and reuses an existing flow. B is
net-new user-facing surface but self-contained. D is the V2 architecture and should be
its own project once the foundation is solid.

---

## 5. Implementation log

### Scope C — DONE (registry-driven local-server identity)
Discovered during implementation that the bug was worse than F1/F2 described: the
bundled catalogue ([catalog.ts](../../../STUDIO/src/runtime/servers/catalog.ts))
already had **five** local subprocess servers, but `scope.ts` recognised only two —
so `mcp-management`, `skill-management`, and `skill-execution` were leaking into cloud
conversations and bypassing the gate.

Changes:
- **[scope.ts](../../../STUDIO/src/core/permissions/scope.ts):** replaced the hardcoded
  2-name whitelist with a runtime-synced `localMcpServerNames` set (seeded with the
  two always-on floor names) + `setLocalMcpServerNames()`. Added
  `isSystemManagedMcpServer()` for the three first-party system servers.
- **[buildChatBody.ts](../../../STUDIO/src/runtime/capabilities/buildChatBody.ts):**
  `refreshLocalMcpIdentity()` unions the bundled catalogue names with the live
  `mcp_list_running` set and syncs it into the permission layer on every request
  build (the single choke point all send paths funnel through). Everything the client
  runs as a local subprocess is machine-bound, so identity is now data-driven.
- **[engine.ts](../../../STUDIO/src/core/permissions/engine.ts):** `isRootBoundedServer`
  now derives from `isLocalMcpServer` minus a known non-filesystem set
  (computer-use + the three system servers), instead of the literal `studio-harness`.
  Behaviour-preserving for current servers; future third-party local servers fail safe
  to workspace-confined.
- **[executeLocalTools.ts](../../../STUDIO/src/runtime/execution/executeLocalTools.ts):**
  the per-tool risk gate now skips `isSystemManagedMcpServer` servers. Their approval is
  deferred to Scope B's system-management permission; until then they keep their current
  ungated local behaviour (no regression) while still being stripped from cloud chats.

**Net effect:** F2 (cloud leak) fixed for all five local servers. F1: genuinely
third-party local servers are now gated (fail-closed to `mcp_disabled` until they have
an enablement path — see follow-up). Bundled system servers unchanged locally.

Verified: `npm run typecheck` (0 errors), `ratchet:cycles` (no new cycles),
`ratchet:lint` (no new errors).

**Follow-up for Scope B:** a genuinely third-party local MCP currently fails closed
(`mcp_disabled`) because `getLocalMcpServer` returns undefined → `mcpEnabled: false`.
Safe, but it needs a real enablement path when third-party install / Scope B lands.

### Scope A — DONE (out-of-project → machine-wide escalation)
**Decision:** escalate to full machine-wide (reuse the existing global-access gate).

- **[engine.ts](../../../STUDIO/src/core/permissions/engine.ts) rule 3:** a project
  chat whose tool targets a path outside its granted root(s) now returns the
  `global_access_required` prompt (previously a hard `deny("out_of_roots")`), matching
  what a global chat already did. The model can't self-escalate — the grant is an
  explicit user action — and once granted the rule is skipped via the `hasGlobalGrant`
  short-circuit, so the call continues through normal trust + approval checks.
- **[model.ts](../../../STUDIO/src/core/permissions/model.ts):** removed the now-unused
  `out_of_roots` deny code from `PermissionDenyCode`.
- No executor change needed: `executeLocalTools` already renders the full-screen
  `global_access` grant gate and calls `requestGlobalAccess` for this code, regardless
  of project/global context.

**Note:** trust (rule 4) is unchanged and orthogonal — a *mutating* action still
requires a trusted workspace even after a global grant; that's the existing
workspace-trust axis, not something Scope A alters.

Verified: `typecheck` (0 errors), `ratchet:cycles` + `ratchet:lint` (no new). Not
browser-observable (permission-engine logic), so no preview verification applies.

### Scope B — IMPLEMENTED (mcp-management + skill-management permissions) — type gate pending
Two category-wide management permissions gate the first-party system servers that
Scope C deferred. One grant covers every operation of that category ("this chat" or
"always"). `skill-execution` stays ungated (reading/running skills is usage, not
management).

- **[model.ts](../../../STUDIO/src/core/permissions/model.ts):** new `ManagementKind`
  (`"mcp" | "skill"`).
- **[scope.ts](../../../STUDIO/src/core/permissions/scope.ts):** `managementKindFor(server)`
  → `"mcp"` (mcp-management), `"skill"` (skill-management), `null` (skill-execution).
- **[grants.ts](../../../STUDIO/src/core/permissions/grants.ts):** session + persisted
  (`mgmtGrant:global:<kind>`) management grants — `hasManagementGrant`,
  `recordManagementGrant`, `listManagementGrants`, `revokeManagementGrant`; cleared by
  `clearSessionGrants` / `clearAllPermissions`.
- **[executeLocalTools.ts](../../../STUDIO/src/runtime/execution/executeLocalTools.ts):**
  the gate now branches — system-managed servers hit a management-approval flow
  (`requestManagementAccess(kind)` + full-screen gate + timeout), everything else keeps
  the risk engine. Replaces Scope C's blanket skip.
- **[ManagementAccessModal.tsx](../../../STUDIO/src/features/permissions/components/ManagementAccessModal.tsx)**
  (new): full-screen split-panel gate mirroring `GlobalAccessModal`, per-kind imagery
  (`/moon.png` MCP, `/flower.png` skills) + copy, and a "this chat / always / not now"
  choice.
- Wiring: `requestManagementAccess` threaded ChatProvider → useStreamHandlers →
  toolExecutionCallbacks → executor (parallels `requestGlobalAccess`); modal rendered in
  ChatProvider next to `GlobalAccessModal` (imported via direct path to avoid the
  permissions↔chat barrel cycle). ChatPage keeps management kinds out of the composer
  card; `usePermissionNotifications` gives them a toast body and refocus-only action.

**Verification pending:** the Anthropic build/command classifier was temporarily
unavailable at implementation time, so `typecheck` / `ratchet` could not be run. All
files were reviewed manually for type + wiring correctness; the gate must be run once
the environment recovers before this is considered green.

**Follow-up:** surface `listManagementGrants` / `revokeManagementGrant` in the Settings →
Permissions panel (functions exist; panel wiring not done).
