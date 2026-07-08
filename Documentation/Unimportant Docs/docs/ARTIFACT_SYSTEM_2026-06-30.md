# Artifact System

## Core Idea

Studio should have one artifact system.

The LLM emits a single universal `artifact` format. The UI then decides whether that artifact belongs in chat, overview, a panel, or a future coding surface.

This keeps the model contract stable while still letting the product render very different experiences: weather widgets, MCP records, task progress, memory timelines, agent summaries, source bundles, and later coding summaries.

## Categories

There are two top-level UI categories:

- `general`
  Non-coding artifacts: MCP, Composio, memory, weather, location, search, sources, tasks, agents, native cloud tools, browser extraction, and similar app-style results.
- `coding`
  Coding artifacts: codebase exploration, file changes, diffs, Git summaries, tests, bug reviews, agent work traces, and completed coding task summaries.

These are UI categories, not separate artifact languages. The LLM still uses one envelope.

## Surfaces

Artifacts can appear in different places:

- `chat`
  Inline card or compact shimmering line inside the conversation.
- `overview`
  Persistent overview item, task layer, source layer, coding summary layer, Git layer, or future workspace module.
- `panel`
  Larger expandable or docked artifact when the content needs more room.

## Universal Format

```artifact
{
  "type": "artifact",
  "version": 1,
  "category": "general",
  "kind": "weather",
  "title": "Weather In Dhaka",
  "summary": "Warm and cloudy with a chance of rain.",
  "status": "success",
  "presentation": {
    "surface": "chat",
    "density": "card",
    "compactLabel": "Weather checked"
  },
  "source": {
    "server": "studio-tools",
    "tool": "weather"
  },
  "stats": [
    { "label": "Temperature", "value": "31 C" },
    { "label": "Rain", "value": "42%" }
  ],
  "sections": [
    {
      "type": "kv",
      "title": "Details",
      "items": [
        { "label": "Condition", "value": "Cloudy" },
        { "label": "Wind", "value": "12 km/h" }
      ]
    }
  ]
}
```

## Required Fields

- `type: "artifact"`
- `version: 1`
- `kind`
- `title`

## Optional Routing Fields

- `category`
  `general` or `coding`. Defaults to `general` in the UI.
- `presentation.surface`
  `chat`, `overview`, or `panel`.
- `presentation.density`
  `line`, `card`, or `expanded`.
- `presentation.defaultCollapsed`
  Useful for traces and completed task summaries.
- `presentation.compactLabel`
  User-facing activity text such as `Exploring codebase` or `Task completed`.

## Supported Sections

- `text`
- `stats`
- `kv`
- `list`
- `links`
- `table`
- `timeline`
- `file_changes`
- `json`

Unknown `kind` values are allowed. The renderer should gracefully fall back to generic sections or JSON.

## Tool Inventory Found In This Codebase

### Core chat-native tools

- `skill_read`
- `task_write`
- `spawn_agent`
- `await_agents`
- `cancel_agent`
- `write_to_blackboard`
- `expand_tools`
- `get_location`

### Native cloud MCP service: `studio-tools` (7)

- `http_request`
- `web_search`
- `web_fetch`
- `rag`
- `image_generate`
- `video_generate`
- `video_status`

### Built-in memory MCP service: `studio-memory` (11)

- `memory_recall`
- `memory_search`
- `memory_recent`
- `memory_profile`
- `memory_note`
- `memory_relate`
- `memory_timeline`
- `memory_list`
- `memory_delete`
- `memory_forget`
- `memory_stats`

### Native MCP service: `youtube-transcript` (2)

- `get_transcript`
- `get_video_info`

### Local MCP surface currently exposed to the main LLM: `studio-local` family (137)

Key groups:

- Files and code understanding: `read_file`, `grep`, `glob`, `ls`, `outline_file`, `index_codebase`, `index_document`, `explore_codebase`, `search_symbol`, `analyze_file`
- Git and SSH: `git_status`, `git_diff`, `git_log`, `git_branch`, `git_push`, `git_pull`, `git_fetch`, `ssh_exec`, `ssh_session`
- Monitoring and system inspection: system stats, CPU, disk, GPU, battery, memory, storage, processes, network, event logs
- Vision and screenshots: screenshot, OCR, image analysis, annotated snapshots
- Desktop automation: windows, UI tree, mouse, keyboard, app launching
- Network control: ping, DNS, traceroute, Wi-Fi, adapters, hosts file
- Security, users, clipboard, notifications, dialogs

### Composio

- Dynamic per user
- Loaded through `mcp/src/routes/composio.ts`
- Naming convention: `composio_{app}__{action}`
- Actual action count varies by connected apps

## Suggested Implementation Stages

1. Central renderer and parser
   Already started: a universal `artifact` code fence can render in chat.
2. Overview routing
   Add an artifact store that can collect artifacts from assistant messages and route `surface: "overview"` into the overview panel.
3. General artifact library
   Build specialized renderers for weather, location, memory, search, links, source bundles, task summaries, and MCP records.
4. Coding layer
   Add coding-specific compact activity labels, trace grouping, file change summaries, Git summaries, and completed task summaries.
5. Tool mapping
   Add per-tool artifact examples and optional backend/frontend synthesis for tools that return predictable data.

## Temporary Demo Path

For local development, artifact blocks can be pasted into any assistant markdown response or renderer fixture. The renderer is intentionally wired through `CodeBlock`, so a normal markdown block is enough to preview the system before deploying backend prompt changes.

## Naming Decision

Use `Artifact` everywhere in code. Use `category: "general"` for non-coding artifacts and `category: "coding"` for coding artifacts.

Avoid names like `ProductivityArtifact` in the architecture. That is too narrow for the system Studio needs.
