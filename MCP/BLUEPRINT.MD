**Studio Web MCP**

---

# 1. Project Definition

**Studio Web MCP** is a Cloudflare-hosted, remote MCP server that exposes web information capabilities to MCP-compatible AI clients.

Its initial responsibilities are:

1. **Web Search**

   * Primary: Tavily Search
   * Optional fallback: another search provider
   * Parallel/batched search support

2. **Web Fetch**

   * Primary: Jina Reader
   * Optional fallback: Tavily Extract
   * Parallel/batched URL fetching
   * Content-size control
   * Offset/pagination support where appropriate

3. **Provider abstraction**

   * Providers are isolated from MCP tools.
   * Adding/removing a provider should not require rewriting the MCP layer.

4. **Centralized errors**

   * Provider errors, configuration errors, validation errors, MCP errors, and internal errors all pass through one normalized error system.

5. **Cloudflare-native deployment**

   * TypeScript
   * Cloudflare Workers
   * Stateless
   * No database required initially
   * No authentication layer initially
   * Provider API keys remain server-side secrets

The fundamental architecture should be:

```text
MCP Client
    │
    │ MCP / Streamable HTTP
    ▼
┌───────────────────────────────┐
│       Studio Web MCP          │
│                               │
│  MCP Protocol Layer           │
│          │                    │
│  Tool Layer                   │
│      ├── Search               │
│      └── Fetch                │
│          │                    │
│  Orchestration Layer          │
│      ├── Provider selection   │
│      ├── Primary/fallback     │
│      ├── Parallel execution   │
│      └── Result normalization │
│          │                    │
│  Provider Layer               │
│      ├── Tavily               │
│      ├── Jina                 │
│      └── Future providers     │
│          │                    │
│  Error Layer                  │
│  Config Layer                 │
└───────────────────────────────┘
       │             │
       ▼             ▼
   Tavily API     Jina Reader
```

---

# 2. MCP Version: Use the 2026-07-28 Specification

This is an important change from older MCP architecture.

The current MCP specification is **2026-07-28**. It introduced a substantially different protocol model:

* stateless protocol core
* no `initialize` / `initialized` handshake
* no `Mcp-Session-Id`
* optional `server/discover`
* per-request metadata
* header-based routing
* `Mcp-Method`
* `Mcp-Name`
* Multi Round-Trip Requests
* cacheable list responses
* updated Streamable HTTP behavior

The official MCP documentation describes the 2026-07-28 version as the current specification. ([Model Context Protocol Blog][2])

The TypeScript SDK also explicitly distinguishes the new **2026 modern era** from the older 2025-era protocol. ([GitHub][3])

### Therefore:

**Do not build this using:**

```text
initialize
initialized
Mcp-Session-Id
old SSE transport
session-based HTTP architecture
```

The project should target:

```text
MCP 2026-07-28
        +
Streamable HTTP
        +
stateless server
        +
Cloudflare Workers
```

The new Streamable HTTP model uses a single MCP endpoint, normally something such as:

```text
https://web-mcp.studio.example/mcp
```

and requests are sent to that endpoint through HTTP POST. ([GitHub][4])

---

# 3. Cloudflare Architecture

The server should be deliberately simple.

```text
Cloudflare Edge
      │
      ▼
Cloudflare Worker
      │
      ├── MCP HTTP Handler
      │
      ├── Request Validation
      │
      ├── Tool Dispatcher
      │
      ├── Search Runtime
      │
      ├── Fetch Runtime
      │
      └── Provider Clients
              │
              ├── Tavily
              └── Jina
```

There is no reason to introduce:

* PostgreSQL
* Redis
* Durable Objects
* queues
* R2
* KV
* a separate API server
* a Node backend

for the initial version.

The new MCP protocol's stateless design is particularly suitable for this deployment model because requests can land on different Worker instances without requiring protocol-level session storage. ([Model Context Protocol Blog][2])

---

# 4. Recommended Repository Structure

I would **not** make this a huge monorepo.

At the same time, I would avoid putting everything into `src/index.ts`.

Recommended:

```text
studio-web-mcp/
│
├── src/
│   │
│   ├── server/
│   │   ├── server.ts
│   │   ├── handler.ts
│   │   └── metadata.ts
│   │
│   ├── tools/
│   │   │
│   │   ├── search/
│   │   │   ├── index.ts
│   │   │   ├── schema.ts
│   │   │   ├── handler.ts
│   │   │   └── types.ts
│   │   │
│   │   └── fetch/
│   │       ├── index.ts
│   │       ├── schema.ts
│   │       ├── handler.ts
│   │       └── types.ts
│   │
│   ├── providers/
│   │   │
│   │   ├── search/
│   │   │   ├── types.ts
│   │   │   ├── tavily/
│   │   │   │   ├── client.ts
│   │   │   │   ├── mapper.ts
│   │   │   │   └── errors.ts
│   │   │   └── brave/
│   │   │       ├── client.ts
│   │   │       ├── mapper.ts
│   │   │       └── errors.ts
│   │   │
│   │   └── fetch/
│   │       ├── types.ts
│   │       ├── jina/
│   │       │   ├── client.ts
│   │       │   ├── mapper.ts
│   │       │   └── errors.ts
│   │       └── tavily/
│   │           ├── client.ts
│   │           ├── mapper.ts
│   │           └── errors.ts
│   │
│   ├── runtime/
│   │   ├── search/
│   │   │   ├── execute.ts
│   │   │   ├── parallel.ts
│   │   │   └── fallback.ts
│   │   │
│   │   └── fetch/
│   │       ├── execute.ts
│   │       ├── parallel.ts
│   │       ├── fallback.ts
│   │       └── content.ts
│   │
│   ├── errors/
│   │   ├── error.ts
│   │   ├── codes.ts
│   │   ├── normalize.ts
│   │   └── response.ts
│   │
│   ├── config/
│   │   ├── env.ts
│   │   ├── providers.ts
│   │   └── defaults.ts
│   │
│   ├── validation/
│   │   ├── url.ts
│   │   ├── input.ts
│   │   └── security.ts
│   │
│   └── shared/
│       ├── types.ts
│       ├── constants.ts
│       └── utils.ts
│
├── tests/
│   ├── tools/
│   ├── providers/
│   ├── runtime/
│   ├── errors/
│   └── integration/
│
├── docs/
│   ├── architecture.md
│   ├── providers.md
│   ├── tools.md
│   ├── errors.md
│   └── deployment.md
│
├── wrangler.jsonc
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
├── .dev.vars.example
├── .gitignore
└── README.md
```

This gives you separation without turning the project into dozens of artificial packages.

---

# 5. Why This Structure

The important architectural rule is:

> **MCP should know about capabilities, not provider implementations.**

For example:

```text
MCP search tool
      ↓
Search Runtime
      ↓
Search Provider Interface
      ↓
Tavily / Brave / future provider
```

Not:

```text
MCP search
      ↓
Tavily directly
```

That distinction is what makes fallback and provider replacement clean.

Similarly:

```text
MCP fetch tool
      ↓
Fetch Runtime
      ↓
Fetch Provider Interface
      ↓
Jina / Tavily / future provider
```

---

# 6. Provider Interfaces

The internal provider contract should be provider-neutral.

For example:

```text
SearchProvider

search(input)
  → normalized SearchResponse
```

and:

```text
FetchProvider

fetch(input)
  → normalized FetchResponse
```

The MCP layer should never need to know that Tavily calls something `results`, while another provider calls it something else.

The provider adapter handles that.

---

# 7. Search Providers

## Primary

**Tavily Search**

Tavily's current Search API supports:

* general search
* news
* finance
* search depth
* time ranges
* domain inclusion/exclusion
* raw content
* images
* country boosting
* configurable result counts

and currently exposes `/search` as its primary search endpoint. ([Tavily Docs][5])

Recommended initial configuration:

```text
SEARCH_PRIMARY=tavily
SEARCH_FALLBACK=brave
```

However, I would **not automatically implement five or ten providers** in v1.

Start with:

```text
Tavily
Brave
```

and keep the interface open for:

```text
Google
Bing
Exa
Jina Search
Perplexity
Serper
etc.
```

without implementing them.

This gives the architecture extensibility without creating maintenance debt.

---

# 8. Fetch Providers

## Primary

**Jina Reader**

Jina Reader is a particularly appropriate fetch provider because its purpose is converting URLs into LLM-friendly representations. It supports web pages and also handles PDFs, Office documents, and images. ([GitHub][1])

Therefore:

```text
FETCH_PRIMARY=jina
FETCH_FALLBACK=tavily
```

Tavily Extract is a sensible fallback because Tavily provides an extraction endpoint that accepts one or more URLs and returns extracted content. ([Tavily Docs][6])

The architecture should therefore be:

```text
             ┌── Jina Reader
Fetch ───────┤
             └── Tavily Extract
```

Not:

```text
Fetch
 ├── Jina
 ├── Firecrawl
 ├── Browserless
 ├── Crawl4AI
 ├── Tavily
 ├── ...
```

at least initially.

---

# 9. Provider Configuration

Use **environment variables for secrets and deployment configuration**, but don't put all behavior into arbitrary environment variables.

Recommended:

```text
TAVILY_API_KEY
JINA_API_KEY

SEARCH_PRIMARY
SEARCH_FALLBACK

FETCH_PRIMARY
FETCH_FALLBACK
```

For example:

```text
SEARCH_PRIMARY=tavily
SEARCH_FALLBACK=brave

FETCH_PRIMARY=jina
FETCH_FALLBACK=tavily
```

But the provider registry itself should be code:

```text
providers/
    search/
    fetch/
```

The environment determines selection.

This avoids hardcoding:

```text
if (provider === "tavily") ...
else if (provider === "brave") ...
else if (...)
```

throughout the application.

---

# 10. Primary + One Fallback

I agree with your restriction:

> One primary + one fallback.

That should be an explicit invariant.

For example:

```text
Search:
    primary: tavily
    fallback: brave

Fetch:
    primary: jina
    fallback: tavily
```

Not:

```text
Tavily
 → Brave
 → Google
 → Bing
 → Exa
 → Jina
 → ...
```

A giant fallback waterfall can actually make an AI tool worse because failures become slow and unpredictable.

The runtime should perform:

```text
primary
   │
   ├── success → return
   │
   └── retryable failure
            │
            ▼
        fallback
            │
            ├── success → return
            └── failure → normalized error
```

Importantly, **not every error should trigger fallback**.

---

# 11. Error Classification

This is one of the most important pieces of the architecture.

Create a centralized error taxonomy.

For example:

```text
CONFIGURATION_ERROR
PROVIDER_NOT_CONFIGURED

AUTHENTICATION_ERROR
AUTHORIZATION_ERROR

INVALID_REQUEST
INVALID_URL
INVALID_QUERY
INVALID_PARAMETERS

RATE_LIMITED
QUOTA_EXCEEDED
CREDIT_EXHAUSTED

PROVIDER_UNAVAILABLE
PROVIDER_TIMEOUT
PROVIDER_NETWORK_ERROR

UPSTREAM_BAD_REQUEST
UPSTREAM_UNAUTHORIZED
UPSTREAM_FORBIDDEN
UPSTREAM_NOT_FOUND
UPSTREAM_CONFLICT
UPSTREAM_UNPROCESSABLE
UPSTREAM_RATE_LIMITED

UPSTREAM_SERVER_ERROR
UPSTREAM_BAD_GATEWAY
UPSTREAM_SERVICE_UNAVAILABLE
UPSTREAM_GATEWAY_TIMEOUT

FETCH_FAILED
SEARCH_FAILED
CONTENT_TOO_LARGE
CONTENT_UNAVAILABLE

ALL_PROVIDERS_FAILED

INTERNAL_ERROR
MCP_PROTOCOL_ERROR
```

The exact mapping should be determined against each provider's current API documentation during implementation.

For example, Tavily currently documents HTTP responses including `400`, `401`, `429`, `432`, `433`, and `500`, in addition to successful `200` responses. ([Tavily Docs][5])

The project should **not blindly expose those provider-specific codes to the MCP client**.

Instead:

```text
Tavily 429
      ↓
RATE_LIMITED
      ↓
fallback eligible
```

or:

```text
Tavily 401
      ↓
PROVIDER_AUTHENTICATION_ERROR
      ↓
fallback / configuration decision
```

---

# 12. Centralized Error Pipeline

Every error should eventually pass through:

```text
Provider
   ↓
Provider Error
   ↓
normalizeError()
   ↓
StudioError
   ↓
MCP response formatter
   ↓
MCP client
```

No tool should do this independently:

```text
catch (e) {
   return { error: "something went wrong" }
}
```

Instead:

```text
catch (error) {
    throw normalizeProviderError(error)
}
```

Then one centralized mechanism determines:

* error code
* message
* retryability
* fallback eligibility
* HTTP status
* provider
* optional metadata
* request ID

---

# 13. Error Object

Internally, something conceptually like:

```text
StudioError
├── code
├── message
├── category
├── provider
├── retryable
├── fallbackEligible
├── status
├── cause
└── metadata
```

For example:

```text
{
  code: "RATE_LIMITED",
  category: "provider",
  provider: "tavily",
  retryable: true,
  fallbackEligible: true
}
```

The external MCP representation should remain concise.

Do not leak:

* API keys
* provider credentials
* internal stack traces
* Cloudflare internals
* environment variables
* sensitive request metadata

---

# 14. Fallback Policy

Not every error should trigger fallback.

### Fallback-worthy

Usually:

```text
timeout
temporary network failure
5xx
429
provider unavailable
provider extraction failure
```

### Usually not fallback-worthy

Usually:

```text
invalid query
invalid URL
malformed parameters
unsupported request
configuration error
```

There is one important exception:

If the primary provider is configured incorrectly, automatically falling back may hide an operational problem.

For example:

```text
TAVILY_API_KEY missing
```

should normally produce:

```text
PROVIDER_NOT_CONFIGURED
```

rather than silently pretending everything is healthy through another provider.

The exact policy should be part of the implementation research.

---

# 15. Search Tool Design

I would expose one primary MCP tool:

```text
search
```

with a schema conceptually like:

```text
search({
    query,
    max_results?,
    topic?,
    time_range?,
    domains?,
    exclude_domains?,
    country?,
    search_depth?
})
```

