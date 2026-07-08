# Studio Settings Architecture Review and Redesign

Date: 2026-06-25

Status: Architecture decision draft

Primary source: current codebase audit. Codex settings were used only as comparative research, not as a template to copy.

## Executive Decision

Studio should stop treating Settings as a collection of feature controls. Settings should become the product's operating policy layer: the place where users understand identity, defaults, data, safety, local access, integrations, execution, and workflow behavior.

The current settings categories should be retired over time. They are useful as an inventory, but they are not the right long-term architecture.

The target architecture should organize settings around systems and workflows:

1. Account & Sync
2. Workspaces & Projects
3. Intelligence & Models
4. Assistant Behavior
5. Memory & Knowledge
6. Voice & Audio
7. Interface & Accessibility
8. Commands & Shortcuts
9. Apps & Integrations
10. Local Devices & Remote Access
11. Execution & Developer Workflow
12. Safety & Privacy
13. Usage & Billing
14. Admin & Governance

These are not just UI labels. Each category should own a durable settings domain, storage scope, search vocabulary, policy behavior, and future growth path.

## Key Product Decisions

### Work Modes

Do not add Codex-style global "work modes" as a primary concept.

Studio already has projects, conversations, project access modes, model tiers, tools, memory, apps, and local devices. A global mode would become another ambiguous layer. The better design is:

- Project profile: default tools, model, permission posture, memory behavior, local access, and preferred environment.
- Conversation mode: temporary turn-level behavior such as Review vs Autonomous.
- Task mode: scoped agent behavior such as plan, code, research, review, or browser task.

Decision: no global work mode in Settings. Add project profiles and conversation/task modes instead.

### Permissions

Studio should have global permission defaults, but they should be defaults, not hidden state that silently overrides projects.

Decision:

- Settings should expose a default autonomy level.
- Project settings should override the default.
- Conversation controls should override project defaults for the active conversation.
- Users should be able to disable high-risk autonomy levels entirely.
- Admin policy should be able to lock risk levels, local access, browser access, and data retention.

The current `autopilotMode` is persisted globally but `ChatPage` overwrites it from project access mode. That is a design smell. It should become a project/session value with a global default.

### Codex Hooks Equivalent

Codex hooks are lifecycle scripts around agent events such as prompt submission, permission requests, tool use, compaction, subagent start/stop, and turn stop. Studio should not expose this as a normal user setting today.

Decision:

- Add an advanced "Rules & Hooks" system later for teams and power users.
- First build safer primitives: tool policies, allow/deny rules, audit log, and permission profiles.
- Hooks should require review, trust, versioning, and clear source display.

### Pairing vs Connections

Pairing and connections must be separate.

Logging into Studio Web must not automatically grant remote execution rights on a desktop machine. Device pairing should establish cryptographic trust. Connections should represent active use of a trusted device.

Decision:

- Pairing: identity, cryptographic verification, device trust, revocation.
- Connections: active sessions, online/offline state, remote execution, handoff, reconnect.
- SSH: infrastructure access, separate from personal device pairing.

### Language and Internationalization

Do not ship a fake language dropdown that only changes a few strings.

Decision:

- Phase 1: add the settings schema and language preference, but keep UI language as English until the i18n framework is real.
- Phase 1 should allow separate controls for AI response language, transcription language, and UI language.
- Phase 2 UI localization candidates: Bangla, Hindi, Spanish, Portuguese, Japanese, Korean.
- Phase 3: Arabic and Chinese variants after typography, layout, RTL, IME, and QA infrastructure are ready.

### Pets

Do not add AI pets. They do not fit Studio's current product direction.

### MCP Naming

Keep "Apps" as the user-facing term. Use "MCP" only in advanced/developer details.

Decision: Settings should say "Apps & Integrations"; implementation details can say MCP inside advanced panels.

## Source Audit

The active Settings route is rendered from `STUDIO/src/pages/HomePage.tsx` into `STUDIO/src/pages/SettingsPage.tsx`.

Regular settings flow:

- `STUDIO/src/contexts/SettingsContext.tsx`
- `STUDIO/src/services/storage/configService.ts`
- `STUDIO/src/services/storage/fileConfigService.ts`
- local `STUDIO.conf` through unified storage

Main settings type:

- `STUDIO/src/types/index.ts`
- interface `AppSettings`

Cloud preferences are narrower:

- `workers/Studio/src/types.ts`
- `workers/Studio/src/routes/preferences.ts`
- `workers/Studio/schema.sql`

Cloud currently groups preferences as:

- `models`
- `ui`
- `behavior`

This is too narrow for future multi-device Studio.

## Phase 1 - Current Settings Audit

### Current Settings Categories

