# Studio Cloud and Local Architecture  
## Consolidated Working Brief and Architecture QA Specification

**Document status:** Working architecture brief  
**Decision status:** No final architecture or technology-stack decisions are made in this document  
**Primary purpose:** Convert the current verbal design into a clear, structured specification that can be given to another LLM for an extended architecture-question-and-answer process  
**Scope:** System boundaries, responsibilities, runtime separation, context construction, registries, tools, agents, MCP, cloud/local interaction, and unresolved design questions  
**Out of scope for the first architecture pass:** Final framework selection, detailed implementation, tracker redesign, and advanced agent features unless they affect foundational boundaries

---

## 1. Purpose of This Document

Studio is being refactored into two closely related deployment categories:

1. **Cloud Studio**
2. **Local Studio**

The cloud and local versions should follow the same conceptual architecture, component boundaries, terminology, and operating patterns wherever possible. They will not be identical implementations because their runtime environments, persistence systems, networking models, and security boundaries are different.

The immediate goal is not to select frameworks, databases, libraries, or exact code patterns. The immediate goal is to determine:

- What each subsystem is responsible for.
- Which components are shared between cloud and local.
- Which components must be duplicated.
- Which capabilities remain cloud-only.
- How the local runtime securely accesses required cloud capabilities.
- How agents discover and use tools, skills, MCP servers, connectors, and other agents.
- What the context system constructs and what it should not own.
- How execution requests are routed to the correct runtime.
- How system state and agent state should eventually be persisted and restored.
- Which existing folders and systems can be removed after their responsibilities have been migrated.

This document preserves the current ideas, including areas that remain uncertain. It separates confirmed direction from proposed behavior and unresolved questions.

---

# 2. Core Architectural Direction

## 2.1 Two Runtime Categories

Studio will be divided into two categories:

### Cloud Runtime

The cloud version will run primarily on Cloudflare infrastructure. Depending on the final design, this may include:

- Cloudflare Workers
- D1 databases
- R2 storage
- Durable Objects where still justified
- WebSockets where still justified
- Internal service-to-service communication
- A cloud agent runtime
- A cloud context worker
- Cloud-hosted connectors
- Cloud-hosted memory and native tool capabilities
- Cloud data storage
- The shared Studio Gateway

### Local Runtime

The local version will run inside the Studio desktop application or local software environment. It will include local equivalents of the core architecture:

- Main agent loop
- Planner runtime
- Execution runtime
- Agent runtime
- Local context engine
- Local registry
- Local MCP library
- Local skill library
- Local agent library
- Local agent state
- Local conversation state
- Local MCP execution
- Local persistence, likely using SQLite or a similar embedded database

The local runtime must be able to operate as an isolated, self-hosted execution environment for local agents, local MCP servers, local skills, local agent definitions, local files, and local conversation state.

However, some capabilities will remain cloud-hosted and will be accessed through authenticated outbound requests.

---

## 2.2 Architectural Symmetry

The cloud and local versions should use the same conceptual structure and naming wherever practical.

For example:

| Concept | Cloud Form | Local Form |
|---|---|---|
| Context system | Context Worker | Context Engine |
| Registry | Cloud Registry | Local Registry |
| MCP collection | Cloud MCP Library | Local MCP Library |
| Skills collection | Cloud Skill Library | Local Skill Library |
| Agent definitions | Cloud Agent Library | Local Agent Library |
| Agent execution | Cloud Agent Runtime | Local Agent Runtime |
| State storage | Cloudflare-native persistence | SQLite or equivalent |
| Main agent loop | Cloud runtime | Bundled local runtime |
| Planner | Cloud planner runtime | Bundled local planner runtime |

The conceptual contract should remain stable even when the implementation differs.

---

## 2.3 Shared Versus Duplicated Components

Not every service will have separate cloud and local versions.

### Intended shared component

The **Studio Gateway** is intended to remain one shared cloud-deployed service. It is not described as “cloud-first” or “local-first.” It is a common system service that both cloud and local execution environments may call.

### Intended duplicated components

The following concepts will have cloud and local implementations:

- Registry
- Context system
- MCP library
- Skill library
- Agent library
- Main agent loop
- Planner runtime
- Execution runtime
- Agent runtime
- State and conversation persistence

### Intended cloud-only or cloud-authoritative components

The following are currently expected to remain cloud-hosted:

- Connectors, including Composio-backed integrations
- Shared cloud memory services
- Native cloud tools
- Studio data storage
- User authentication and authorization for cloud resources
- The shared Gateway
- Cloud-generated media and related storage
- Cloud conversations

The exact boundaries remain subject to the architecture QA process.

---

# 3. Existing Components and Refactoring Intent

## 3.1 Gateway and Gateway V2

The codebase previously contained both the legacy gateway and a newer replacement implementation.

The replacement implementation has been promoted to the active `gateway`, and the legacy gateway has been removed.

The reason for creating Gateway V2 was to refactor the gateway so that it contains only gateway-related functionality. The gateway should not become a general-purpose backend worker.

The intended direction is:

1. Preserve the active `gateway` as a focused, deployable Cloudflare Worker.
2. Keep non-gateway responsibilities out of the gateway.
3. Route model-provider requests through the active gateway implementation.

### Gateway responsibilities should remain narrow

The gateway should focus on model-provider routing and gateway-specific behavior.

The gateway should not absorb unrelated capabilities such as:

- R2 storage orchestration
- Cron jobs
- General application workflows
- User data storage
- Agent orchestration
- Context construction
- Registry management
- Broad model-discovery infrastructure

Studio already has its own curated model list and uses relevant SDK functionality. Therefore, broad dynamic model discovery is not currently intended to be a gateway responsibility.

### Gateway deployment model

The gateway will be a single shared cloud service deployed to Cloudflare Workers.

The cloud agent runtime will call it.

The local agent runtime will also need to call it through an authenticated and properly scoped cloud-access mechanism.

---

## 3.2 Legacy Chat Worker

The current chat worker is described as the old or ancient LLM loop.

It is not necessarily the target runtime architecture, but it contains a useful existing idea: the `expand tools` mechanism.

The existing behavior allows an LLM to avoid receiving the complete schema for every available capability by default. It can selectively expand:

- All tools
- A specific MCP server
- MCP servers only
- Agents only
- Skills only
- Other capability categories

This behavior should be treated as prior art for the new tool-discovery and context-exposure architecture. It should not automatically be copied without review, but its selective-expansion model may solve an important context-size and prompt-cache problem.

---

## 3.3 Existing V2 Architecture Folder

The codebase also contains a V2 folder representing an earlier attempt to reorganize:

- MCP registry
- Skill registry
- Related architecture

The current direction is that separate top-level registries may have been the wrong abstraction. The newer preference is to have one registry system that indexes multiple resource types.

The V2 folder should be reviewed for:

- Useful schemas
- Existing database structures
- Working registration logic
- Reusable type definitions
- Service boundaries
- Duplicate or obsolete code
- Concepts that should be migrated into the unified registry

No V2 architecture should be preserved solely because it already exists. Its components should be retained only where they fit the revised design.

---

## 3.4 Tracker

The tracker will remain unchanged during the first architecture pass.

Current direction:

- Do not redesign it.
- Do not integrate it deeply into the new architecture yet.
- Do not deploy it as part of the first refactor unless already required.
- Preserve it for later analysis.

The tracker may eventually participate in observability, task state, run tracking, goals, or resumability, but those decisions are deferred.

---

# 4. Library Systems

Studio is expected to have three resource libraries:

1. MCP Library
2. Skill Library
3. Agent Library

These are resource collections and management systems. They are not automatically execution runtimes.

---

## 4.1 MCP Library

The MCP Library contains Model Context Protocol server definitions and, depending on the final architecture, may also host or reference MCP server implementations.

Possible MCP categories include:

- User-installed MCP servers
- Studio-provided MCP servers
- System MCP servers
- Native tool MCP servers
- Agent-execution MCP servers
- Memory MCP servers
- Agent-to-agent communication MCP servers

### Initial cloud state

The user-facing or general-purpose cloud MCP library may initially be empty.

However, Studio will still require system MCP capabilities. Therefore, the architecture must distinguish between:

- An empty user-configurable MCP library
- Required built-in system MCP servers
- Internally hosted tool services that happen to expose MCP-compatible interfaces

This distinction must be explicit.

### Local behavior

The local MCP library will contain local MCP server registrations and local runtime configurations.

