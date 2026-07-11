# Project Studio Version 2: Architecture Modernization Plan

## 1. Overview

Project Studio has been under development for a long time, and this is the right point to begin a major architectural upgrade.

This initiative will be referred to as **Project Studio Version 2**. However, Version 2 does not represent a traditional public software release or product-version change. It represents a new development phase focused on:

* Redesigning the architecture
* Improving system reliability
* Separating responsibilities between services
* Replacing outdated or overloaded components
* Creating clearer execution, planning, registry, context, and data layers
* Establishing a stronger foundation for future development

The initial objective is not to complete every advanced feature immediately. The first objective is to create the correct base architecture, establish the required workers, migrate responsibilities into the appropriate systems, and then improve each component incrementally.

---

## 2. Current Chat Service

Studio currently has a cloud-based service called **Chat**.

Chat has become a multipurpose service responsible for too many unrelated functions, including:

* Running the main agent loop
* Managing conversations
* Streaming responses
* Calling tools
* Running investigative or research-oriented behavior
* Holding or exposing certain tools
* Managing parts of execution
* Handling several additional responsibilities

This concentration of responsibilities makes the service difficult to maintain, extend, debug, and scale.

Instead of continuing to expand Chat, we should replace it with several focused workers.

The current Chat implementation should not simply be renamed or lightly modified. It should be completely refactored and, where appropriate, rewritten from the beginning using the new architecture.

---

## 3. Studio Execution Runtime

The primary replacement for Chat will be called:

### **Studio Execution Runtime**

Studio Execution Runtime will be Studio's main agent execution worker.

It will contain the primary agent loop used for normal conversations, tool execution, coding tasks, file operations, research, and other general-purpose work.

The runtime should be implemented as a proper reasoning-and-action loop, most likely a ReAct-style loop or an equivalent modern agent loop.

Its responsibilities will include:

* Receiving user requests
* Running the main agent loop
* Calling language models through the Studio Gateway
* Streaming model output
* Supporting reasoning or thinking states
* Performing tool calls
* Performing parallel tool calls
* Handling multi-step tasks
* Managing conversation execution
* Receiving context from the context system
* Invoking skills, connectors, MCP servers, and agents
* Reporting progress to the user
* Handling retries and failures
* Returning final results
* Supporting resumable execution

This worker should focus exclusively on execution. It should not be responsible for managing registries, discovering integrations, manually assembling context, storing unrelated data, or maintaining every other part of the Studio platform.

---

## 4. Studio Planner Runtime

The second core worker will be dedicated to planning.

The preferred name is:

### **Studio Planner Runtime**

This worker will contain a separate agent loop designed specifically for planning rather than execution.

Its responsibilities may include:

* Understanding the user's goal
* Investigating the relevant project or environment
* Reading files and documentation
* Conducting limited research
* Asking the user necessary questions
* Identifying requirements and constraints
* Breaking work into phases
* Producing implementation plans
* Evaluating possible approaches
* Identifying risks and dependencies
* Preparing structured instructions for Studio Execution Runtime

The Planner Runtime should operate with **read-only access** by default. It should be able to inspect the environment but should not directly modify files, execute destructive actions, or make permanent system changes.

Open decision — the Planner Runtime loop model:

1. A custom planning loop
2. A standard ReAct loop with read-only tools
3. A predefined planning workflow with controlled stages
4. A hybrid approach combining a structured planning workflow with flexible model reasoning

This decision can be made after the base worker and its boundaries have been established.

---

## 5. Agent SDK Strategy

The current direction is to use the **Vercel AI SDK** for the new execution architecture.

Studio already uses the SDK in **Gateway v2**, which provides an existing integration point and internal familiarity.

The Vercel AI SDK should be evaluated and used for capabilities such as:

* Model streaming
* Structured model output
* Tool calling
* Parallel tool calling
* Reasoning or thinking support
* Multi-step execution
* Conversation handling
* Provider abstraction
* Error handling
* Streaming events to the frontend

We are also considering the **Cloudflare Agents SDK** because it provides functionality related to agent state, execution, Durable Objects, WebSockets, and persistent cloud sessions.

Using two SDKs is acceptable only when they have clearly separate responsibilities and do not create duplicated abstractions.

The final SDK strategy should answer the following question:

> Can one SDK provide the required functionality cleanly, or does Studio need both the Vercel AI SDK and the Cloudflare Agents SDK?

Possible outcomes include:

* Use only the Vercel AI SDK
* Use only the Cloudflare Agents SDK
* Use the Vercel AI SDK for model interaction and the Cloudflare Agents SDK for stateful cloud execution
* Use the SDKs selectively behind Studio-owned abstractions