Current visible categories in `SettingsPage`:

- Account block
- AI Models
- Voice & Audio
- Appearance
- Shortcuts & Pulse
- Local AI
- Apps & Extensions link
- hidden Developer Tools panel

Current settings are stored in a flat `AppSettings` object. Some critical states live outside `AppSettings`, including local system access permission, MCP server registry state, Composio connections, project access mode, Faster Whisper config, and backend/admin mode configuration.

### Exposed Settings Inventory

| Setting | Current Location | Backing State | Purpose | Placement Verdict |
|---|---|---|---|---|
| Default Chat Model | AI Models > Models | `defaultChatModel` | Default model for chat conversations | Keep under Intelligence & Models |
| Rephrase Model | AI Models > Models | `rephraseModel` | Model used to rephrase transcribed text | Keep under Intelligence, cross-link from Voice |
| Transcription Model | AI Models > Models | `transcriptionModel` | Speech-to-text model | Keep under Intelligence, show summary in Voice |
| Text-to-Speech Model | AI Models > Models | `ttsModel` | Text-to-speech model | Keep under Intelligence, show voice-specific options in Voice |
| Image Generation Model | AI Models > Models | `imageModel` | Default image generation model | Keep under Intelligence & Models |
| Video Generation Model | AI Models > Models | `videoModel` | Default video generation model | Keep under Intelligence & Models |
| Microphone | Voice & Audio | `selectedMicrophone` | Audio input device | Correct |
| Enable VAD | Voice & Audio | `vadEnabled` | Skip silent chunks | Correct |
| Silence Threshold | Voice & Audio | `vadSilenceThreshold` | VAD sensitivity | Correct |
| Auto-rephrase | Voice & Audio | `autoRephrase` | Automatically rewrite transcribed text | Correct |
| Rephrase Tone | Voice & Audio | `rephraseTone` | Tone for rephrased text | Correct |
| Appearance | Appearance | `theme`, `localStorage["studio-theme"]` | Light/dark mode | Correct, but incomplete |
| Show Notifications | Appearance | `showNotifications` | Desktop/task notifications | Move to Interface > Notifications |
| Background Chat Alerts | Appearance | `notifyConversationDone` | Notify when background chat finishes | Move to Interface > Notifications |
| Minimize to Tray | Appearance | `minimizeToTray` | Intended desktop close/tray behavior | Move to Interface > Desktop App; currently not fully wired |
| Start on Boot | Appearance | `startOnBoot`, `AutostartService` | Launch at OS startup | Move to Interface > Desktop App |
| Recording Hotkey | Shortcuts & Pulse | `recordingShortcut` | Global transcription shortcut | Move to Commands & Shortcuts |
| Voice AI Hotkey | Shortcuts & Pulse | `voiceShortcut` | Global live voice shortcut | Move to Commands & Shortcuts |
| Voice Volume | Shortcuts & Pulse | `voiceVolume` | TTS playback volume | Move to Voice & Audio |
| Floating AI Status Overlay | Shortcuts & Pulse | `showFloatingIsland` | Pulse overlay on/off | Move to Interface > Pulse Overlay |
| Overlay Opacity | Shortcuts & Pulse | `overlayOpacity` | Idle overlay opacity | Move to Interface > Pulse Overlay |
| Local System Access | Local AI > System Integration | `localStorage["studio-harness-permission"]` plus MCP server lifecycle | Enables local files, terminal, desktop, system, and network access | Move out of Local AI into Local Devices & Safety |
| Enable Local Provider Bridge | Local AI > Local Server | `localProviderEnabled` | Enables local model bridge daemon | Keep under Local Devices > Local AI |
| Server Port | Local AI > Local Server | `localProviderPort` | Local provider bridge port | Keep under Local Devices > Local AI |
| Enable Ollama | Local AI > Local Models | `ollamaEnabled` | Include/discover Ollama models | Keep under Local Devices > Local AI |
| Enable LM Studio | Local AI > Local Models | `lmstudioEnabled` | Include/discover LM Studio models | Keep under Local Devices > Local AI |
| Enable Faster Whisper | Local AI > Local Transcription | `fasterWhisperEnabled` | Local transcription engine | Move to Voice & Audio > Local Transcription, with Local AI cross-link |
| Faster Whisper selected model | Local AI > Faster Whisper status | Faster Whisper config service | Select installed local transcription model | Move to Voice & Audio > Local Transcription |

### Persisted But Not Properly Exposed