The local desktop application may bundle some MCP servers and allow others to be installed or configured by the user.

Existing Tauri subprocess-based MCP execution should be reviewed and likely reworked. The objective is not necessarily to remove subprocess execution entirely. The objective is to stop treating local MCP execution as a thin client for a cloud agent runtime.

Local MCP servers should execute directly on the user’s machine and be registered in the local registry.

---

## 4.2 Skill Library

The Skill Library contains reusable skills.

Skills are expected to be declarative resources rather than independent agent runtimes. A skill may include:

- Name and description
- Instructions
- Domain knowledge
- Activation conditions
- Input and output expectations
- Tool requirements
- Agent compatibility
- Version
- Permissions
- Dependencies
- Examples or evaluation cases

### Initial cloud state

The cloud skill library will initially contain one pre-existing skill related to product-sales knowledge.

Other skills may be added later.

### Local behavior

The local application will have its own local skill library.

Local skills should be available to local agents without requiring the cloud registry or cloud context worker.

The architecture must determine whether cloud-authored skills can be synchronized, copied, installed, or version-pinned locally.

---

## 4.3 Agent Library

The Agent Library contains declarative agent definitions.

An agent definition is not expected to contain a custom runtime implementation or arbitrary executable node graph. Instead, it may define:

- Agent identifier
- Display name
- Description
- System prompt
- Optional planning instructions
- Allowed tools
- Allowed MCP servers
- Allowed skills
- Allowed connectors
- Allowed agents
- Capability restrictions
- Permission policy
- Default model policy
- Default reasoning policy
- Default output contract
- Stop conditions
- Reporting behavior
- Whether blackboard access is allowed
- Whether direct agent-to-agent communication is allowed
- Version and compatibility metadata

The actual agent loop, such as a ReAct-style loop, will live in the Agent Runtime.

Run-specific properties may be selected by the parent or main agent instead of being permanently stored in the definition. Examples include:

- Token budget
- Time budget
- Tool-call budget
- Cost budget
- Maximum iterations
- Model override
- Reasoning level
- Deadline
- Priority
- Whether the run is synchronous or asynchronous
- Whether blackboard participation is enabled

### Initial cloud state

The user-configurable cloud Agent Library may initially be empty.

Cloud system agents, such as a deep-research agent, may still exist as built-in definitions. The system must therefore distinguish between:

- User-defined agents
- Studio-provided agents
- Internal system agents
- Temporary run-specific agents

---

# 5. Unified Registry

## 5.1 Purpose

Studio will have a unified registry system rather than independent top-level registries for MCP servers, skills, and agents.

The Registry will index and expose metadata for:

- MCP servers
- Skills
- Agents
- Potentially native tools
- Potentially connectors
- Potentially model capabilities
- Potentially system capabilities

The exact scope must be decided.

The registry should provide a consistent discovery contract while preserving resource-specific schemas.

---

## 5.2 Cloud Registry

The cloud Registry will receive registrations from:

- Cloud MCP Library
- Cloud Skill Library
- Cloud Agent Library

Each library is expected to use D1 for its own persistence, registry data, or both. It remains unresolved whether:

- Each library owns a separate D1 database.
- The unified registry owns the canonical D1 database.
- Libraries own their resources while the Registry maintains a separate index.
- One shared database contains typed tables for all resource classes.
- D1 is used only for metadata while definitions are stored elsewhere.

The cloud Registry will expose relevant resource information to the cloud Context Worker.

---

## 5.3 Local Registry

The local runtime will include a local Registry with the same conceptual contract as the cloud Registry.

It will index:

- Local MCP servers
- Local skills
- Local agents
- Bundled system resources
- User-installed local resources
- Possibly cached descriptions of authorized cloud capabilities

The local Context Engine must not depend on the cloud Registry for normal local discovery.

Local resource registration and execution should remain available even when the cloud registry is unreachable.

---

## 5.4 Registry Responsibilities

The Registry may be responsible for:

- Resource identity
- Resource type
- Versioning
- Ownership
- Source
- Availability
- Health
- Permissions
- Capability metadata
- Search metadata
- Dependency metadata
- Runtime location
- Transport information
- Schema references
- Status
- Tags
- Categories
- Tenant scope
- User scope
- Installation state
- Enablement state
- Compatibility
- Integrity or signature metadata

The Registry should not automatically become:

- The execution runtime
- The context compiler
- The agent orchestrator
- The tool-call router
- The memory service
- The user-data store
- The connector implementation

Those boundaries must remain explicit.

---

# 6. Cloud Context Worker

## 6.1 Intended Role

The cloud Context Worker is responsible for preparing the information required by the cloud planner and main agent runtime.

It receives or participates in processing the user’s message and creates an optimized context package.

Potential inputs include:

- Current user message
- Conversation transcript
- Recent conversation state
- User profile
- Relevant memory
- Registered MCP metadata
- Registered skills
- Registered agents
- Connector availability
- Native tool availability
- System instructions
- Agent-specific instructions
- Workspace or project metadata
- Uploaded or generated data references
- Permissions
- Runtime policy
- Model constraints
- Token and cost policy

The result is passed to the planner runtime or main agent runtime.

---

## 6.2 Context Construction Goals

The Context Worker should produce context that is:

- Relevant
- Minimal where possible
- Deterministic where practical
- Stable across turns
- Structured for prompt caching
- Permission-aware
- Model-aware
- Easy to compact
- Easy to inspect
- Easy to version
- Capable of exposing additional information on demand
- Consistent across cloud and local implementations

The system should maximize prompt-cache hit rates by keeping stable sections stable and avoiding unnecessary changes to ordering, formatting, and schemas.

---

## 6.3 Memory Responsibilities

The Context Worker is expected to incorporate:

- Recent memory
- User profile
- Potentially relevant long-term memory
- Conversation-local state
- Possibly project-specific memory

It remains unresolved whether the Context Worker:

- Queries memory directly.
- Calls a Memory MCP server.
- Receives memory through another orchestration layer.
- Only receives preselected memory from a dedicated memory retrieval service.
- Caches memory metadata but fetches memory content on demand.

Memory ownership and context ownership must remain separate.

The Context Worker may retrieve and format memory, but it should not automatically become the canonical memory store.

---

## 6.4 Connector Responsibilities

Connectors are currently backed by Composio and are expected to remain cloud-hosted because they involve authentication, credentials, provider integrations, and centralized authorization.

The Context Worker needs access to connector availability and relevant connector metadata.

However, the Context Worker should not necessarily fetch complete connector schemas or remote data on every turn.

The architecture must distinguish between:

- Connector catalog metadata
- Connector authorization state
- Available connector actions
- Full action schemas
- Connector execution
- Connector results
- Connector data used in context

---

## 6.5 Context Output Format

It has not been decided whether the Context Worker should output:

- A single text prompt
- A structured JSON object
- A multipart context package
- A provider-neutral intermediate representation
- A provider-specific prompt
- A stable text prefix plus dynamic JSON sections
- Message arrays
- Tool definitions
- Tool-discovery handles
- Context references
- A compiled execution envelope containing all of the above

This is one of the main architecture questions.

A likely distinction will be required between:

1. **Context content** — instructions, memory, transcript, and relevant knowledge.
2. **Capability catalog** — summaries of available tools, agents, skills, connectors, and MCP servers.
3. **Executable schemas** — exact schemas for capabilities currently exposed to the model.
4. **Runtime metadata** — budgets, user identity, permissions, trace IDs, state IDs, and routing information.

The final architecture must decide which subsystem constructs each layer.

---

# 7. Tool Pool, Capability Discovery, and Progressive Expansion

## 7.1 Problem

The system may contain many:

- Native tools
- MCP servers
- MCP tools
- Skills
- Agents
- Connector actions
- Memory actions
- Data actions
- Media-generation actions

Passing every full schema to the model on every turn would:

- Increase input tokens
- Reduce prompt-cache efficiency
- Increase latency
- Increase cost
- Make tool selection harder
- Expose unnecessary capabilities
- Complicate permission enforcement
- Increase the chance of incorrect tool use

The model should know what broad capabilities exist without receiving every implementation detail by default.

---

## 7.2 Proposed Tool Pool Concept

A Tool Pool may provide a normalized view of available capabilities.

Possible categories include:

- Native tools
- System tools
- MCP servers
- MCP tools
- Skills
- Agents
- Connectors
- Memory tools
- Data tools
- Media tools
- Local-only tools
- Cloud-only tools
- User-installed tools
- Built-in tools