Do **not** expose:

```text
tavily_search
brave_search
google_search
```

to the model.

Provider selection is infrastructure.

The LLM should think:

> Search the web.

not:

> Decide which search vendor to call.

---

# 16. Parallel Search

There are two different meanings of parallel search.

### A. Multiple provider searches

Potentially:

```text
Tavily
+
Brave
```

simultaneously.

I would **not do this by default**.

If Tavily is primary and Brave is fallback, Brave should not normally run concurrently.

### B. Multiple independent queries

This is useful.

For example:

```text
queries:
[
    "MCP 2026 specification",
    "MCP TypeScript SDK",
    "Cloudflare MCP"
]
```

The runtime can execute:

```text
Promise.all(...)
```

with a concurrency limit.

However, I would initially keep the public MCP interface simple:

```text
search(query)
```

and allow the host/agent runtime to issue multiple MCP calls concurrently.

If benchmarking shows value in server-side batching, add:

```text
search_many(...)
```

later.

---

# 17. Fetch Tool

Primary MCP tool:

```text
fetch
```

Conceptually:

```text
fetch({
    url,
    format?,
    max_chars?,
    offset?,
    ...
})
```

For multiple URLs:

```text
fetch({
    urls: [...]
})
```

could be supported internally or as a separate batch operation.

The important distinction is that **the model should not receive uncontrolled enormous documents**.

---

# 18. The RAG Question

Your concern here is valid, but I would **not put a RAG system inside this MCP server initially**.

A web-fetch MCP server and a RAG system solve different problems.

### Web fetch

```text
URL
 ↓
retrieve
 ↓
clean
 ↓
return relevant content
```

### RAG

```text
large corpus
 ↓
index
 ↓
chunk
 ↓
embed
 ↓
retrieve
 ↓
rerank
 ↓
context
```

A single arbitrary webpage is not automatically a RAG problem.

Adding a vector database to this MCP server would introduce:

* storage
* embeddings
* indexing
* lifecycle management
* cache invalidation
* retrieval algorithms
* additional latency
* additional infrastructure

without necessarily solving your actual problem.

---

# 19. The Real Problem: Context Size

The actual problem you identified is:

> What happens when `fetch()` returns 100,000 tokens?

That is a **context management problem**, not necessarily a RAG problem.

The MCP server should therefore implement **content delivery controls**.

For example:

```text
fetch(url)
     ↓
Jina
     ↓
large document
     ↓
content normalization
     ↓
size estimation
     ↓
limit
     ↓
return bounded result
```

---

# 20. Offset / Pagination Mechanism

I would explicitly design for this.

Conceptually:

```text
fetch({
    url: "...",
    offset: 0,
    max_chars: 20000
})
```

Response:

```text
{
    content: "...",
    metadata: {
        offset: 0,
        returned: 20000,
        total_estimated: 85000,
        has_more: true,
        next_offset: 20000
    }
}
```

Then the model can request:

```text
offset: 20000
```

and continue.

This is significantly simpler than introducing RAG.

However, **do not assume Jina itself provides exactly this interface**. Jina Reader provides LLM-friendly content and multiple output/control mechanisms, but the MCP server should own the final context-management contract. ([GitHub][1])

---

# 21. Better Than Blind Offsets

Pure character offsets are not ideal.

The implementation should investigate whether the returned document can be segmented structurally:

```text
Document
├── title
├── introduction
├── section 1
├── section 2
├── section 3
└── conclusion
```

Then potentially expose:

```text
section
```

or:

```text
start_offset
end_offset
```

or both.

The exact mechanism should be decided after testing Jina's current output.

---

# 22. Token Budget

The server should **not attempt to perfectly calculate the consuming LLM's token count**.

It doesn't know:

* which model the host is using
* its tokenizer
* the host's system prompt
* conversation history
* other tool results
* remaining context window

Therefore:

```text
MCP server ≠ context-window manager
```

Instead, the MCP server should provide bounded output.

For example:

```text
max_chars
max_bytes
offset
```

and perhaps:

```text
max_content_length
```

The **Studio harness/context engine** should make the final decision about how much retrieved information can enter the model context.

That fits your broader Studio architecture much better.

---

# 23. Recommended Responsibility Boundary

This is important.

### Studio Web MCP

Responsible for:

```text
Internet
 ↓
Search
 ↓
Fetch
 ↓
Normalize
 ↓
Bound
 ↓
Return
```

### Studio Context Engine

Responsible for:

```text
Tool result
 ↓
Context budget
 ↓
Relevance
 ↓
History
 ↓
Other tools
 ↓
Model context
```

### Studio Agent Runtime

Responsible for:

```text
What should I search?
What should I fetch?
Should I fetch more?
Should I inspect another section?
```

Therefore, **do not put your Studio RAG/context engine inside the Web MCP server**.