| State | Current Storage | Problem | Target Home |
|---|---|---|---|
| `apiBaseUrl` | `AppSettings` / `STUDIO.conf` | Persisted but not visible in Settings | Advanced > API & Endpoints |
| `ollamaBaseUrl` | `AppSettings` / `STUDIO.conf` | Persisted but no UI | Local Devices > Local AI > Ollama |
| `lmstudioBaseUrl` | `AppSettings` / `STUDIO.conf` | Persisted but no UI | Local Devices > Local AI > LM Studio |
| `autopilotMode` | `AppSettings` / `STUDIO.conf` | Global persisted state conflicts with project access mode | Safety & Permissions as default only |
| Local system access grant | localStorage | Security-critical trust state is not in the settings schema | Local Devices > Studio Local plus Safety policy |
| Project access mode | project context | Correct concept, but not represented as project setting | Workspaces & Projects > Project Defaults |
| MCP servers | MCP service/backend/Tauri state | Split between Apps page, popover, Settings toggle | Apps & Integrations plus Local Devices |
| Faster Whisper model/device/install state | Faster Whisper config | Deeply hidden | Voice & Audio > Local Transcription |
| Admin model modes | Manage page/backend | Admin-only, separate from user model defaults | Admin & Governance |

### Non-Setting Controls Currently Inside Settings

These should remain accessible, but they are not settings:

- Sign in / sign out
- Model refresh
- Active provider status
- Apps & Extensions navigation
- Local provider bridge status
- Faster Whisper install/download/delete actions
- Developer Tools: diagnostics, export settings, export diagnostics, reset

Decision: keep operational controls near their settings when useful, but mark them as actions, not preferences. Important actions should also be searchable from the command palette.

## Phase 2 - Gap Analysis

### Professional Feature Gaps

| Area | Current State | Gap | Decision |
|---|---|---|---|
| Settings schema | Flat `AppSettings`, narrow cloud preferences | No versioned multi-scope settings model | Build `settings_v2` with registry metadata and migration |
| Search | Hard-coded term matching in `SettingsPage` | Search is not generated from settings metadata | Build indexed settings search from registry |
| Keyboard shortcuts | Command palette Ctrl/Cmd+K plus two global shortcuts | No full shortcut manager, conflict detection, or command registry | Add Commands & Shortcuts |
| Command palette | Hard-coded actions | Not linked to settings registry or app command registry | Build central command registry |
| Appearance | Light/dark only | No system theme, presets, fonts, density, contrast, reduced motion | Expand Interface & Accessibility |
| Accessibility | Mostly absent | No text scale, motion, contrast, focus visibility, screen reader behavior | Add Accessibility section |
| Language | Cloud type has `language`, UI does not expose it | No real i18n strategy | Add language schema first, UI localization later |
| Models | User defaults exist | No provider disable/preference, reasoning defaults, fallback policy | Expand Intelligence & Models |
| Personality | Static prompts | No user personality/verbosity/global instructions UI | Add Assistant Behavior |
| Memory | Memories page exists; backend auto-injects/processes | No global memory on/off, retention, category, export, forget-all | Add Memory & Knowledge plus Privacy controls |
| Permissions | Review/autonomous exists in chat/project context | No global defaults, per-tool policy, disable high-risk modes | Add Safety & Permissions |
| Local access | Single Local System Access toggle | No server-level scope, tool-level scope, audit, recovery controls | Add Studio Local settings |
| Browser/computer use | Pages and tools exist | No browser allow/deny domains, real-browser policy, screenshot retention | Add Browser & Computer Use policy |
| Git | Tooling exists in Studio Local | No Git settings, branch prefix, PR behavior, worktree policy | Add Developer Workflow > Git |
| Terminal | PTY exists | No shell selection, terminal profiles, environment variables, startup scripts | Add Developer Workflow > Terminal |
| Environments | Local provider/daemon exists | No environment profiles, sandbox providers, E2B/self-hosted options | Add Execution Environments |
| Sandbox | Not a first-class Studio system | No execution boundary model | Add sandbox profiles before expanding autonomy |
| Device pairing | Not present | Web-to-desktop remote execution has no trust model | Add Pairing |
| SSH | SSH tools exist | No named profiles, key storage, known-hosts, revoke | Add Remote Access |
| Usage | Activity page exists | No budgets, alerts, export, billing preferences | Add Usage & Billing |
| Notifications | Two toggles | No event matrix, permission-needed controls, DND | Add Notifications matrix |
| Admin | Manage page has whitelist/model modes | No policy locks, roles, audit, org settings | Add Admin & Governance |

### Missing Accessibility Features

Minimum professional baseline:

- System theme
- Reduced motion
- High contrast
- Text scale
- Code font size
- UI font size
- Terminal font size
- Focus ring visibility
- Keyboard navigation behavior
- Compact/comfortable density
- Screen reader labels for settings controls