The pool may contain lightweight descriptors such as:

- Name
- Description
- Category
- Capability tags
- Permission state
- Runtime location
- Cost class
- Latency class
- Whether expansion is required
- Whether authorization is required
- Whether user confirmation is required
- Input summary
- Output summary
- Current availability

The full schema would be loaded only when needed.

---

## 7.3 Virtual Discovery Tool

The system may expose a virtual discovery tool similar to the existing `expand tools` mechanism.

Possible operations could include:

- List capability categories
- Search capabilities
- Expand all available tools
- Expand a specific MCP server
- Expand MCP servers only
- Expand skills only
- Expand agents only
- Expand connectors only
- Expand a named capability
- Request the exact schema for a selected action
- Request examples
- Request permission information
- Request runtime constraints

The exact name and interface remain unresolved.

Possible conceptual names include:

- `discover_capabilities`
- `search_capabilities`
- `expand_capabilities`
- `load_tools`
- `inspect_tool`
- `resolve_capability`
- `tool_pool`

No name is selected by this document.

---

## 7.4 Key Architectural Boundary

The architecture must determine whether the Tool Pool is:

- Part of the Context Worker
- A separate service
- A Registry projection
- A runtime-owned capability resolver
- A system MCP server
- A virtual tool implemented by the agent runtime
- A combination of these components

A useful separation may be:

- Registry stores canonical resource metadata.
- Context system selects a small relevant capability summary.
- Capability resolver expands selected resources into executable schemas.
- Runtime enforces permission and makes calls.
- Orchestrator routes calls to the correct execution target.

This is a possible decomposition, not a final decision.

---

## 7.5 Permission Enforcement

Capability discovery and capability execution are separate concerns.

A model might be able to see that a capability exists without having permission to execute it.

The final design must define:

- Discoverable but unavailable capabilities
- Hidden capabilities
- User-authorized capabilities
- System-only capabilities
- Parent-agent-only capabilities
- Child-agent-only capabilities
- Local-only capabilities
- Cloud-only capabilities
- Confirmation-required capabilities
- Read-only versus write capabilities
- Data-scope restrictions
- Connector-account restrictions
- Per-agent restrictions
- Per-run overrides

Permissions must be enforced by trusted runtime code, not only by prompts.

---

# 8. Cloud Agent Runtime

## 8.1 Purpose

The cloud Agent Runtime will execute agents other than, or in addition to, the main agent and planner.

Examples include:

- Deep-research agent
- Specialized research agent
- Analysis agent
- Coding agent
- Verification agent
- Domain-specific agent
- User-defined agent
- Temporary worker agent

The runtime provides the common execution loop.

The Agent Library provides declarative definitions.

---

## 8.2 Agent Invocation

The main agent may decide to spawn another agent.

Conceptually, a request may resemble:

- Spawn agent `deep_research`
- Provide task
- Provide allowed context
- Provide permitted tools
- Provide budget
- Provide deadline
- Provide reporting rules
- Await or monitor result

The exact invocation mechanism is unresolved.

Potential approaches include:

- Native runtime function calls
- System MCP server
- Internal orchestration API
- Durable Object RPC
- Service binding
- Queue-based execution
- Workflow engine
- Dedicated agent-execution service
- Local inter-process call in the desktop runtime

The cloud and local implementations should expose a conceptually consistent interface.

---

## 8.3 Agent Execution Tools

The main agent will need access to system capabilities such as:

- `spawn_agent`
- `await_agent`
- `get_agent_status`
- `cancel_agent`
- `send_agent_message`
- `read_agent_result`
- `list_active_agents`
- `pause_agent`
- `resume_agent`
- `read_blackboard`
- `write_blackboard`

These may be provided through a system MCP server or another trusted virtual-tool layer.

The design must ensure that these tools are not confused with user-installed MCP servers.

---

## 8.4 Parent and Child Agent Contracts

The runtime must define:

- What context a child receives
- Whether a child receives the full conversation
- Whether a child receives only a task packet
- Whether a child can request more context
- Whether a child can access user memory
- Whether a child can access connectors
- Whether a child can spawn further children
- Whether child runs share budgets
- Whether tools are inherited or explicitly granted
- How results are structured
- How errors are reported
- How partial results are returned
- How cancellation works
- How retries work
- How child output enters the parent context
- How transcripts are stored
- How sensitive data is isolated

These contracts are foundational and must be decided before broad multi-agent functionality is implemented.

---

# 9. Agent-to-Agent Communication and Blackboard

## 9.1 Direct Reporting

The default communication pattern may be direct parent-child reporting.

A child agent performs its assigned task and returns:

- Final result
- Summary
- Evidence
- Artifacts
- Tool outputs
- Errors
- Remaining uncertainty
- Suggested next action

This avoids requiring every agent to continuously read shared state.

---

## 9.2 Shared Blackboard

A shared blackboard has been proposed for more advanced agent-to-agent coordination.

Agents could post:

- Findings
- Plans
- Claims
- Evidence
- Open questions
- Task status
- Intermediate artifacts
- Dependencies
- Warnings
- Requests for help

The main agent and permitted child agents could read the blackboard on demand.

Blackboard participation may be controlled per run:

- Enabled
- Disabled
- Read-only
- Write-only
- Scoped to a task
- Scoped to an agent group
- Scoped to a conversation
- Scoped to a project

The blackboard should not automatically become the complete transcript store.

---

## 9.3 Blackboard Questions

The architecture must determine:

- Who owns the blackboard.
- Whether it is implemented as an MCP server.
- Whether it is a database-backed service.
- Whether it is part of the Agent Runtime.
- Whether each run has a separate blackboard.
- How entries are versioned.
- How conflicts are handled.
- Whether entries are immutable or editable.
- How large entries are stored.
- Whether artifacts are referenced or embedded.
- How access control works.
- How blackboard content is summarized or compacted.
- How stale information is marked.
- How a parent agent chooses what to read.
- Whether blackboard reads consume a separate budget.
- Whether local and cloud blackboards can interact.

---

# 10. System MCP Servers

Some MCP servers are expected to be Studio system components rather than user-installed integrations.

Potential system MCP servers include:

- Agent execution
- Agent-to-agent communication
- Blackboard
- Memory
- Native tools
- Data access
- File access
- Search
- Media generation
- Workspace operations

The architecture must classify MCP servers by trust and ownership.

A possible classification is:

1. **System MCP servers**  
   Required internal capabilities shipped and controlled by Studio.

2. **Built-in optional MCP servers**  
   Studio-provided capabilities that can be enabled or disabled.

3. **User-installed MCP servers**  
   Third-party or user-configured servers.

4. **Remote MCP servers**  
   Cloud-hosted servers accessed over a network.

5. **Local MCP servers**  
   Processes or services running on the user’s device.

6. **Connector-backed virtual MCP capabilities**  
   Connector actions normalized through an MCP-like interface.

This classification is not final, but a formal distinction will be necessary for permissions, trust, transport, and lifecycle management.

---

# 11. Cloud Orchestration and Inter-Worker Communication

## 11.1 Problem

Many cloud components must communicate:

- API layer
- Context Worker
- Registry
- MCP Library
- Skill Library
- Agent Library
- Connectors
- Memory
- Native tools
- Agent Runtime
- Main agent loop
- Planner runtime
- Gateway
- Studio Data Worker
- Potential blackboard
- Potential task tracker

Simply forwarding requests and awaiting responses may work for basic operations, but a formal orchestration contract may still be required.

---

## 11.2 Potential Orchestration Responsibilities

An orchestration layer may be responsible for:

- Accepting an execution request
- Resolving runtime location
- Calling the Context Worker
- Starting the planner
- Starting the main agent
- Routing tool calls
- Routing MCP calls
- Routing connector calls
- Starting child agents
- Waiting for child agents
- Handling cancellation
- Handling timeouts
- Tracking run state
- Emitting events
- Returning streaming output
- Persisting checkpoints
- Applying budgets
- Enforcing permissions
- Handling retries
- Recording traces
- Returning final results

It remains unresolved whether this should be:

- A dedicated Orchestrator Worker
- Part of the main agent runtime
- Part of the API worker
- Implemented using Durable Objects
- Implemented using Cloudflare Workflows
- Implemented through service bindings and queues
- Split into control-plane and data-plane components

No implementation is selected in this document.

---