---

# 24. Tool Result vs File

You also raised an important question about whether the fetched document becomes a tool result or a file.

The MCP server should treat the result as **MCP content**, not assume anything about how the host internally stores it.

The MCP protocol transports the result.

The **MCP client/host decides how that result enters the model context**.

Different hosts can:

```text
tool result
→ conversation context
```

or:

```text
tool result
→ internal artifact/file
→ model reads selected content
```

or:

```text
tool result
→ resource
→ model requests resource
```

Your server should therefore not depend on Anthropic, OpenAI, Studio, or any other particular host's internal representation.

This is precisely why the server should return structured, bounded information rather than dumping arbitrary pages.

---

# 25. Content Response Structure

I would normalize fetch responses into something conceptually like:

```text
FetchResult
├── url
├── final_url
├── title
├── content
├── content_type
├── format
├── status
├── source
├── fetched_at
├── truncated
├── offset
├── has_more
└── metadata
```

This allows the Studio harness to understand:

```text
What was fetched?
Where did it come from?
Was it truncated?
Can more be requested?
```

without parsing provider-specific responses.

---

# 26. Provider Normalization

For example, Tavily might return:

```text
results[]
raw_content
favicon
score
```

while Jina may return:

```text
markdown
title
links
metadata
```

The model should never have to understand these differences.

Adapters convert them:

```text
Tavily ──┐
         ├──> NormalizedSearchResult
Brave ───┘

Jina ────┐
         ├──> NormalizedFetchResult
Tavily ──┘
```

---

# 27. Configuration Registry

Create provider registries:

```text
SearchProviderRegistry
FetchProviderRegistry
```

Conceptually:

```text
Search Providers
├── tavily
└── brave

Fetch Providers
├── jina
└── tavily
```

The runtime asks:

```text
registry.get(primary)
```

and:

```text
registry.get(fallback)
```

rather than knowing provider implementations.

---

# 28. Security

You said no authentication.

That is acceptable as an architectural choice, but it means:

```text
Anyone who knows the MCP endpoint
        ↓
can potentially call it
        ↓
which can spend your provider API credits
```

So **no authentication does not mean no security controls**.

At minimum, investigate:

```text
Cloudflare rate limiting
request size limits
URL validation
timeout limits
provider quota protection
```

particularly because `fetch(url)` creates a public URL retrieval surface.

The MCP specification itself recommends proper authentication for remote connections, although your stated requirement is to intentionally omit authentication. ([GitHub][4])

That decision should therefore be explicitly documented as:

```text
Authentication:
    Disabled by design in initial deployment.
```

Do not accidentally implement an auth system later because the architecture assumed one.

---

# 29. SSRF / URL Safety

This deserves its own component:

```text
validation/security.ts
```

A public fetch service should not blindly assume every URL is harmless.

The implementation should research Cloudflare Worker `fetch()` behavior and establish a URL policy.

At minimum investigate:

```text
http
https
localhost
private IP ranges
loopback
internal addresses
non-standard ports
redirects
DNS rebinding
URL schemes
```

The MCP specification also requires Origin validation for Streamable HTTP implementations as a DNS-rebinding defense. ([GitHub][4])

So:

```text
MCP Origin validation
+
fetch URL validation
```

are separate security layers.

---

# 30. Logging

For v1, I agree with **not building a full logging subsystem**.

But there is a distinction between:

```text
logging system
```

and:

```text
operational observability
```

Don't create:

```text
src/logging/
    logger.ts
    transports/
    formatters/
    sinks/
    ...
```

yet.

However, Cloudflare's platform-level request/error observability should remain available.

The application itself can initially have minimal error reporting without becoming a logging framework.

---

# 31. Testing Structure

Tests should follow the architecture.

```text
tests/
├── providers/
│   ├── tavily-search.test.ts
│   ├── jina-fetch.test.ts
│   └── tavily-extract.test.ts
│
├── runtime/
│   ├── search-fallback.test.ts
│   ├── fetch-fallback.test.ts
│   ├── parallel-search.test.ts
│   └── parallel-fetch.test.ts
│
├── errors/
│   ├── normalization.test.ts
│   └── classification.test.ts
│
├── tools/
│   ├── search.test.ts
│   └── fetch.test.ts
│
└── integration/
    └── mcp.test.ts
```

Provider tests should use mocked HTTP responses rather than spending API credits.

Then have a small number of optional live integration tests.

---

# 32. MCP Tools

Initial tool surface should remain extremely small:

```text
search
fetch
```

Potentially later:

```text
search_many
fetch_many
```

But don't expose every provider operation.

I would **not** initially expose:

```text
tavily_search
tavily_extract
jina_reader
brave_search
```

because that leaks implementation details into the agent's tool space.

---

# 33. Resources and Prompts

For v1:

```text
Resources: none
Prompts: none
Tools: search, fetch
```