### Missing Customization Features

Recommended:

- Theme mode: system, light, dark
- Theme presets: Studio, GitHub, VS Code, Linear, Solarized
- Accent color
- UI font
- Code font
- Terminal font
- UI density
- Chat density
- Composer behavior
- Enter-to-send behavior
- Default page on launch
- Default file/folder open destination

### Missing Developer Tooling

Recommended:

- Shell selection: PowerShell, Command Prompt, Git Bash, WSL, custom
- Terminal profiles
- Environment variables by profile/project
- Startup scripts
- Git branch prefix
- Commit message style
- Pull request defaults
- Push/force-push policy
- Worktree management
- Sandbox profiles
- Local/remote environment providers
- File open destination
- Log retention and diagnostics export

## Phase 3 - Target Settings Architecture

### Architecture Principles

1. Settings are not just preferences. They are defaults, policies, scopes, trust decisions, and operational controls.
2. Every setting must have an owner domain.
3. Every setting must declare its scope.
4. Every setting must declare whether it syncs.
5. Every setting must declare whether admins can lock it.
6. Every high-risk setting must declare a risk level.
7. Search should be generated from settings metadata, not hand-coded terms.
8. Pages should not invent private settings state. They should consume the settings registry or a system-specific store.
9. User-facing naming should describe workflows. Implementation terms such as MCP, KV, D1, and Tauri should stay in advanced details.
10. Feature flags should hide unavailable controls, but unavailable controls should still be discoverable with clear platform messaging where helpful.

### Scope Model

Studio needs multiple settings scopes:

| Scope | Purpose | Examples |
|---|---|---|
| Built-in default | Product fallback | Light theme default, safe permission default |
| Synced user | Follows user across devices | model defaults, personality, shortcuts where portable |
| Device-local | Belongs to one machine | microphone, shell path, local provider URLs, tray behavior |
| Workspace/project | Belongs to a project | trusted folder, repo policy, default autonomy, environment |
| Conversation/session | Temporary runtime override | Review vs Autonomous for current conversation |
| Integration/app | Belongs to an app connection | enabled tools, OAuth status, tool allowlist |
| Admin/org | Governance and locks | disabled full access, retention policy, allowed integrations |

Effective value precedence:

1. Admin/org lock
2. Project/workspace override
3. Conversation/session override, where allowed
4. Synced user default
5. Device-local setting, for device-owned settings only
6. Built-in default

Important: device-local settings should not override synced user settings unless the setting is explicitly device-owned.

### Settings Registry

Every setting should be registered with metadata.

Recommended fields:

```ts
type SettingDefinition = {
  id: string;
  domain: string;
  label: string;
  description: string;
  control: "toggle" | "select" | "number" | "slider" | "shortcut" | "text" | "action" | "table";
  scope: "user" | "device" | "project" | "session" | "integration" | "admin";
  storage: "settings_v2" | "secure_storage" | "project_config" | "integration_registry" | "runtime";
  defaultValue?: unknown;
  sync: "synced" | "local-only" | "not-synced";
  risk: "none" | "low" | "medium" | "high" | "critical";
  policyLockable: boolean;
  platform?: Array<"web" | "desktop" | "windows" | "macos" | "linux">;
  searchTerms: string[];
  replaces?: string[];
};
```

This registry should power:

- Settings navigation
- Settings search
- Deep links
- Import/export
- Reset
- Admin locks
- "Why is this disabled?" messaging
- Settings sync
- Migration from `STUDIO.conf`

### Recommended Top-Level Hierarchy

#### 1. Account & Sync

Purpose: identity, account state, sync, profile summary, device/account relationship.

Subsections:

- Account
- Profile summary
- Sync status
- Connected devices
- Sessions
- Export account data

Include:

- Google account display
- Sign out
- Sync status
- Last sync time
- Device list
- Revoke sessions/devices

Do not duplicate Google profile editing. Link to account provider if needed.

#### 2. Workspaces & Projects

Purpose: project defaults, trusted folders, project profiles, workspace behavior.

Subsections:

- Project defaults
- Trusted folders
- Project profiles
- File opening
- Workspace indexing
- Conversation defaults

Include:

- Default project chat behavior
- Default access mode for new project conversations
- Trusted paths
- Project-specific memory behavior
- Project-specific tools/apps
- Default file open destination
- Workspace indexing scope

This replaces the need for global work modes.

#### 3. Intelligence & Models

Purpose: AI providers, models, model defaults, routing, reasoning defaults.

Subsections:

- Model defaults
- Provider preferences
- Model routing
- Local model visibility
- Reasoning defaults
- Media generation
- Admin-managed modes, shown read-only for non-admin users

Include:

- Default chat model
- Rephrase model
- Transcription model
- TTS model
- Image model
- Video model
- Default reasoning budget
- Provider enable/disable
- Provider priority
- Fallback behavior
- Model cache refresh

Keep the separate Models page as a model catalog, but settings should own defaults and policy.

#### 4. Assistant Behavior

Purpose: how the assistant speaks, reasons, asks questions, follows user preferences, and behaves across conversations.

Subsections:

- Personality
- Custom instructions
- Response style
- Follow-up behavior
- Question behavior
- Context behavior
- Conversation behavior

Include:

- Personality: none, pragmatic, warm, concise, custom
- Verbosity/default answer length
- Global custom instructions
- Project custom instructions
- Follow-up suggestions on/off
- Require confirmation for ambiguous actions
- Default project chat behavior
- Enter-to-send behavior

Decision: mood belongs here only if it affects assistant behavior. Pure visual mood belongs in Interface.

#### 5. Memory & Knowledge

Purpose: persistent memory, knowledge base, recall, retention, user control.

Subsections:

- Memory
- Knowledge base
- Recall behavior
- Retention
- Export/delete
- Local vs cloud memory

Include:

- Enable memory globally
- Enable memory per project
- Cloud memory vs local memory
- Auto-inject memories
- Ask before saving sensitive memories
- Memory categories
- Forget all
- Export memories
- Knowledge base storage limits
- Knowledge base indexing settings

The current Workspace page can remain the management UI for memory facts, documents, and agents. Settings should own memory policy.

#### 6. Voice & Audio

Purpose: dictation, transcription, live voice, TTS, audio devices, local transcription.

Subsections:

- Microphone
- Dictation
- Live voice
- Transcription
- Text-to-speech
- Local transcription
- Audio feedback

Include:

- Microphone
- VAD on/off
- Silence threshold
- Live-session VAD
- Transcription language
- Auto-rephrase
- Rephrase tone
- TTS voice
- Voice volume
- Sound effects
- Faster Whisper enabled
- Faster Whisper model
- Faster Whisper device CPU/CUDA
- Hold-to-dictate behavior
- Dictation dictionary

Move voice volume here from Shortcuts & Pulse.

#### 7. Interface & Accessibility

Purpose: visual UI, desktop app behavior, notifications, overlays, accessibility.

Subsections:

- Appearance
- Theme presets
- Typography
- Layout density
- Accessibility
- Notifications
- Pulse overlay
- Desktop app

Include:

- Theme mode: system, light, dark
- Theme preset
- Accent color
- UI font
- Code font
- Terminal font
- UI font size
- Code font size
- Reduced motion
- High contrast
- Layout density
- Focus ring style
- Notification event matrix
- Pulse overlay on/off
- Pulse opacity
- Start on boot
- Start minimized
- Minimize to tray
- Close behavior

Move notifications here from Appearance, but permission-required alerts should also be represented in Safety.

#### 8. Commands & Shortcuts

Purpose: command palette, keyboard shortcuts, global shortcuts, conflicts.

Subsections:

- Command palette
- Global shortcuts
- App shortcuts
- Chat shortcuts
- Browser shortcuts
- Terminal shortcuts
- Shortcut conflicts

Include:

- Open command palette shortcut
- New chat
- Search conversations
- Open settings
- Open terminal
- Toggle sidebar
- Model picker
- Dictation
- Live voice
- Approve request
- Decline request
- Browser navigation
- Window management
- Reset shortcuts
- Export/import shortcuts

Implementation requires a central command registry. Do not keep hard-coding shortcuts inside individual components.

#### 9. Apps & Integrations

Purpose: connected apps, MCP-compatible servers, OAuth connections, tool defaults.

Subsections:

- Connected apps
- App discovery
- App permissions
- Remote MCP servers
- Local app servers
- OAuth connections
- Tool allowlists
- Integration privacy

Include:

- Installed apps
- Enabled/disabled status
- Per-app tool visibility
- Per-app permission defaults
- Remote MCP add/edit
- Manifest sync status
- OAuth reconnect
- Remove app
- Integration data sharing defaults

The Apps page should remain the main connection/discovery UI. Settings should own defaults and policy.

#### 10. Local Devices & Remote Access

Purpose: trusted devices, Studio Local, desktop/system/network servers, pairing, remote access.

Subsections:

- Device pairing
- Trusted devices
- Studio Local
- Studio Desktop
- Studio System
- Studio Network
- SSH profiles
- Connection status

Include:

- Pair this device
- Trusted device list
- Revoke device
- Studio Local server status
- Enable/disable Harness/Desktop/System/Network separately
- Start local services at app launch
- Auto-restart local services
- Local service health
- SSH profiles
- Known hosts
- Key storage policy
- Remote session audit