## 11.3 Control Plane and Execution Plane

The architecture may benefit from distinguishing:

### Control plane

Responsible for:

- Registration
- Configuration
- Policy
- Permissions
- Routing decisions
- Runtime selection
- Lifecycle
- Status
- Budget policy

### Execution plane

Responsible for:

- Model calls
- Tool calls
- Agent loops
- Connector calls
- MCP execution
- Streaming
- Artifact creation
- Checkpoint persistence

This distinction should be evaluated during QA.

---

# 12. Studio Data Worker

## 12.1 Purpose

Studio Data is the cloud-authoritative storage service for user content that belongs in the cloud environment.

The current concept includes three primary storage categories, likely backed by three R2 buckets or equivalent logical partitions.

### Category 1: Cloud conversations

Contains:

- Cloud chat conversations
- Cloud message transcripts
- Potential message attachments
- Cloud run references
- Cloud-generated titles
- Cloud conversation metadata

This should not automatically contain local-only conversations.

### Category 2: User-uploaded files

Contains files uploaded to cloud Studio, including:

- Images
- PDFs
- HTML files
- Python files
- Documents
- Other supported file types

### Category 3: Generated media

Contains:

- Generated images
- Generated videos
- Related metadata
- Generation parameters
- Thumbnails or previews
- Artifact references

The exact number of R2 buckets is not yet final. Three logical categories do not necessarily require exactly three physical buckets, but the current design expects three.

---

## 12.2 Local Interaction With Studio Data

The local application may need authenticated access to cloud data for:

- Opening a cloud conversation
- Referencing cloud-uploaded files
- Using a cloud file in a local agent task
- Storing generated cloud media
- Fetching generated media
- Synchronizing selected artifacts
- Accessing user-authorized data

The local runtime should not assume that all cloud data is downloaded in advance.

The architecture must define:

- Metadata synchronization
- On-demand download
- Streaming
- Local caching
- Cache invalidation
- Offline behavior
- Encryption
- File-size limits
- Signed URLs versus proxied access
- Artifact identity
- Deduplication
- Local-to-cloud upload
- Cloud-to-local export
- Retention and deletion

---

# 13. Cloud API Architecture

## 13.1 Current Situation

The current API is described as agent-first rather than OpenAI-compatible.

That is not inherently a problem.

The API will eventually be redesigned around capabilities instead of exposing the internal service layout.

---

## 13.2 Capability-Based Routing

Capability-based routing means clients request a capability rather than directly addressing every internal subsystem.

For example, the public or application-facing API might expose capabilities such as:

- Run agent
- Continue conversation
- Search
- Generate image
- Generate video
- Access memory
- Access user data
- Execute connector action
- Retrieve artifact
- Stream events

The API would internally route the request to:

- Gateway
- Agent Runtime
- Context Worker
- Memory
- Tool service
- Connector service
- Data Worker
- Media provider

The client should not need to understand Studio’s internal worker topology.

---

## 13.3 Cloud API Scope

The cloud API should initially expose what the cloud product needs.

It should not be distorted solely to mirror the local internal architecture.

The cloud and local systems may share protocol concepts, but the public cloud API and local runtime interface do not have to be identical.

---

# 14. Local Cloud-Access Service and the “Bridge” Concept

## 14.1 Purpose

The local application needs a secure, authenticated way to access a curated set of cloud capabilities.

A proposed working name is **Bridge**.

The original description included the spelling “P-R-I-D-G-E,” but the intended term appears to be “Bridge.” The final product and code name remain undecided.

Bridge should not expose every internal cloud service directly.

It should present a curated, stable capability interface for the local runtime.

---

## 14.2 Candidate Bridge Capabilities

The local runtime may require Bridge access to:

- OpenAI-compatible or provider-neutral chat/model inference
- Studio Gateway
- Memory
- Native tools
- Connectors
- Studio Data
- Image generation
- Video generation
- Web search
- Web fetch
- HTTP tools
- Cloud RAG, if retained
- Authentication status
- Connector status
- Cloud capability catalog
- Cloud artifact access

The exact list must be minimized and formally versioned.

---

## 14.3 Bridge Versus Direct Service Endpoints

A major question is whether local Studio should call:

- Gateway directly
- Memory directly
- Tool service directly
- Data service directly
- Connector service directly

or call a single Bridge interface that routes all authorized local requests.

The current preference is a curated Bridge or capability-routing layer so that the local application does not depend on the cloud’s internal service topology.

Potential benefits include:

- Stable client contract
- Central authentication
- Central authorization
- Central rate limiting
- Central audit
- Reduced service exposure
- Easier versioning
- Easier migration
- Unified errors
- Consistent streaming
- Capability negotiation

Potential risks include:

- Additional latency
- A central bottleneck
- Larger blast radius
- More complex routing
- Possible duplication of API logic
- Risk of becoming an unbounded general-purpose backend

The QA process must define the boundary clearly.

---

# 15. Local Context Engine

## 15.1 Purpose

The Local Context Engine is the local equivalent of the Cloud Context Worker.

It should build context for the local planner and local main agent using primarily local sources.

Local inputs may include:

- Local conversation
- Local recent state
- Local user or workspace preferences
- Local registry
- Local MCP servers
- Local skills
- Local agents
- Local files
- Local application state
- Cached cloud capability descriptors
- Authorized memory results
- Connector availability
- Cloud data references
- Runtime policy

---

## 15.2 Local-First Behavior

The local Context Engine should not require:

- Cloud Registry
- Cloud Context Worker
- Cloud Agent Runtime

for normal local execution.

It should be able to discover and use:

- Local MCP servers
- Local skills
- Local agents
- Local files
- Bundled system capabilities
- Local conversation state

without sending this information to the cloud unless a selected cloud capability requires it.

---

## 15.3 Cloud Dependencies

The local runtime will still make outbound cloud requests for capabilities that remain centralized.

Current cloud dependencies include:

1. Gateway or model inference
2. Memory
3. Native cloud tools
4. Connectors
5. Studio Data
6. Generated media services
7. Potential cloud RAG

The local Context Engine should not necessarily make all network requests itself.

A separate local cloud-access service or client module may handle:

- Authentication
- Session refresh
- Capability negotiation
- Request signing
- Retries
- Streaming
- Caching
- Offline detection
- Backoff
- Error normalization
- Telemetry policy

This separation should be decided explicitly.

---

## 15.4 Local Capability Caching

The local application may cache:

- Cloud capability summaries
- Tool metadata
- Connector availability
- Connector action summaries
- Memory tool definitions
- Gateway model catalog
- User permissions
- Data metadata
- API version information

Full schemas and live user data should be fetched only when required and authorized.

The architecture must decide:

- Cache duration
- Refresh triggers
- Startup behavior
- Background refresh behavior
- Offline fallback
- Version invalidation
- Per-user cache isolation
- Whether sensitive metadata may be stored
- Encryption at rest
- Cache size limits

---

# 16. Local Runtime and Persistence

## 16.1 Bundled Runtime

The local application will ship with:

- Main agent loop
- Planner runtime
- Execution runtime
- Agent Runtime
- Context Engine
- Registry
- MCP Library
- Skill Library
- Agent Library
- Local state management

All local sub-agents should run on the user’s machine unless the user explicitly chooses or the policy requires a cloud agent.

---

## 16.2 Durable Objects Replacement

The current cloud design uses Durable Objects and WebSockets for stateful behavior.

The local runtime cannot depend on Durable Objects.

The intended local replacement is likely:

- SQLite
- An embedded event log
- An in-process state machine
- Local IPC
- Local WebSocket or event channel where useful
- File-backed artifact storage

The final design must determine whether SQLite stores:

- Conversations
- Messages
- Agent runs
- Agent checkpoints
- Tool calls
- Tool results
- Blackboard entries
- Registry metadata
- MCP configurations
- Skill definitions
- Agent definitions
- Goals
- Events
- Pending jobs
- Caches

The database schema should support resumability and migrations from the beginning.

---

## 16.3 Local Streaming

The local UI needs real-time updates from local agent runs.

Possible transports include:

- Tauri events
- Local WebSocket
- Server-Sent Events
- IPC channels
- Direct in-process event bus
- Embedded HTTP server

The final transport should be selected after the process model is decided.

---

# 17. Local MCP Runtime Refactor

## 17.1 Current Model

The current local MCP subsystem uses Tauri subprocesses.

It was designed while the cloud agent loop remained central.

---

## 17.2 New Model