There is no reason to implement MCP primitives merely because the protocol supports them.

The server's job is narrow.

---

# 34. MCP Metadata

The server should advertise itself clearly:

```text
name:
    studio-web

version:
    x.y.z

description:
    Web search and web content retrieval for Studio.
```

Tool descriptions should be carefully written because the tool descriptions themselves become part of the model's usable interface.

---

# 35. Caching

Do not introduce a persistent cache initially.

Cloudflare's edge architecture may eventually make caching useful, particularly for:

```text
search result catalogs
```

and:

```text
repeat fetches
```

but this should be measured first.

The current MCP specification itself introduces cache hints for list results, so MCP-level capability discovery/tool-list caching should be handled according to the SDK/spec rather than invented in the application. ([Model Context Protocol Blog][2])

---

# 36. Recommended v1 Provider Matrix

| Capability | Primary     | Fallback       | v1  |
| ---------- | ----------- | -------------- | --- |
| Search     | Tavily      | Brave          | Yes |
| Fetch      | Jina Reader | Tavily Extract | Yes |
| Search     | Jina Search | —              | No  |
| Search     | Exa         | —              | No  |
| Search     | Google      | —              | No  |
| Search     | Bing        | —              | No  |
| Fetch      | Firecrawl   | —              | No  |
| Fetch      | Browserless | —              | No  |
| Fetch      | Crawl4AI    | —              | No  |

This is intentionally conservative.

The architecture supports more providers without requiring them immediately.

---

# 37. Why Not Firecrawl?

Not because Firecrawl is inherently bad.

The issue is scope.

Your requirement is:

```text
Search
+
Fetch
```

not:

```text
full web crawling platform
```

Firecrawl-like functionality would introduce a substantially larger abstraction surface.

Jina Reader is already explicitly designed around LLM-friendly URL retrieval. ([GitHub][1])

Tavily also already provides both search and extraction APIs. ([Tavily Docs][6])

So the initial architecture can remain small.

---

# 38. Project Dependency Philosophy

Keep dependencies minimal.

Conceptually:

```text
@modelcontextprotocol/sdk
cloudflare / workers tooling
schema validation library
test framework
```

Then provider SDKs only where they provide meaningful value.

It may actually be preferable to use native `fetch()` against Tavily/Jina APIs rather than importing unnecessarily large provider SDKs.

That fits the project's stated goal:

> smallest, lightest, most efficient MCP server possible.

---

# 39. Runtime Execution

The execution path should look like:

```text
MCP request
      │
      ▼
Tool validation
      │
      ▼
Tool handler
      │
      ▼
Runtime
      │
      ├── resolve primary provider
      │
      ├── execute
      │
      ├── classify failure
      │
      ├── fallback if eligible
      │
      └── normalize result
      │
      ▼
MCP result
```

This is considerably cleaner than putting provider logic inside MCP handlers.

---

# 40. Search Runtime

```text
SearchRuntime
│
├── resolvePrimary()
├── resolveFallback()
├── execute()
├── shouldFallback()
└── normalize()
```

Parallel mode:

```text
SearchRuntime
      │
      ├── Query A ──┐
      ├── Query B ──┼── concurrency controller
      ├── Query C ──┤
      └── Query D ──┘
```

with a configurable maximum concurrency.

Do not allow unlimited `Promise.all()` from user-controlled arrays.

---

# 41. Fetch Runtime

Same pattern:

```text
FetchRuntime
│
├── resolvePrimary()
├── resolveFallback()
├── execute()
├── shouldFallback()
├── normalize()
└── boundContent()
```

Parallel:

```text
URL A ──┐
URL B ──┤
URL C ──┼── concurrency limit
URL D ──┘
```

---

# 42. Timeouts

Every upstream provider call should have a timeout.

Never let:

```text
MCP request
   ↓
provider hangs
   ↓
Worker waits indefinitely
```

Use:

```text
AbortController
+
provider-specific timeout
```

Then classify:

```text
PROVIDER_TIMEOUT
```

and decide whether fallback is appropriate.

---

# 43. Request IDs

Even without a logging system, every request should have an internal correlation identifier.

For example:

```text
request_id
```

This can be returned in error metadata when appropriate and used with Cloudflare/provider support.

Tavily itself returns a `request_id`, which is useful for provider-side troubleshooting. ([Tavily Docs][6])

---

# 44. Configuration Validation

Worker startup should validate:

```text
SEARCH_PRIMARY
SEARCH_FALLBACK
FETCH_PRIMARY
FETCH_FALLBACK
```

and provider credentials.

For example:

```text
SEARCH_PRIMARY=tavily
```

requires:

```text
TAVILY_API_KEY
```

If the selected provider has no credentials:

```text
PROVIDER_NOT_CONFIGURED
```

should occur immediately rather than during the first real user request if Cloudflare's runtime model allows safe startup/config validation.

