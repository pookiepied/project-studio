# ADR 0023 — Web Search And Fetch: One Tool, Several Providers, One Failure Shape

**Status:** accepted
**Builds on:** ADR 0013 (one tool per capability), ADR 0007 (secure credentials), ADR 0009 (local BYOK providers), ADR 0022 (network effect).
**Delivers:** `web_search`, `fetch`, and `src/retrieval/`.

## Context

Searching the web and reading a page both need a third party. There is no
built-in answer: the product owner's choice is Tavily for search and Jina Reader
for page extraction, and Project Studio is open source, so that choice is one
opinion among several. Brave and Exa are the other search services people
actually use.

Two failure modes to avoid, and they pull in opposite directions:

- **Hard-coding one vendor.** Everyone who prefers another has to fork.
- **A tool per vendor.** `tavily_search`, `brave_search`, `exa_search` — three
  schemas in the prompt for one capability, the model choosing a vendor it has
  no basis to choose between, and a fourth to add for the next service.

## Decision

### 1. One tool per capability. The model never names a provider.

```
web_search(query, limit)     → the configured search chain
fetch(url, format)           → the configured reader chain
```

This is ADR 0013's rule applied unchanged: `git` is one tool with subcommands,
not one tool per subcommand, and the same reasoning holds here. Which service
answers is **configuration**, decided by the user in onboarding and changed in
settings. It never appears in the tool schema, so adding a provider costs zero
prompt tokens and zero cache invalidation — which is exactly the property
`mental-model.md` §3.3 says to protect.

The result names the provider that answered, because a user comparing results
needs to know which service produced them.

### 2. A chain, not a single provider

Each capability holds an ordered list. The first configured provider answers;
the next one is tried only on a failure that another provider could plausibly
survive.

| Capability | Default chain | Also supported |
|---|---|---|
| `web_search` | `tavily` | `brave`, `exa` |
| `fetch` | `direct`, then `jina` | — |

**Search defaults to Tavily** because it returns extracted content rather than
ten links, which is what an agent needs and what saves a second round of
fetches.

**`fetch` puts `direct` first, and this is the one place the default departs
from the stated preference.** `direct` is a plain HTTPS request plus HTML-to-
text extraction in our own code. It needs no account, no key, and sends the
destination to nobody. A reader service is a good tool and a real dependency: it
learns every URL the agent reads, including internal documentation and anything
behind a link the user pasted. Making that the out-of-the-box behaviour for
someone who has not chosen it is not ours to do.

`jina` sits second and catches what `direct` cannot: JavaScript-rendered pages,
and sites that refuse a plain client. Putting it first is **one setting**, not a
fork, and the onboarding page offers it as a first-class choice.

### 3. When a chain advances, and when it stops

Falling through on the wrong error hides problems and burns two keys instead of
one. The failure kind decides:

| Failure | Next provider? | Why |
|---|---|---|
| `unavailable` — the service is down or unreachable | Yes | Another service is up |
| `timeout` | Yes | Same |
| `rate_limited` — too many requests, retry later | Yes | Per-account and temporary |
| `quota_exhausted` — the plan is used up | Yes | Per-account and lasting |
| `unauthorized` — the key is missing, wrong, or revoked | **No** | Every retry fails identically, and the user must fix it |
| `invalid_request` — we sent something malformed | **No** | Our bug. Trying a second service hides it |
| `blocked` — the destination refused us | **No** for search; **yes** for `fetch` | A reader service is exactly the thing that gets past a refusal |

When the whole chain fails, the model is told which providers were tried and
what each one said. A vague "search failed" makes the model retry the same
thing.

### 4. One failure shape, in one place

A new error domain, `retrieval`, with the seven kinds in the table above. Every
provider adapter maps its own wire errors onto them, and nothing above the
adapter reads a vendor status code.

This is deliberately small and deliberately provisional. The final shape of a
provider error — what the UI shows, what the model is told, what telemetry
groups by — is not settled, and inventing the whole thing now would be inventing
it without a consumer. Recorded as `C-13`. Because the mapping lives in one
place per provider, changing the shape later is an edit to `src/retrieval/`, not
a sweep of the codebase.

### 5. Where the key lives

**The key goes in the OS credential store. Never in SQLite.**

This corrects an assumption stated while planning this work. It is the same rule
as ADR 0007 and the same rule the migration guard enforces: a migration adding a
column whose name looks like credential storage fails the migration. A retrieval
provider is a BYOK provider, and it uses the machinery BYOK already has —
`CredentialScope: "provider"`, one entry per provider id.

The split:

| Where | What |
|---|---|
| OS credential store | The API key. Nothing else |
| SQLite | Which providers are enabled, their order, the default for each capability |

Configuration is not a secret, and a key is not configuration.

## What this refuses

**A tool per provider.** Section 1.

**Letting the model pick the provider.** It has no basis for the choice, and a
model-chosen provider is a model-chosen destination and a model-chosen key —
which ADR 0022 and the permission rules both forbid.

**A generic "any OpenAI-compatible endpoint" hole, as BYOK models have.** Search
APIs have no shared wire format, so there is nothing to be generic about. A new
provider is a small adapter file, and that is the honest cost.

**Silent fallback.** Every result names the provider that produced it, and a
chain that advanced says so.

## Consequences

- Adding Brave or Exa later is one adapter and one row in a table.
- Someone forking for a different service writes one file and changes one
  default. That is the open-source promise this ADR is protecting.
- `fetch` works with no account at all. Every other provider is opt-in.
- One open question: whether `web_search` results should count as untrusted
  content under ADR 0022 rule 2. They should, and they do — a search result
  snippet is text from a page we did not write, arriving by a shorter route.
