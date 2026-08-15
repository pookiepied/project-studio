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
web_search(query, limit)     → the configured search provider
fetch(url, format)           → the configured reader provider
```

This is ADR 0013's rule applied unchanged: `git` is one tool with subcommands,
not one tool per subcommand, and the same reasoning holds here. Which service
answers is **configuration**, decided by the user in onboarding and changed in
settings. It never appears in the tool schema, so adding a provider costs zero
prompt tokens and zero cache invalidation — which is exactly the property
`mental-model.md` §3.3 says to protect.

The result names the provider that answered, because a user comparing results
needs to know which service produced them.

### 2. Two slots. A default and a fallback. Never a pool.

Each capability holds exactly **two** slots:

```
default   the provider that answers
fallback  the provider that answers when the default cannot
```

If both fail, the call fails with a real error code naming what each one said.
There is no third attempt, and connecting five services does not mean trying
five.

The reason is that a pool sounds free and is not. Every extra attempt spends
another account's quota, adds another timeout to the user's wait, and turns one
clear failure into a vague one. Two is enough to survive a service being down,
which is the only thing a fallback is for.

| Capability | Default | Fallback | Also available |
|---|---|---|---|
| `web_search` | `tavily` | user's choice | `brave`, `exa` |
| `fetch` | `jina` | user's choice | see `C-14` |

The fallback slot may be empty. One provider and a good error is a valid
configuration, and it is what someone with one key will have.

**Search defaults to Tavily** because it returns extracted content rather than
ten links, which is what an agent needs and what saves a second round of
fetches.

**`fetch` defaults to Jina Reader.** It handles JavaScript-rendered pages and
sites that refuse a plain client, which a hand-written HTTP client does not. The
cost is real and is stated rather than hidden: the reader service learns every
URL the agent reads. That is the trade, it is deliberate, and the settings
screen says so in those words.

There is no `direct` provider. A plain HTTPS request with our own HTML
extraction was considered as the default and rejected — it fails on exactly the
pages an agent is most often pointed at, and a fetch tool that works on half the
web is worse than one dependency.

### 3. When the fallback is used, and when it is not

Falling through on the wrong error hides problems and burns two keys instead of
one. The failure kind decides:

| Failure | Use the fallback? | Why |
|---|---|---|
| `unavailable` — the service is down or unreachable | Yes | Another service is up |
| `timeout` | Yes | Same |
| `rate_limited` — too many requests, retry later | Yes | Per-account and temporary |
| `quota_exhausted` — the plan is used up | Yes | Per-account and lasting |
| `unauthorized` — the key is missing, wrong, or revoked | **No** | Every retry fails identically, and the user must fix it |
| `invalid_request` — we sent something malformed | **No** | Our bug. Trying a second service hides it |
| `blocked` — the destination refused us | **No** for search; **yes** for `fetch` | A reader service is exactly the thing that gets past a refusal |

When both slots fail, the model is told which providers were tried and
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
| SQLite | Which provider fills each slot, for each capability |

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
call that fell back to the second slot says so.

## Consequences

- Adding Brave or Exa later is one adapter and one row in a table.
- Someone forking for a different service writes one file and changes one
  default. That is the open-source promise this ADR is protecting.
- Every provider needs an account. `fetch` and `web_search` are both unusable
  until onboarding has one key, and both say exactly that rather than failing
  obscurely. This is the cost of the Jina-first default, and it is accepted.
- One open question: whether `web_search` results should count as untrusted
  content under ADR 0022 rule 2. They should, and they do — a search result
  snippet is text from a page we did not write, arriving by a shorter route.