---

# 45. No Hardcoded Secrets

Local development:

```text
.dev.vars
```

Production:

```text
wrangler secret
```

or the appropriate Cloudflare secret-management mechanism.

Repository contains only:

```text
.dev.vars.example
```

with:

```text
TAVILY_API_KEY=
JINA_API_KEY=
SEARCH_PRIMARY=tavily
SEARCH_FALLBACK=brave
FETCH_PRIMARY=jina
FETCH_FALLBACK=tavily
```

---

# 46. Versioning

The MCP server itself should have independent semantic versioning:

```text
0.x
```

during development, then:

```text
1.0.0
```

when the tool contracts stabilize.

Do not confuse:

```text
Studio Web MCP version
```

with:

```text
MCP protocol version
```

They are separate.

Example:

```text
Studio Web MCP: 1.2.0
MCP Protocol: 2026-07-28
```

---

# 47. Documentation

`README.md` should contain only the essential information:

```text
Studio Web MCP
├── Purpose
├── Features
├── MCP endpoint
├── Tools
├── Provider configuration
├── Local development
└── Deployment
```

Then:

```text
docs/
├── architecture.md
├── providers.md
├── tools.md
├── errors.md
└── deployment.md
```

This prevents README from becoming an architecture dump.

---

# 48. Implementation Phases

## Phase 0 — Research

Before writing production code:

1. Verify MCP 2026-07-28 TypeScript SDK APIs.
2. Verify Cloudflare Worker compatibility.
3. Verify Streamable HTTP implementation.
4. Verify MCP Origin handling.
5. Verify current Tavily Search API.
6. Verify current Tavily Extract API.
7. Verify current Jina Reader API.
8. Determine exact provider error mappings.
9. Test large Jina responses.
10. Test how MCP clients consume large tool results.
11. Determine practical truncation limits.
12. Determine whether structured document offsets are useful.

This phase is explicitly required because MCP has just undergone a breaking protocol revision.

---

# 49. Phase 1 — Minimal MCP Server

Build:

```text
Cloudflare Worker
      ↓
MCP 2026-07-28
      ↓
Streamable HTTP
      ↓
one test tool
```

Before adding providers.

Verify:

```text
MCP Inspector
compatible clients
server/discover
tools/list
tools/call
```

---

# 50. Phase 2 — Search

Implement:

```text
search/
providers/search/tavily/
runtime/search/
```

Then:

```text
search
  ↓
Tavily
  ↓
normalized result
```

---

# 51. Phase 3 — Fetch

Implement:

```text
fetch/
providers/fetch/jina/
runtime/fetch/
```

Then:

```text
fetch
  ↓
Jina
  ↓
normalized content
```

---

# 52. Phase 4 — Fallback

Add:

```text
Tavily → Brave
Jina → Tavily
```

with centralized error classification.

---

# 53. Phase 5 — Parallelism

Add:

```text
parallel search
parallel fetch
concurrency control
```

without changing the provider layer.

---

# 54. Phase 6 — Large Content Handling

Benchmark:

```text
1 KB
10 KB
50 KB
100 KB
500 KB
1 MB+
```

Then establish:

```text
maximum response size
default content size
offset strategy
truncation behavior
```

Do this based on actual MCP client/model behavior rather than guessing.

---

# 55. Phase 7 — Hardening

Add:

```text
Origin validation
URL validation
timeout enforcement
request-size limits
concurrency limits
provider quota protection
error sanitization
```

Then production deployment.

---

# 56. Final Architecture

The resulting system should remain approximately this simple:

```text
                         ┌─────────────────────┐
                         │     MCP Clients     │
                         │ Studio / Claude /   │
                         │ Cursor / etc.       │
                         └──────────┬──────────┘
                                    │
                         Streamable HTTP
                                    │
                                    ▼
                    ┌────────────────────────────┐
                    │    Studio Web MCP          │
                    │    Cloudflare Worker       │
                    │                            │
                    │ ┌────────────────────────┐ │
                    │ │ MCP Protocol Layer      │ │
                    │ └────────────┬───────────┘ │
                    │              │             │
                    │ ┌────────────▼───────────┐ │
                    │ │ Tool Layer             │ │
                    │ │ search / fetch         │ │
                    │ └────────────┬───────────┘ │
                    │              │             │
                    │ ┌────────────▼───────────┐ │
                    │ │ Runtime Layer           │ │
                    │ │ fallback / parallel /  │ │
                    │ │ normalization / limits │ │
                    │ └────────────┬───────────┘ │
                    │              │             │
                    │       ┌──────┴──────┐      │
                    │       ▼             ▼      │
                    │   Search          Fetch    │
                    │   Providers       Providers│
                    │       │             │      │
                    └───────┼─────────────┼──────┘
                            │             │
                         Tavily          Jina
                            │             │
                         Brave         Tavily
```

---