The local application will have its own agent loop, registry, context engine, and execution runtime.

Therefore, local MCP execution should be redesigned as a native part of the local runtime.

Possible responsibilities include:

- Starting MCP processes
- Stopping MCP processes
- Health checks
- Restart policy
- Transport negotiation
- Capability discovery
- Schema caching
- Permission checks
- Environment-variable handling
- Secret management
- File-system access restrictions
- Process sandboxing
- Logging
- Per-user configuration
- Versioning
- Installation
- Removal
- Updates

The existing Tauri subprocess mechanism may still be useful as the low-level process launcher. What should change is its architectural role and integration.

---

# 18. Native Tools

Studio currently has or plans a native-tools MCP server that may expose:

- Web search
- Web fetch
- HTTP
- Image generation
- Video generation
- RAG
- Other provider-backed tools

The RAG implementation is currently considered unreliable or broken and should be reviewed.

Possible outcomes include:

- Fix and retain it.
- Replace it.
- Redesign it as file retrieval rather than a general tool.
- Move it into Studio Data.
- Move it into the Context system.
- Remove it from the first architecture version.

No outcome is selected here.

The architecture must distinguish:

- Tool definition
- Tool discovery
- Tool authorization
- Tool execution
- Tool result storage
- Tool result injection into context
- Tool availability in cloud versus local
- Provider-specific implementation

---

# 19. Deep Research and Other Cloud Sub-Agents

The cloud system is expected to support specialized sub-agents such as deep research.

The architecture must decide whether the same agent definition can run:

- In the cloud
- Locally
- In either environment depending on policy
- In a hybrid mode

A deep-research agent may require:

- Web search
- Web fetch
- Browser-like retrieval
- Source tracking
- Long-running execution
- Large context handling
- Parallel worker agents
- Citation generation
- Checkpointing
- Artifact output
- Higher budgets

The system should not assume that a cloud implementation can be copied directly into the local environment. The agent definition may be shared while the runtime adapters differ.

---

# 20. Conversation, Transcript, and Context Lifecycle

The current system lacks several foundational mechanisms that will eventually be required.

These are not necessarily part of the first refactor implementation, but the architecture should avoid blocking them.

---

## 20.1 Transcript Model

The system needs a canonical representation of:

- User messages
- Assistant messages
- System instructions
- Tool calls
- Tool results
- Agent messages
- Child-agent results
- Attachments
- Artifacts
- Errors
- Hidden runtime events
- Summaries
- Compaction checkpoints

The transcript used for display may differ from the transcript sent to a model.

---

## 20.2 Model Input Construction

The system must define what is sent to the model:

- Full visible transcript
- Selected transcript
- Summarized history
- Tool-call history
- Agent results
- Memory
- System prompt
- Skill instructions
- Tool schemas
- Capability catalog
- Current user request
- Runtime policy

The UI should not be responsible for calculating the authoritative context window.

Context selection and token accounting should occur in the agent/context runtime.

---

## 20.3 Compaction

A compaction mechanism is required for long conversations and long-running agents.

It may include:

- Message summarization
- Tool-result summarization
- Agent-result summarization
- Memory extraction
- Checkpoint creation
- Artifact references
- Dropping reproducible data
- Preserving commitments and unresolved tasks
- Preserving system and policy instructions
- Maintaining source links

Compaction must be deterministic enough to support resumability and debugging.

---

## 20.4 Titles

The system needs a title mechanism for conversations and potentially agent runs.

Questions include:

- When is a title generated?
- Which model generates it?
- Is it regenerated?
- Is it local or cloud?
- Does it use conversation content?
- Is it stored as metadata?
- Can the user override it?
- Does a local conversation title ever sync to cloud?

---

# 21. Agent State, Checkpoints, Pause, and Resume

The current system does not have a complete state mechanism for autonomous agents.

The future architecture must support:

- Agent run identity
- Parent-child relationships
- Current step
- Current plan
- Completed steps
- Pending tool calls
- Pending agent calls
- Budgets
- Cancellation
- Pause
- Resume
- Retry
- Failure state
- Partial results
- Checkpoints
- Recovery after application restart
- Recovery after worker restart
- Recovery after network interruption

The state system must differ in implementation between cloud and local while preserving a common logical model.

---

# 22. Goal Mechanism

The system currently lacks a formal goal mechanism.

A future goal model may distinguish:

- User request
- Conversation goal
- Agent run goal
- Subtask
- Milestone
- Constraint
- Success criterion
- Stop condition
- Verification requirement
- Deferred work
- User approval requirement

The goal model should not be designed until the main execution and state boundaries are clear, but the database and event models should leave room for it.

---

# 23. Explicit Candidate Removals or De-scoping

The following removals or exclusions were explicitly proposed and should be evaluated.

## 23.1 Remove old gateway

Remove the old `gateway` implementation only after verifying that Gateway V2 fully replaces its required gateway behavior.

## 23.2 Rename Gateway V2

The old gateway has been removed, and the replacement implementation has been renamed to `gateway`.

## 23.3 Remove non-gateway responsibilities from Gateway

Do not add or retain unrelated R2, cron, broad discovery, storage, context, or orchestration logic in Gateway.

## 23.4 Replace separate top-level registries

Move away from independent MCP and Skill registry systems toward one unified Registry, while retaining typed resource schemas.

## 23.5 Do not redesign Tracker now

Keep the tracker unchanged and outside the first architecture implementation.

## 23.6 Do not make local execution depend on cloud Registry or cloud Context Worker

The local runtime should own its local registry and context system.

## 23.7 Rework local MCP integration

Remove or refactor assumptions that local MCP subprocesses exist only to serve a cloud-hosted agent loop.

## 23.8 Do not expose internal service topology through the client API

Prefer capability routing and a curated local Bridge contract.

## 23.9 Do not send every full tool schema to the model by default

Adopt a progressive disclosure or capability-expansion design if it proves reliable.

## 23.10 Defer broken RAG

Do not make the current RAG implementation foundational until it is repaired or replaced.

---

# 24. Proposed Conceptual Request Flows

These flows are illustrative. They are not final implementations.

---

## 24.1 Cloud Chat Request

1. User sends a message from the web client.
2. Cloud API authenticates the user and conversation.
3. Execution controller creates or resumes a run.
4. Context Worker receives the request context.
5. Context Worker retrieves:
   - Conversation state
   - Relevant memory
   - User profile
   - Registry projection
   - Connector availability
   - Relevant skills and agents
   - Capability summaries
6. Context Worker emits a context package.
7. Planner or main agent receives:
   - Context
   - Selected executable tools
   - Capability discovery tool
   - Runtime policy
8. Main agent may:
   - Respond directly
   - Expand capabilities
   - Call a tool
   - Call a connector
   - Spawn a child agent
9. Orchestration layer routes each execution request.
10. Gateway handles model calls.
11. Results and events are persisted.
12. Output streams to the user.
13. Final state and potential memory updates are committed.

---

## 24.2 Local Chat Request

1. User sends a message inside the desktop application.
2. Local runtime creates or resumes a local run.
3. Local Context Engine reads:
   - Local conversation state
   - Local registry
   - Local MCP resources
   - Local skills
   - Local agents
   - Local files
   - Cached cloud capability summaries
4. Local planner or main agent receives the context package.
5. Local agent calls local tools and agents directly through the local runtime.
6. When a cloud capability is required:
   - Local runtime sends an authenticated request through the local cloud-access service or Bridge client.
7. Gateway handles model inference if the model is cloud-hosted.
8. Cloud tools, connectors, memory, or data services execute only when selected.
9. Results return to the local runtime.
10. Local state is persisted in SQLite or equivalent storage.
11. Output streams to the desktop UI.
12. Local conversation remains local unless the user explicitly synchronizes or invokes a cloud storage behavior.

---

## 24.3 Child-Agent Request

1. Main agent selects an agent from the capability catalog.
2. Runtime verifies that the parent may invoke it.
3. Runtime resolves the agent definition.
4. Parent submits:
   - Task
   - Context packet
   - Tool grants
   - Budget
   - Output contract
   - Communication policy
5. Agent Runtime creates a child run.
6. Child executes using the shared runtime loop.
7. Child may report directly or use the blackboard if enabled.
8. Parent awaits, polls, or continues other work.
9. Child returns structured result.
10. Runtime records lineage and final state.
11. Parent integrates the result into its own reasoning and response.

---