The architecture should avoid becoming permanently coupled to overlapping framework-specific concepts when Studio can define its own stable interfaces.

---

## 6. Durable Objects and Execution State

Durable Objects are expected to provide the stateful coordination layer for cloud-based agent execution.

Each active conversation or execution session should have a reliable state model tracking:

* Current conversation
* Current user request
* Current execution step
* Completed steps
* Pending steps
* Active tool calls
* Completed tool calls
* Model responses
* Intermediate outputs
* Errors
* Retry attempts
* Cancellation state
* Pause state
* Completion state
* Relevant execution metadata

The objective is to ensure that an interrupted task does not need to restart from the beginning. The system needs:

* Persistent execution state
* Checkpoints
* Resumable runs
* Retry policies
* Timeout policies
* Cancellation
* Pause and resume behavior
* Failure summaries
* Centralized error handling
* Tool-call recovery
* Idempotency protection
* Safe continuation from the last valid step
* Clear user-facing execution status

The exact recovery model still needs to be designed. It may be based on checkpoints, an execution event log, snapshots, or a combination of these mechanisms.

---

## 7. Loop Lifecycle and Control

The execution system must define exactly when an agent loop should run, pause, stop, resume, or fail. The runtime needs explicit rules for:

* Starting a run
* Continuing a run
* Pausing a run
* Cancelling a run
* Resuming a run
* Stopping after user disconnection
* Continuing after frontend disconnection
* Handling application closure
* Handling unavailable local resources
* Handling model-provider failures
* Handling tool failures
* Preventing duplicate execution
* Detecting stalled runs
* Enforcing execution limits
* Producing a final failure summary

The loop must not depend entirely on the frontend remaining open. For cloud-based conversations, the execution should generally be able to continue even when the browser or application is closed. For local tasks, execution behavior must depend on the availability of the local machine and local runtime.

---

## 8. Cloud and Local Execution Behavior

### 8.1 Cloud Sessions

Cloud sessions should be capable of continuing independently after the user disconnects. WebSockets may be used for real-time communication, but the execution itself should not depend on a permanently open WebSocket connection.

The WebSocket should primarily provide:

* Live streaming
* Progress updates
* Tool-call events
* State changes
* Completion events
* Error events

The durable execution state should remain authoritative.

### 8.2 Local Sessions

When a task depends on local files, local applications, local command execution, local MCP servers, the Studio desktop runtime, or local development environments, the execution cannot continue meaningfully after the local machine becomes unavailable.

The local system should therefore support:

* Direct local connectivity
* Local availability detection
* Controlled disconnection
* Local execution pausing
* Reconnection
* State synchronization
* Resuming from the latest safe checkpoint
* Clear reporting when a local dependency is unavailable

Studio should not keep a meaningless cloud execution active when the required local environment cannot be reached.

---

## 9. Studio Registry

A centralized registry system providing a single source of truth for everything that can be discovered or used by Studio's agent runtimes:

* Connectors
* MCP servers
* Skills
* User-created agents
* Studio-provided agents
* Relevant runtime metadata
* Permissions
* Availability
* Ownership
* Execution location
* Configuration references

The registry must be user-scoped. One user's integrations, agents, skills, or MCP servers must never appear in another user's environment.

D1 can be used for the cloud-side registry data, provided the schema and ownership model remain properly isolated.

The execution runtime should not manually search across unrelated databases, R2 buckets, local files, or configuration stores to discover what is available. It should receive a normalized, filtered view from the registry and context systems.

---

## 10. Connector Registry

Tracks all connectors available to a user: which are configured, authenticated, enabled, their capabilities, granted permissions, current availability, and metadata for context building and tool exposure.

The registry stores references and metadata rather than exposing sensitive credentials directly to the agent runtime. Connector credentials and authentication state remain inside the secure authentication or connector-management system.

---

## 11. MCP Registry

MCP servers divide into four categories:

1. **Studio-provided cloud MCP servers** — hosted by Studio's backend (e.g. the memory service); registered automatically per permissions and product configuration.
2. **Studio-provided local MCP servers** — bundled with the desktop app (Studio Harness, local compute, filesystem, command execution, dev tools); registered with the local environment, availability synchronized with the cloud registry, tools remain local.
3. **Third-party local MCP servers** — user-registered; requires add/configure transport/start/validate/discover tools/store metadata locally/register availability/apply permissions. Local source of truth on the user's machine; metadata synchronized to the cloud registry.
4. **Third-party cloud MCP servers** — the registry stores identity, connection configuration, authentication references, capabilities, ownership, availability, permissions, and tool metadata.