# 57. The Key Architectural Decision

The most important design decision is this:

> **Studio Web MCP should be a thin web-capability layer, not a web-agent, crawler, RAG system, or context-management system.**

Its job is:

```text
SEARCH
FETCH
NORMALIZE
BOUND
FALLBACK
RETURN
```

Studio itself should handle:

```text
reasoning
context budgeting
memory
RAG
tool-result management
summarization
deciding whether more content is required
```

That separation will prevent this MCP server from becoming another large monolith.

---

# 58. Additional Research Requirements for the Implementing LLM

I would put the following directly into the project blueprint as **mandatory pre-implementation research**, rather than pretending the answers are already settled:

1. **MCP 2026-07-28**

   * Confirm current TypeScript SDK package/API.
   * Confirm Cloudflare Worker integration.
   * Confirm modern Streamable HTTP handler.
   * Confirm stateless configuration.
   * Confirm `server/discover`.
   * Confirm current tool registration API.
   * Confirm Origin validation requirements.

2. **Tavily**

   * Verify current Search API schema.
   * Verify current Extract API schema.
   * Verify all documented HTTP/error codes.
   * Verify rate-limit and credit behavior.
   * Verify timeout behavior.
   * Verify current API response limits.

3. **Jina Reader**

   * Verify current Reader API.
   * Verify authentication.
   * Verify output formats.
   * Verify maximum response sizes.
   * Verify document structure.
   * Verify PDF/document behavior.
   * Determine whether native pagination/offset exists.
   * Determine the best mechanism for partial document retrieval.

4. **MCP content behavior**

   * Test how major MCP clients represent large tool results.
   * Determine whether results are injected directly into model context.
   * Determine how clients handle oversized results.
   * Determine whether Resource Links or other MCP mechanisms are useful.
   * Determine what responsibility belongs to the MCP server versus the host.

5. **Large-document strategy**

   * Benchmark bounded fetches.
   * Compare character limits versus structural chunking.
   * Determine whether offset pagination is sufficient.
   * Explicitly decide whether RAG is unnecessary for v1.

6. **Security**

   * Research Cloudflare Worker outbound-request restrictions.
   * Design SSRF/URL validation.
   * Validate redirects.
   * Validate Origin.
   * Determine whether unauthenticated public operation requires Cloudflare rate limiting.

7. **Provider strategy**

   * Verify whether Brave is the best search fallback.
   * Do not add additional providers unless they provide a measurable advantage.
   * Keep provider interfaces extensible regardless.

---

## Recommended final v1 scope

```text
Project:
    Studio Web MCP

Runtime:
    Cloudflare Workers

Language:
    TypeScript

Protocol:
    MCP 2026-07-28

Transport:
    Streamable HTTP

Authentication:
    None initially

Tools:
    search
    fetch

Search:
    Tavily primary
    Brave fallback

Fetch:
    Jina Reader primary
    Tavily Extract fallback

Execution:
    Stateless
    Parallel-capable
    Concurrency-limited

Content:
    Normalized
    Size-bounded
    Offset/pagination-capable

Errors:
    Centralized
    Typed
    Normalized
    Provider-aware
    Fallback-aware

Storage:
    None initially

Database:
    None

RAG:
    None initially

Logging:
    No dedicated application logging subsystem

Security:
    Origin validation
    URL validation
    Timeout limits
    Request limits
    Optional Cloudflare rate limiting

Architecture:
    MCP → Tool → Runtime → Provider
```

The current MCP specification and TypeScript SDK make the **stateless Cloudflare Worker approach particularly appropriate** for this project; the main thing I would not freeze yet is the exact large-document/partial-fetch contract. That should be experimentally validated against Jina and real MCP hosts before becoming part of the public tool schema. ([Model Context Protocol Blog][2])

[1]: https://github.com/jina-ai/reader?utm_source=chatgpt.com "GitHub - jina-ai/reader: Convert any URL to an LLM-friendly input with a simple prefix https://r.jina.ai/ · GitHub"
[2]: https://blog.modelcontextprotocol.io/posts/2026-07-28/?utm_source=chatgpt.com "The 2026-07-28 Specification | Model Context Protocol Blog"
[3]: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md?utm_source=chatgpt.com "typescript-sdk/docs/protocol-versions.md at main · modelcontextprotocol/typescript-sdk · GitHub"
[4]: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx?utm_source=chatgpt.com "modelcontextprotocol/docs/specification/2026-07-28/basic/transports/streamable-http.mdx at main · modelcontextprotocol/modelcontextprotocol · GitHub"
[5]: https://docs.tavily.com/documentation/api-reference/endpoint/search?utm_source=chatgpt.com "Tavily Search - Tavily Docs"
[6]: https://docs.tavily.com/documentation/api-reference/endpoint/extract?utm_source=chatgpt.com "Tavily Extract - Tavily Docs"