Local System Access should move here from Local AI.

#### 11. Execution & Developer Workflow

Purpose: terminal, shell, environments, Git, worktrees, sandbox, repo workflows.

Subsections:

- Terminal
- Shell profiles
- Environment variables
- Local environments
- Sandboxes
- Git
- Pull requests
- Worktrees
- File open behavior
- Logs

Include:

- Integrated terminal shell
- Terminal default directory
- Environment profiles
- Startup scripts
- Sandbox provider: none/local/E2B/self-hosted
- Sandbox filesystem policy
- Sandbox network policy
- Git branch prefix
- Merge strategy
- Commit instructions
- PR instructions
- Draft PR default
- Force push policy
- Worktree cleanup limit
- Auto-delete worktrees
- Copy ignored files policy
- File open destination

Studio already has Git and shell tooling inside Studio Local. Settings should make the policy visible.

#### 12. Safety & Privacy

Purpose: trust, permissions, data handling, local access policy, browser/computer-use policy.

Subsections:

- Agent autonomy
- Tool permissions
- Local access policy
- Browser policy
- Computer use policy
- Data retention
- Secrets and tokens
- Diagnostics and logs
- Audit log

Include:

- Default mode: Review, Ask for sensitive actions, Autonomous within policy
- Disable autonomous mode
- Per-tool policy: allow, ask, deny
- Per-server policy
- Approval timeout
- Reset session approvals
- Real browser access policy
- Website allow/deny list
- Screenshot retention
- Clipboard access policy
- Keyboard/mouse automation policy
- Secret detection
- Token storage status
- Clear local data
- Export data
- Delete data
- Diagnostics upload consent

This should become one of the most important Studio settings domains.

#### 13. Usage & Billing

Purpose: activity, usage, cost, budgets, billing state.

Subsections:

- Usage summary
- Model usage
- Provider credits
- Budgets
- Alerts
- Billing
- Exports

Include:

- Current usage
- Token usage
- Cost estimate
- Local usage reporting toggle
- Provider balances
- Monthly budget
- Provider budget
- Budget alerts
- Export usage
- Billing link

Activity can remain a top-level dashboard, but Settings should own preferences, budgets, and data retention.

#### 14. Admin & Governance

Purpose: team/admin policy, roles, model routing, allowed integrations, compliance.

Subsections:

- Users and roles
- Access policy
- Model routing
- Allowed apps
- Local access policy
- Browser policy
- Retention policy
- Audit logs

Include:

- User whitelist or team members
- Roles
- Admin model modes
- Auto-router mode
- Allowed providers
- Disabled providers
- Allowed apps/integrations
- Tool policy locks
- Memory retention locks
- Usage limits
- Audit log

The existing Manage page should become the role-gated Admin & Governance category or link into it.

## Current-to-Target Migration Map

| Current Area | Target Area | Action |
|---|---|---|
| AI Models | Intelligence & Models | Keep, expand |
| Voice & Audio | Voice & Audio | Keep, expand |
| Appearance | Interface & Accessibility | Rename and split |
| Shortcuts & Pulse | Commands & Shortcuts plus Interface > Pulse | Split |
| Local AI | Local Devices & Remote Access plus Voice & Audio plus Intelligence | Split |
| Local System Access | Local Devices & Remote Access plus Safety & Privacy | Move |
| Apps & Extensions link | Apps & Integrations | Keep as destination, add policy settings |
| Account block | Account & Sync | Promote |
| Developer Tools panel | Advanced / Diagnostics | Keep but make searchable |
| Activity page | Usage & Billing | Keep dashboard, add settings |
| Workspace memory page | Memory & Knowledge | Keep management page, add memory policy |
| Manage page | Admin & Governance | Promote for admins |

## Phase 4 - Studio Systems Review

### Studio Local

Current code starts four local MCP servers together:

- `studio-harness`
- `studio-desktop`
- `studio-system`
- `studio-network`

Current issue: one "Local System Access" toggle grants a very broad capability set. It covers filesystem, terminal, desktop automation, system inspection, network tools, and SSH-like functionality.

Decision:

- Keep Studio Local as the umbrella.
- Expose separate subservices.
- Require separate policy for high-risk categories.
- Store trust state in a durable trusted-device/policy model, not plain localStorage.
- Show health, logs, restart, and auto-start controls.

Target representation:

- Local Devices & Remote Access > Studio Local
- Safety & Privacy > Local Access Policy
- Execution & Developer Workflow > Terminal/Git/Sandbox

### Studio Desktop

Current behavior: desktop automation is available through Studio Local tools.

Decision:

- Represent enablement under Local Devices.
- Represent action policy under Safety.
- Add controls for screen capture, OCR, clipboard, keyboard/mouse automation, window control, screenshot retention, and redaction.

### Studio System

Current behavior: system tools cover process, registry, display, audio, firewall, env vars, apps, startup tasks, and users/groups.

Decision:

- Treat Studio System as high-risk.
- Add category-level policy controls.
- Add audit log and approval history.
- Require explicit user/admin permission for registry, firewall, user/group, process kill, task scheduler, startup changes, and elevation.

### Studio Network

Current behavior: network and SSH tools exist but have no dedicated settings.

Decision:

- Add Studio Network under Local Devices.
- Add SSH profiles with secure credential storage.
- Add known-hosts management.
- Add hosts-file and Wi-Fi/network adapter policy under Safety.

### Apps

Current behavior: Extensions page owns app discovery and connection. Apps popover also starts local services.

Decision:

- Keep "Apps" user-facing.
- Keep Apps page for discovery and connection.
- Move local service lifecycle out of Apps popover over time.
- Settings should expose app defaults, per-app tool policy, integration privacy, and remote MCP management.

### AI Models

Current behavior: model defaults are visible; per-chat tier selection exists; admin model modes exist elsewhere.

Decision:

- Intelligence owns user defaults.
- Admin owns global model routing.
- Local Devices owns local provider endpoints.
- Voice owns voice-specific experience controls.
- Add reasoning budget defaults and provider preferences.

### Voice

Current behavior: audio settings and shortcuts are split.

Decision:

- Voice & Audio owns microphone, dictation, transcription, live voice, TTS, volume, language, and local transcription.
- Commands owns the keyboard shortcuts.
- Intelligence owns the model defaults, with cross-links from Voice.

### Memory

Current behavior: memory is mostly a content-management page and backend behavior, not a settings policy.

Decision:

- Memory & Knowledge owns memory policy.
- Workspace page continues to manage memory facts and knowledge docs.
- Safety & Privacy owns retention, export, delete, and sensitive-memory controls.
- Backend chat pipeline must enforce memory settings.

### Permissions

Current behavior:

- Review vs Autonomous exists in chat/project UI.
- Sensitive tools ask unless autonomous or session-approved.
- `autopilotMode` is persisted but overwritten by project context.

Decision:

- Stop treating `autopilotMode` as a global state toggle.
- Add global default autonomy posture.
- Project access mode owns project behavior.
- Conversation mode owns temporary runtime behavior.
- Tool policy controls should be explicit and inspectable.
- Users can disable Autonomous entirely.
- Admins can lock permission profiles.

## Phase 5 - UX Design

### Navigation

Use a two-level settings layout:

- Left sidebar: category families.
- Main panel: category detail pages.
- Right side or top: search and breadcrumbs.

Suggested family grouping:

- Personal: Account, Interface, Commands, Voice
- AI: Intelligence, Assistant Behavior, Memory
- Work: Workspaces, Execution
- Integrations: Apps, Local Devices
- Governance: Safety, Usage, Admin

This keeps the sidebar scannable even with many categories.

### Search

Settings search must be registry-backed.

Requirements:

- Search labels, descriptions, synonyms, old category names, and implementation terms.
- Searching "MCP" should find Apps & Integrations.
- Searching "autopilot" should find Safety & Permissions.
- Searching "ollama" should find Local AI and model providers.
- Searching "tray" should find Interface > Desktop App.
- Searching "memory delete" should find Memory & Knowledge and Safety & Privacy.
- Search results should show scope badges: Synced, Device, Project, Admin locked.
- Search results should show platform badges: Desktop only, Web only, Windows only.

### Discoverability

Every risky or advanced system should have:

- A short user-facing explanation.
- A "Learn what this allows" disclosure.
- A "View audit log" link where relevant.
- A "Reset to safe defaults" action.
- A clear disabled state when unavailable.

Avoid hiding important security decisions behind friendly wording. "Local System Access" should clearly state which classes of capability it enables.

### Power User Workflows

Required power-user affordances:

- Command palette entries for every settings page.
- Deep links to individual settings.
- Keyboard shortcut manager.
- Import/export settings.
- Reset section to defaults.
- Search by shortcut.
- Search by setting ID.
- Show effective value and source: default, user, device, project, admin.
- Copy diagnostics.
- Open config file.

### Settings Row Design

Every setting row should be able to show:

- Label
- Description
- Control
- Scope badge
- Sync badge
- Risk badge
- Admin lock state
- Platform availability
- Reset action
- Related setting links

This prevents future settings from becoming undocumented toggles.

## Specific Feature Decisions From Codex Comparison