# 25. Architecture QA: Questions That Must Be Answered

The following questions should drive the long-form QA process. They are intentionally comprehensive.

---

## 25.1 Naming and Component Boundaries

1. What are the official names of the cloud and local context components?
2. Should both be called “Context Engine,” with Worker being only a deployment detail?
3. Is “Registry” specific enough, or should it be named `Studio Registry`, `Capability Registry`, or `Resource Registry`?
4. Is “MCP Library” a registry, a package store, a hosting runtime, or all three?
5. Is “Skill Library” a definition store or an execution service?
6. Is “Agent Library” a definition store only?
7. Is “Agent Runtime” responsible for both main and child agents, or only child agents?
8. Are Planner Runtime and Execution Runtime separate services or modes of one runtime?
9. Is the Main Agent Loop separate from the Agent Runtime?
10. What is the final name of Bridge?
11. What is the official name of the orchestration layer?
12. Which names must remain identical in cloud and local code?

---

## 25.2 Gateway

1. What exact responsibilities exist in the old Gateway?
2. Which of them exist in Gateway V2?
3. Which old responsibilities are intentionally being removed?
4. Are there any clients still calling the old gateway?
5. Does Gateway own provider credentials?
6. Does Gateway own model policy?
7. Does Gateway own model aliases?
8. Does Gateway validate model capability requirements?
9. Does Gateway expose OpenAI-compatible endpoints?
10. Does Gateway expose an internal Studio-native endpoint?
11. Does local Studio call Gateway directly or only through Bridge?
12. Does Gateway stream provider output without modification?
13. Does Gateway normalize tool-call formats?
14. Does Gateway handle retries and fallbacks?
15. Does Gateway store request or response content?
16. What information may Gateway log?
17. How are provider limits enforced?
18. How are model lists versioned?
19. How is the curated model list distributed to local Studio?
20. What conditions must be met before the old gateway is deleted?

---

## 25.3 Registry Data Model

1. What is the canonical resource identifier format?
2. Are identifiers globally unique?
3. How are local and cloud resources distinguished?
4. How are built-in, user-installed, and system resources distinguished?
5. Does each resource have a version?
6. Are versions immutable?
7. Can multiple versions be installed simultaneously?
8. How are dependencies represented?
9. How are capability tags represented?
10. How are permissions represented?
11. How is tenant ownership represented?
12. How is user ownership represented?
13. How is runtime location represented?
14. How is availability represented?
15. How is health represented?
16. How are schemas stored?
17. How are large schemas referenced?
18. How is search indexed?
19. How are aliases handled?
20. How are deprecated resources handled?
21. How are resources disabled without deletion?
22. How are local resources imported or exported?
23. How are cloud resources installed locally?
24. Does Registry include connector actions?
25. Does Registry include native tools?
26. Does Registry include model capabilities?
27. Does Registry include system MCP servers?
28. Does Registry return full definitions or projections?
29. How are registry events propagated to Context?
30. How are stale caches invalidated?

---

## 25.4 Library Ownership and Persistence

1. Does each library own its own D1 database?
2. Is there one shared D1 database for all libraries?
3. Does the Registry own a separate index database?
4. Which system is the source of truth?
5. Are resource bodies stored in D1, R2, source code, or package files?
6. How are built-in resources seeded?
7. How are schema migrations handled?
8. How are local and cloud resource formats kept compatible?
9. How are package signatures or integrity checks handled?
10. How are deleted resources referenced by old runs?
11. Can a run pin an exact resource version?
12. Can a user edit a built-in resource?
13. Are edits stored as overrides or copies?
14. What is synchronized between devices?
15. What remains local-only?

---

## 25.5 Context System Responsibilities

1. Does Context receive the raw user message?
2. Does Context own the canonical transcript?
3. Does Context retrieve the transcript from a conversation store?
4. Does Context choose which messages to include?
5. Does Context perform token counting?
6. Does Context perform compaction?
7. Does Context retrieve memory?
8. Does Context write memory?
9. Does Context retrieve connector metadata?
10. Does Context retrieve connector data?
11. Does Context resolve tool permissions?
12. Does Context resolve agent permissions?
13. Does Context select relevant skills?
14. Does Context select relevant agents?
15. Does Context rank tools?
16. Does Context produce executable schemas?
17. Does Context only produce summaries and references?
18. Does Context produce provider-neutral output?
19. Does Context produce provider-specific messages?
20. Does Context know the selected model’s limits?
21. Does Context decide the prompt-cache layout?
22. Does Context maintain stable ordering?
23. Does Context include hidden metadata?
24. Does Context return a single object or multiple sections?
25. Does Context run once per user turn or multiple times during a run?
26. Can agents request context expansion?
27. Can tools add context?
28. Can child agents request additional context?
29. How is sensitive memory filtered?
30. How is context inspected for debugging?
31. How is context versioned?
32. How is context deterministically reproduced?

---

## 25.6 Prompt Cache and Stable Formatting

1. Which prompt sections are expected to remain stable?
2. What exact ordering should be used?
3. Are tool summaries sorted deterministically?
4. Are JSON keys serialized deterministically?
5. Are timestamps excluded from cacheable prefixes?
6. Are user-specific sections separated from global sections?
7. Are model-specific sections separated?
8. Are full schemas loaded after the stable prefix?
9. How are dynamic permissions represented without invalidating the entire prefix?
10. How are memory updates isolated?
11. How is local cache behavior aligned with cloud behavior?
12. Which providers support prompt caching, and how much provider-specific logic is acceptable?

---

## 25.7 Tool Pool and Discovery

1. Is Tool Pool a logical concept or a deployed service?
2. Does it contain only tools, or all capabilities?
3. Should it be called Capability Pool instead?
4. Does the model receive a complete lightweight catalog?
5. Is the catalog filtered before the model sees it?
6. Who performs filtering?
7. Can the model search the catalog semantically?
8. Can the model request one exact schema?
9. Can the model expand an entire category?
10. Can the model expand all capabilities?
11. What prevents expansion from exceeding context limits?
12. Are schemas cached after expansion?
13. Does expansion persist across turns?
14. Are expanded tools included in the transcript?
15. Does a child agent inherit expanded schemas?
16. Can a model inspect unavailable capabilities?
17. Should unauthorized capabilities be hidden completely?
18. How are connector actions represented?
19. How are agents represented as invocable capabilities?
20. How are skills represented if they are not tools?
21. How are local and cloud capabilities merged?
22. How are duplicate names handled?
23. How are capability conflicts resolved?
24. How are tool examples exposed?
25. How are tool costs and risks exposed?
26. How are side-effecting tools marked?
27. How does the runtime validate the model’s selection?
28. Is the discovery mechanism itself an MCP server or a native virtual tool?
29. Can a malicious MCP server manipulate the catalog?
30. How are descriptions sanitized?

---

## 25.8 Permissions

1. What is the permission hierarchy?
2. Are permissions assigned to users, workspaces, agents, or runs?
3. Can a parent grant a child a subset of its tools?
4. Can a parent grant a tool it does not possess?
5. Can a child request an additional permission?
6. Does that require parent approval or user approval?
7. Which actions require explicit user confirmation?
8. How are read and write permissions separated?
9. How are file-system scopes represented?
10. How are connector-account scopes represented?
11. How are data-record scopes represented?
12. How are network scopes represented?
13. How are shell or subprocess permissions represented?
14. How are image and video generation permissions represented?
15. How are budget permissions represented?
16. How are cloud-only permissions represented locally?
17. How are permissions enforced at execution time?
18. How are permission denials reported to the model?
19. How are permissions audited?
20. How are temporary grants revoked?

---

## 25.9 Orchestration

1. Is there a dedicated Orchestrator?
2. Is orchestration part of the main agent runtime?
3. Is there one run ID across all workers?
4. How are child run IDs related to parent run IDs?
5. How are events ordered?
6. How are duplicate events prevented?
7. How are retries made idempotent?
8. How are tool calls routed?
9. How are agent calls routed?
10. How are local versus cloud destinations selected?
11. How are timeouts applied?
12. How are cancellations propagated?
13. How are partial outputs streamed?
14. How are failures recovered?
15. How are long-running cloud agents implemented?
16. How are long-running local agents implemented?
17. Are queues required?
18. Are Durable Objects required?
19. Are Cloudflare Workflows required?
20. Is a central event log required?
21. Which state is synchronous?
22. Which state is eventually consistent?
23. How does the UI reconnect?
24. How does a local client reconnect after sleep?
25. Can runs migrate between cloud and local?
26. Can a local parent spawn a cloud child?
27. Can a cloud parent spawn a local child?
28. Is hybrid execution allowed in the first version?
29. How is trace context propagated?
30. What is the minimum viable orchestration contract?

