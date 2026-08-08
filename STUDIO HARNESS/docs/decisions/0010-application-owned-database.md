# ADR 0010: The Application-Owned Database

Status: Accepted

## Context

Provider settings were the first product state that had to survive a restart,
and the interim answer was environment variables. Every phase from here adds
more of it — permission grants, MCP server registrations, skill catalogs,
project bindings, memory, schedules. Deciding storage once, at the first real
consumer, is cheaper than deciding it eight times.

Flue already persists to SQLite. It is tempting to reuse that file.

## Decision

### A separate file from Flue's

Flue owns `flue.db`: the canonical transcript, the submission journal, and run
state. `sqlite()` from `@flue/runtime/node` returns an opaque
`PersistenceAdapter` with no exposed handle, so sharing the file would mean
writing tables into a database whose schema and migrations belong to a
dependency. A Flue upgrade could then collide with ours, and our schema version
would no longer mean only our own thing.

The product owns `studio.db`, at `PROJECT_STUDIO_STORE_PATH` (default
`./data/studio.db`).

### `node:sqlite`, because Flue already uses it

Flue's adapter is built on `node:sqlite`. Using the same driver adds no
dependency, no native build step, and no second SQLite engine in one process.
It is still flagged experimental in Node 22, which is a warning we already emit
today by depending on Flue at all.

### Secrets never enter it

This is the security boundary the whole design rests on: **the OS keychain holds
secrets, the database holds everything else, and a row may reference a
credential but never contain one.** A provider row records that `openai` is
connected and when; the key is in the keychain (ADR 0007).

That rule is enforced, not documented. `assertNoSecretColumns` runs after every
migration and fails if a column name looks like credential storage. It matches
whole suffixes rather than substrings — a guard that flags `max_tokens` as a
secret is a guard that gets deleted.

The split is also what makes settings possible at all: a keychain cannot
enumerate itself, so without a database there is no way to answer "which
providers are connected".

### Migrations are append-only and versioned

`PRAGMA user_version` is the schema version, with a `schema_migration` table
recording name and timestamp, because `user_version` alone loses the history.
Each migration runs in its own transaction, so a failure leaves the file at the
last fully applied version rather than half-migrated.

A database at a *higher* version than the build understands is refused. Desktop
users downgrade, and old code writing a new schema corrupts data quietly.

## Consequences

- One connection per process, opened lazily, migrated once. Tests open their own
  `:memory:` database rather than sharing the singleton.
- WAL plus a busy timeout, because the CLIs open the same file as a running
  harness.
- `transaction()` is deliberately not reentrant. SQLite has no nested
  transactions, and emulating them would let an inner rollback silently discard
  outer writes.
- Later phases add tables here rather than inventing storage. The convention:
  structured state gets its own table; `app_setting` is for single values only.
- Backup, export, and sync are unsolved and deliberately deferred — there is no
  cloud sync story for this file yet, and inventing one before a consumer exists
  would repeat the dead-abstraction mistake from Phase 7.5.