| Codex Area | Studio Decision |
|---|---|
| Work modes | Do not copy globally. Use project profiles and task/conversation modes. |
| Permission defaults | Add global defaults plus project/session inheritance. |
| Full access disable | Add ability to disable high-risk modes. |
| Default file open destination | Add under Workspaces/Execution. |
| Agent environment | Add as Execution Environments, especially for sandbox/local/cloud providers. |
| Integrated terminal shell | Add shell profiles. |
| Language | Add schema now; ship real localization in phases. |
| Context window usage | Add under Assistant Behavior or Intelligence as context behavior. |
| Follow-up behavior | Add under Assistant Behavior. |
| Require Enter to send long prompts | Add under Assistant Behavior / Composer. |
| Dictation | Add under Voice & Audio. |
| Notifications | Move to Interface > Notifications, with safety alerts mirrored under Safety. |
| Usage analytics | Add Usage & Billing. Keep Activity as dashboard. |
| Theme presets | Add after system theme and accessibility basics. |
| Accent/colors | Add after stable theme tokens. |
| Typography | Add UI/code/terminal font controls. |
| Reduced motion/contrast | Add under Accessibility. |
| Sandbox config | Add as Execution & Safety. |
| Personality/custom instructions | Add Assistant Behavior. |
| Memory | Add Memory & Knowledge plus Privacy controls. |
| Pets | Do not add. |
| Shortcut manager | Add full manager. |
| Apps/MCP | Keep Apps terminology. |
| Browser | Add Browser policy if browser tools become core. |
| Computer Use | Add Local Devices plus Safety policy. |
| Hooks | Add advanced Rules & Hooks later, not as baseline UI. |
| Connections | Separate active connections from device pairing. |
| SSH | Add named SSH profiles and credential policy. |
| Git | Add Developer Workflow > Git. |
| Environment management | Add Execution Environments. |
| Worktrees | Add when native Git/workspace support matures. |

## Recommended Implementation Plan

### Milestone 1 - Inventory and Registry

Goal: no user-facing redesign yet, but create the foundation.

Work:

- Create settings registry metadata.
- Add setting IDs for all existing settings.
- Add scope/sync/risk metadata.
- Generate Settings search from registry.
- Add migration map from current `AppSettings`.
- Mark settings as user, device, project, session, integration, or admin.

### Milestone 2 - UI Reorganization Without New Risk

Goal: reorganize current settings into the new hierarchy.

Work:

- Build new Settings shell with sidebar, search, breadcrumbs.
- Move existing controls into target categories.
- Add scope badges.
- Add platform badges.
- Add "not available on this platform" states.
- Keep current storage behavior.
- Keep Apps, Activity, Workspace, and Manage pages as linked destinations.

### Milestone 3 - Safety and Local Access

Goal: make risky agent capabilities understandable and controllable.

Work:

- Replace single Local System Access toggle with Studio Local subservices.
- Add per-server enablement.
- Add local service health and restart controls.
- Add Safety & Permissions page.
- Add default autonomy setting.
- Add per-tool/server policy.
- Add reset session approvals.
- Add audit log skeleton.

### Milestone 4 - Voice, Memory, and Privacy

Goal: make personal data and voice behavior explicit.

Work:

- Move voice volume and local transcription under Voice.
- Add language controls.
- Add memory on/off.
- Add memory retention/export/delete.
- Add diagnostics consent.
- Add local usage telemetry toggle.

### Milestone 5 - Developer Workflow

Goal: become credible beside Cursor, VS Code, Claude Code, and Codex.

Work:

- Add shell profiles.
- Add environment profiles.
- Add Git settings.
- Add file open destination.
- Add sandbox profiles.
- Add worktree settings once native worktree support exists.

### Milestone 6 - Admin and Governance

Goal: make Studio team-ready.

Work:

- Move Manage into Admin & Governance.
- Add roles/policy locks.
- Add allowed integrations.
- Add model routing policy.
- Add usage limits.
- Add audit log.

## Final Target Mental Model

Studio Settings should answer these user questions:

- Who am I signed in as, and what syncs?
- What project am I working in, and what are its defaults?
- Which intelligence should Studio use for each job?
- How should the assistant behave?
- What should Studio remember?
- How do I speak to Studio, and how does it speak back?
- How should the app look and notify me?
- What commands and shortcuts control the workspace?
- Which apps and tools can Studio use?
- Which devices and local services are trusted?
- Where can Studio execute work?
- What is Studio allowed to do without asking?
- What data is stored, sent, retained, or deleted?
- How much am I using and spending?
- What has my organization locked down?

If a setting does not clearly answer one of those questions, it probably belongs somewhere else or should not exist.