---

## 25.10 Agent Definitions and Runtime

1. What fields are mandatory in an agent definition?
2. What fields are optional?
3. Are agent definitions pure JSON?
4. Are prompts stored inline or referenced?
5. Are skills embedded or referenced?
6. Are tool grants static or dynamic?
7. Can a definition select a model?
8. Can the parent override the model?
9. Can the user override the model?
10. Are reasoning levels part of the definition?
11. Does every agent use the same loop?
12. Are planner and executor agents special types?
13. Can agents have custom stop conditions?
14. Can agents return structured outputs?
15. How are agent outputs validated?
16. Can an agent spawn children?
17. What is the maximum nesting depth?
18. How are budgets inherited?
19. How are failures reported?
20. How are agent definitions version-pinned to runs?
21. How are system agents protected from modification?
22. How are local agents packaged?
23. How are cloud agents deployed?
24. Can an agent definition be portable across cloud and local?
25. What runtime capabilities may differ?
26. How is a deep-research agent represented?
27. Is the main agent itself represented in the Agent Library?
28. Is the planner represented in the Agent Library?
29. Are temporary agents persisted?
30. How are evaluation and safety policies attached?

---

## 25.11 Agent Communication and Blackboard

1. Is direct parent-child response the default?
2. Is blackboard optional?
3. Who creates a blackboard?
4. What is its scope?
5. Who can read it?
6. Who can write it?
7. Are entries append-only?
8. Can agents edit entries?
9. Can agents mark entries obsolete?
10. How are citations or evidence attached?
11. How are large artifacts referenced?
12. Does the parent automatically receive blackboard updates?
13. Are updates pushed or pulled?
14. How does blackboard content enter model context?
15. Is content summarized?
16. How are conflicting claims represented?
17. Is there a lock or transaction model?
18. How is blackboard state persisted?
19. How is it restored?
20. How is it cleaned up?
21. Can local and cloud agents share one blackboard?
22. What security boundary prevents unrelated runs from reading it?
23. Does blackboard access use MCP?
24. Is blackboard itself a system tool?
25. How are blackboard operations audited?

---

## 25.12 Connectors

1. Does Composio remain the implementation?
2. Is Connector a standalone Worker?
3. Does Connector expose a normalized action catalog?
4. Does Registry index connectors?
5. Does Context only receive connector summaries?
6. When are full action schemas fetched?
7. How is authorization state represented?
8. How does local Studio discover authorized connectors?
9. Does local Studio call Connector through Bridge?
10. Are credentials ever sent to local Studio?
11. How are connector actions confirmed?
12. How are side effects classified?
13. How are connector results stored?
14. How are large results summarized?
15. How are connector webhooks handled?
16. How are connector rate limits handled?
17. How are action versions handled?
18. What happens if Composio is unavailable?
19. Can Studio support direct connectors later?
20. How is connector data protected from unrelated agents?

---

## 25.13 Memory

1. What types of memory exist?
2. Is user profile separate from learned memory?
3. Is recent memory separate from transcript?
4. Is project memory separate from user memory?
5. Is memory global, workspace-scoped, or conversation-scoped?
6. Is Memory an MCP server, service, or both?
7. Where is memory stored?
8. Does local Studio have local memory?
9. Does local memory synchronize to cloud?
10. Is cloud memory optional?
11. What memory is fetched before a model call?
12. What memory is fetched on demand?
13. Who ranks memory?
14. Who writes memory?
15. Does the main agent propose memories?
16. Is memory writing asynchronous?
17. How are incorrect memories corrected?
18. How are memories deleted?
19. How are sensitive memories protected?
20. How are memory results cached?
21. How are memory tools exposed to child agents?
22. Does memory content enter the prompt-cache prefix?
23. How does memory affect compaction?
24. What is the failure behavior when memory is unavailable?
25. Can the local runtime continue without cloud memory?

---

## 25.14 Studio Data

1. Are there exactly three R2 buckets?
2. Are buckets separated by data type, security boundary, or lifecycle?
3. Where is metadata stored?
4. How are artifacts identified?
5. How are files linked to conversations?
6. How are files linked to agent runs?
7. How are generated assets linked to prompts and providers?
8. How are local files represented without upload?
9. How does a cloud agent access a local file?
10. Is that allowed in the first version?
11. How are signed URLs handled?
12. How are permissions checked?
13. How are deleted artifacts handled?
14. How is retention handled?
15. How is deduplication handled?
16. How are large files processed?
17. How are thumbnails generated?
18. How are file types validated?
19. How are malware or unsafe files handled?
20. How is encryption handled?
21. How does local caching work?
22. How does offline access work?
23. Can a user promote a local artifact to cloud?
24. Can a user download a cloud artifact for local use?
25. How are generated video and image outputs streamed?

---

## 25.15 Bridge and Local Cloud Access

1. Is Bridge one endpoint, one Worker, or one client contract?
2. Is Bridge public, private, or authenticated user-facing?
3. Does Bridge proxy Gateway?
4. Does Bridge proxy Memory?
5. Does Bridge proxy Tools?
6. Does Bridge proxy Connectors?
7. Does Bridge proxy Data?
8. Does Bridge expose OpenAI-compatible chat?
9. Does Bridge expose Studio-native agent operations?
10. Does Bridge support streaming?
11. Does Bridge support resumable runs?
12. Does Bridge perform capability negotiation?
13. Does Bridge return a cloud capability manifest?
14. How is the local application authenticated?
15. How are tokens stored locally?
16. How are tokens refreshed?
17. How are devices registered?
18. How are compromised devices revoked?
19. How are requests signed?
20. How are rate limits applied?
21. How are versions negotiated?
22. How are backward-incompatible changes handled?
23. How does Bridge avoid becoming a second general API?
24. Which capabilities are intentionally excluded?
25. Can third-party clients use Bridge?
26. How are audit logs created?
27. How are privacy settings enforced?
28. How does Bridge handle regional routing?
29. Is Gateway ever directly accessible from the desktop client?
30. What is the minimum Bridge version required for the first local release?

---

## 25.16 Local Runtime

1. Is the runtime in Rust, TypeScript, or split?
2. Which part runs inside Tauri?
3. Which part runs as a sidecar?
4. Which part runs in the webview?
5. Is there an embedded HTTP server?
6. Is there a local WebSocket server?
7. Are Tauri events sufficient?
8. How are processes supervised?
9. How is SQLite accessed?
10. How are migrations handled?
11. How are secrets stored?
12. How are logs stored?
13. How are logs redacted?
14. How are local files permissioned?
15. How are MCP processes sandboxed?
16. How are crashes recovered?
17. How are upgrades handled during active runs?
18. How are stale processes terminated?
19. Can multiple Studio windows share one runtime?
20. Can multiple users share one installation?
21. How is per-workspace isolation handled?
22. How is local model support added later?
23. How does the runtime behave offline?
24. How are cloud calls queued during disconnection?
25. What data must never leave the device by default?

---

## 25.17 Transcript and Context Window

1. What is the canonical message schema?
2. Are tool calls messages or events?
3. Are child-agent messages visible to the user?
4. Are hidden system messages stored?
5. Does the displayed transcript differ from the model transcript?
6. Where is token usage calculated?
7. Which tokenizer is used?
8. How are multimodal messages counted?
9. How are attachments represented?
10. How are generated artifacts referenced?
11. How are tool results truncated?
12. When does compaction occur?
13. Can the user inspect summaries?
14. Can the user revert a compaction?
15. How are summaries validated?
16. How are unresolved commitments preserved?
17. How are model-specific transcript differences handled?
18. How is a run reproduced for debugging?
19. How are local transcripts kept local?
20. How are cloud transcripts stored and deleted?

---

## 25.18 State, Pause, Resume, and Recovery

1. What is the canonical run-state machine?
2. What states exist?
3. Which transitions are valid?
4. What is checkpointed?
5. How frequently are checkpoints created?
6. Are checkpoints event-sourced?
7. Can a run resume on another worker?
8. Can a local run resume after app restart?
9. Can a cloud run resume after Worker eviction?
10. How are pending tool calls recovered?
11. How are duplicate external side effects prevented?
12. How are pending connector actions recovered?
13. How are child-agent states restored?
14. How are blackboard states restored?
15. How does user cancellation propagate?
16. What does pause mean for an in-flight model call?
17. What does pause mean for an external tool?
18. How are timeouts represented?
19. How are retries budgeted?
20. How are unrecoverable runs surfaced to the user?