The registry must combine native and third-party MCP servers into one normalized representation while preserving whether each server runs locally or in the cloud.

---

## 12. Skill Registry

Provides skill identity, description, instructions, ownership, version, availability, required tools, required permissions, applicable environments, activation rules, and references to supporting files.

The runtime receives only the skills relevant to the current user and task. The full content of every skill is not automatically inserted into every model request — the context system supports progressive discovery and selective loading.

---

## 13. Agent Registry

Stores definitions and metadata for user-created and Studio-provided agents. An agent definition may include: name, description, system prompt, model preference, personality, tool access, read/write permissions, execution limits, scheduling configuration, allowed connectors/MCP servers/skills, delegation permissions, runtime requirements, output format, user ownership, version, and enabled state.

A structured JSON-based agent definition is likely appropriate. The registry stores agent definitions; a separate runtime executes them.

---

## 14. Studio Agent Runtime

Executes registered agent definitions: loading a definition, resolving the model, loading the permitted toolset, applying the system prompt and permissions, loading allowed skills, resolving connector and MCP access, executing the agent loop, returning results, reporting state, enforcing limits, and supporting scheduled or delegated execution.

Open architecture question — possible models:

1. A dedicated shared Agent Runtime worker
2. Agent execution inside Studio Execution Runtime
3. A shared execution engine used by both runtimes
4. Separate runtime instances based on agent type
5. Local execution for local agents and cloud execution for cloud agents

The most important principle: avoid implementing a completely separate agent engine when the Studio Execution Runtime can provide the same underlying loop. A strong architecture may use one reusable execution engine with different runtime configurations.

---

## 15. User-Created Agents

Users create agents by configuring properties (prompt, model, personality, rules, tool permissions, read-only or write access, connectors, MCP servers, skills, schedule, execution environment, task-specific behavior) rather than building node graphs. The configuration is stored as a structured agent definition.

Invocation flow:

1. The Agent Registry provides the definition.
2. The Context system resolves the required capabilities.
3. The Agent Runtime loads the configuration.
4. The runtime executes the agent.
5. The result is returned to the requesting user or parent agent.

---

## 16. Studio-Provided Agents

Built-in agents (e.g. Deep Research, Codebase Exploration, General-Purpose, Investigation, Documentation, Review). Bundling definitions only with the frontend is likely too restrictive; a more robust approach stores built-in agent definitions as versioned platform records resolved by the registry and synchronized where required.

Open decisions: storage location, frontend bundling, versioned backend definitions, desktop local copies, update mechanism, model-generated vs. permanent agents, and local vs. cloud execution per agent.

---

## 17. Agent Delegation

The execution runtime should eventually invoke specialized agents: find the agent in the registry, provide a scoped prompt, grant a controlled toolset, run it through the Agent Runtime, receive its structured result, and continue the parent execution.

Delegated agents do not automatically receive the entire parent conversation or every tool. The parent runtime provides: a specific task, relevant context, explicit permissions, expected output, and execution limits. The result returns in a structured form.

---

## 18. Studio Context

Responsible for assembling the information required by an agent runtime. The execution and planning loops do not manually search for connected services, MCP servers, skills, agents, runtime availability, permissions, preferences, memories, files, or history — that belongs to the Context worker.

Studio Context produces a task-specific context package for Studio Execution Runtime, Studio Planner Runtime, Studio Agent Runtime, and other authorized agent systems. It retrieves only information belonging to the current user.

---

## 19. Context-Building Layers

1. **Conversation context** — current message, relevant history, current task, prior tool results, execution state, attachments.
2. **Connector context** — connected services, capabilities, auth state, relevant tools.
3. **MCP context** — available cloud/local/native/third-party servers, availability, relevant tools and resources.
4. **Skill context** — relevant skills, summaries, activation conditions, instructions loaded when needed.
5. **Agent context** — available specialized agents, delegation capabilities, descriptions, permissions, execution locations.
6. **User context** — preferences, long-term memory, workspace configuration, permission settings.
7. **Project and file context** — relevant files, project structure, documentation, uploads, artifacts, workspace state.

The context package should be structured, compact, permission-aware, and specific to the current task. Not every capability goes into every model request.

---

## 20. Relationship Between Registry and Context

**Registry answers:** What exists? Who owns it? Where does it run? Is it enabled? What capabilities does it expose? What permissions apply?