---

## 25.19 Observability and Tracker

1. What events are emitted by every run?
2. What metrics are required?
3. What traces are required?
4. How are model calls linked to tool calls?
5. How are child runs linked?
6. What data may be logged?
7. What data must be redacted?
8. Is Tracker eventually the run observer?
9. Does Tracker store operational state or only analytics?
10. Can local telemetry be disabled?
11. What diagnostic bundle can a user export?
12. How are cloud and local traces correlated?
13. How are costs attributed?
14. How are performance bottlenecks identified?
15. What minimum observability is needed before refactoring begins?

---

## 25.20 Security and Trust

1. Which services are trusted?
2. Which MCP servers are untrusted?
3. Which tools may access the network?
4. Which tools may access local files?
5. Which tools may execute code?
6. Which tools may perform external writes?
7. How are secrets isolated?
8. How are connector tokens isolated?
9. How are user identities propagated?
10. How are service-to-service calls authenticated?
11. How is tenant isolation enforced?
12. How are local plugins verified?
13. How are MCP packages signed?
14. How are prompt-injection risks handled?
15. How are tool descriptions treated as untrusted input?
16. How are remote results sanitized?
17. How is user confirmation recorded?
18. How are dangerous operations blocked?
19. How are child-agent permissions bounded?
20. How are compromised local devices revoked from cloud access?

---

## 25.21 Migration and Refactor Sequence

1. What is the current dependency graph?
2. Which components call the old gateway?
3. Which components call the old chat worker?
4. Which components use the current registries?
5. Which components use Durable Objects?
6. Which components use WebSockets?
7. Which components use Tauri subprocess MCP?
8. Which schemas can be preserved?
9. Which data needs migration?
10. Which APIs need compatibility adapters?
11. Can Gateway V2 be renamed without breaking imports?
12. Should a temporary facade preserve old routes?
13. In what order should cloud components be refactored?
14. At what point should local runtime work begin?
15. How can cloud/local contracts be tested together?
16. What can be deleted immediately?
17. What must remain until parity tests pass?
18. How are rollback paths maintained?
19. What acceptance criteria define completion?
20. What architecture decisions block all implementation?

---

# 26. Recommended QA Sequence

The architecture discussion should be completed in a controlled order.

## Phase 1: Define vocabulary and boundaries

Resolve:

- Component names
- Ownership
- Cloud versus local duplication
- Shared services
- Trust boundaries
- Control plane versus execution plane

## Phase 2: Define core contracts

Resolve:

- Registry resource model
- Context input and output contract
- Capability catalog
- Tool expansion
- Permission model
- Agent definition
- Agent invocation
- Run state

## Phase 3: Define cloud flow

Resolve:

- API routing
- Orchestration
- Context Worker
- Agent Runtime
- Gateway
- Connectors
- Memory
- Data
- Inter-worker communication

## Phase 4: Define local flow

Resolve:

- Local process model
- SQLite state
- Local Registry
- Local Context Engine
- Local MCP runtime
- Local agent execution
- Bridge
- Offline behavior

## Phase 5: Define hybrid behavior

Resolve:

- Local calls to cloud capabilities
- Cloud agent versus local agent selection
- Cross-runtime child agents
- Artifact transfer
- Memory access
- Connector access
- Capability synchronization

## Phase 6: Define lifecycle and resilience

Resolve:

- Transcript
- Compaction
- Pause and resume
- Checkpoints
- Recovery
- Cancellation
- Goals
- Observability

## Phase 7: Create the implementation plan

Only after the previous phases should the project select:

- Frameworks
- Databases
- Cloudflare primitives
- Process architecture
- API schemas
- Code folder layout
- Migration phases
- Testing strategy

---

# 27. Required Deliverables From the Future Architecture Session

The extended QA session should eventually produce the following artifacts.

1. **Final component map**  
   Every component, responsibility, owner, runtime, persistence system, and trust level.

2. **Cloud deployment diagram**  
   Workers, databases, R2, service bindings, queues, Durable Objects, workflows, and request paths.

3. **Local process diagram**  
   Tauri application, sidecars, SQLite, MCP processes, UI event transport, and cloud-access client.

4. **Cloud/local parity matrix**  
   Which capabilities exist in both, which differ, and which remain cloud-only.

5. **Registry schema**  
   Canonical schemas for MCP servers, tools, skills, agents, connectors, and system capabilities.

6. **Context package schema**  
   Exact provider-neutral structure produced by the Context Worker and Context Engine.

7. **Capability discovery protocol**  
   Tool Pool behavior, progressive schema expansion, filtering, and caching.

8. **Permission model**  
   User, workspace, agent, run, tool, data, and connector authorization.

9. **Agent definition schema**  
   Declarative agent configuration and versioning.

10. **Agent execution protocol**  
    Spawn, await, message, cancel, pause, resume, status, and result formats.

11. **Run state machine**  
    State transitions, checkpoints, failures, retries, and recovery.

12. **Bridge contract**  
    The exact curated cloud capabilities available to local Studio.

13. **API capability map**  
    Public and internal endpoints organized around capabilities rather than service topology.

14. **Data model**  
    Conversations, files, generated media, artifacts, metadata, and local/cloud boundaries.

15. **Migration plan**  
    Ordered steps for replacing old Gateway, chat loop, registries, and local MCP integration.

16. **Deletion plan**  
    Exact folders, workers, routes, schemas, and dependencies that can be safely removed.

17. **Acceptance tests**  
    Tests that prove cloud and local behavior follows the selected architecture.

---

# 28. Current Working Summary

The current design can be summarized as follows:

- Studio will have cloud and local runtime categories.
- Both will follow the same conceptual architecture.
- Gateway V2 will replace the old Gateway after parity verification.
- The resulting Gateway will remain a focused, shared Cloudflare Worker.
- Cloud and local will each have their own Context system.
- Cloud and local will each have their own Registry.
- Cloud and local will each have MCP, Skill, and Agent libraries.
- Agent definitions will be declarative.
- Agent execution logic will live in an Agent Runtime.
- The cloud version may initially have an empty user MCP Library and Agent Library.
- The cloud Skill Library will initially contain one product-sales knowledge skill.
- System MCP servers will still be required even when user libraries are empty.
- Tools, skills, agents, MCP servers, and connectors should not all be fully exposed to the model by default.
- A Tool Pool or capability-discovery layer should support progressive expansion.
- Permissions must be enforced by runtime code.
- A cloud orchestration mechanism may be required for inter-worker execution.
- Agent-to-agent communication may use direct reporting plus an optional shared blackboard.
- Connectors will remain cloud-hosted.
- Studio Data will store cloud conversations, uploaded files, and generated media.
- Local Studio will run its own agents, context, registry, MCP servers, skills, and state.
- Local state will likely use SQLite or an equivalent embedded database.
- Local Studio will access selected cloud capabilities through an authenticated Bridge or similar capability layer.
- The cloud API should use capability-based routing rather than expose internal service topology.
- Transcript, compaction, titles, checkpoints, pause/resume, goals, and advanced autonomous state are required later.
- No final stack or architecture implementation has yet been selected.
- The next step is a structured QA process that resolves the questions in this document before implementation begins.

---

# 29. Instruction for the Architecture-Review LLM

Use this document as the source brief for an interactive architecture-design session.

Do not immediately select frameworks or produce a final architecture.

First:

1. Identify contradictions, ambiguous boundaries, and missing components.
2. Separate confirmed requirements from assumptions.
3. Ask questions in dependency order.
4. Avoid asking questions whose answers do not affect the architecture.
5. Explain the consequence of each major choice.
6. Present alternatives only where they are materially different.
7. Record each decision as it is made.
8. Maintain a live decision log.
9. Update the component map after each major decision.
10. Do not collapse cloud and local into one runtime.
11. Do not expose internal cloud services merely to make local integration easier.
12. Do not treat prompts as a security boundary.
13. Do not treat the Context system as a catch-all service.
14. Do not treat the Registry as an execution engine.
15. Do not finalize the technology stack until the contracts and boundaries are settled.

The final architecture should be produced only after the foundational questions are answered.