**Context answers:** What is relevant to this task? What should the current agent know? Which tools should be exposed? Which skills should be loaded? Which agents can be delegated to? Which files, memories, and prior events matter?

The Registry is the source of truth for available capabilities. The Context worker selects and prepares the subset needed for a specific execution.

---

## 21. Studio Data

Manages user-owned content and generated artifacts: conversations, uploaded documents/images/videos/audio, generated media and artifacts, attachment metadata, file references, and conversation-linked content.

Binary files live in an S3-compatible object store (R2 or another provider). Studio Data manages uploading, downloading, metadata, ownership, access control, associations, storage paths, retention, deletion, versioning where required, signed access, content-type validation, and lifecycle.

Specialized services may process media; Studio Data remains the authoritative management layer for user-owned content.

---

## 22. Conversation Storage

Distinguish between conversation metadata, individual messages, execution events, tool-call records, attachments, generated artifacts, runtime checkpoints, searchable text, and large binary content.

Large files and media stay in object storage. Structured conversation and execution metadata belongs in a queryable database. An object-storage bucket must not be the only database for every kind of conversation data.

---

## 23. Existing Systems

* **Tracking** — remains unchanged initially.
* **Authentication** — acceptable as-is; not part of the first rewrite.
* **API** — remains initially; interfaces may evolve as new workers land.
* **Gateway v2** — continues to provide model access and provider abstraction. New runtimes call models through Gateway v2 rather than implementing provider logic.

---

## 24. Proposed Worker Structure

1. **Studio Execution Runtime** — main conversational and task-execution loop.
2. **Studio Planner Runtime** — plans with read-only access.
3. **Studio Registry** — connectors, MCP servers, skills, agents, and related capabilities.
4. **Studio Context** — task-specific context for agent runtimes.
5. **Studio Agent Runtime** — user-created and specialized agents, if a separate runtime is required.
6. **Studio Data** — conversations, uploads, generated content, artifacts.

Existing services (Gateway v2, authentication, API, tracking) continue alongside.

---

## 25. Initial Implementation Strategy

* **Phase 1: Define boundaries** — responsibilities, non-responsibilities, communication interfaces, state/data ownership, user isolation.
* **Phase 2: Create core workers** — initial versions of Execution Runtime, Planner Runtime, Registry, Context, Data (Agent Runtime possibly deferred).
* **Phase 3: Replace Chat** — migrate execution, context assembly, discovery, and content management; retire Chat.
* **Phase 4: Add state and recovery** — Durable Objects, checkpoints, pause/resume/cancel/retry, centralized errors, failure summaries, availability handling.
* **Phase 5: Add registries** — connectors, native and third-party MCP servers, skills, built-in and user-created agents.
* **Phase 6: Add context resolution** — task-specific context, relevant tools/skills/agents, local and cloud capabilities, permissions.
* **Phase 7: Add agent delegation** — agent schema, runtime model, built-in and user-created agents, delegation from the execution runtime.

---

## 26. Major Open Decisions

1. Vercel AI SDK, Cloudflare Agents SDK, or both? — **RESOLVED (2026-07-11):**
   Vercel AI SDK for model interaction inside a step; custom state layer on raw
   Durable Objects (storage, alarms, WebSocket hibernation). No Agents SDK.
2. Planner Runtime: ReAct, custom loop, or predefined workflow?
3. Agent Runtime: separate worker or reuse Execution Runtime?
4. Storage and versioning of built-in agent definitions?
5. Storage of user-created agents?
6. Which agents run locally vs. in the cloud?
7. Parent-to-child agent delegation model?
8. Local MCP registration sync with the cloud registry?
9. Authoritative source of execution state?
10. Recovery: event sourcing, checkpoints, snapshots, or hybrid? — **RESOLVED
    (2026-07-11):** hybrid — append-only execution event log in DO SQLite as the
    source of truth, checkpoints as replay accelerators.
11. How long do disconnected cloud tasks continue running?
12. Behavior when a required local machine becomes unavailable?
13. Which conversation data belongs in a database vs. object storage?
14. Final names for the Registry and Agent Runtime workers?
15. Context representation and transfer between workers?

These decisions are made individually, not mixed into the initial worker-creation phase.

---

## 27. Core Architectural Principle

Separation of responsibility. The execution loop executes. The planning loop plans. The registry tracks what exists. The context system determines what is relevant. The data system manages user content. The agent runtime executes configured agents when a separate runtime is justified. Gateway v2 provides model access. Authentication manages identity. Tracking manages observability.

Each system has a clear boundary, a clear source of truth, and a stable interface with the rest of Studio.
