import type { DatabaseSync } from "node:sqlite";

import * as v from "valibot";

import { StorageError, storageErrorFrom } from "./errors.js";
import { majorityProtocolFor } from "../providers/library/language-catalog.js";
import { languageProtocolSchema } from "../contracts/providers.js";

/**
 * Schema evolution for the application-owned database.
 *
 * Migrations are append-only and never edited once released: a user's machine
 * may hold a database written by any previously shipped build. Renaming or
 * rewriting an applied migration silently diverges those machines from a fresh
 * install, which is the failure mode this file exists to prevent.
 */
export interface Migration {
  /** Sequential from 1, with no gaps. */
  readonly version: number;
  /** Stable identifier recorded in the database for auditability. */
  readonly name: string;
  readonly up: (db: DatabaseSync) => void;
}

/**
 * `provider_connection` records that a provider is configured and how to reach
 * it. It records no key material: the secret lives in the OS keychain, and this
 * row is the non-secret half that the keychain cannot store or enumerate.
 *
 * `custom_provider` holds user-declared OpenAI-compatible endpoints — the
 * settings replacement for `PROJECT_STUDIO_LOCAL_PROVIDERS`.
 *
 * `app_setting` is a narrow key/value table for single-valued product state
 * such as the selected default model. It is deliberately not a general-purpose
 * bag; anything with structure gets its own table.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "provider_settings",
    up(db) {
      db.exec(`
        CREATE TABLE custom_provider (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          base_url     TEXT NOT NULL,
          api          TEXT NOT NULL,
          models       TEXT NOT NULL DEFAULT '[]',
          context_window INTEGER,
          max_tokens     INTEGER,
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE provider_connection (
          provider_id   TEXT PRIMARY KEY,
          source        TEXT NOT NULL,
          connected_at  INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE app_setting (
          key         TEXT PRIMARY KEY,
          value       TEXT NOT NULL,
          updated_at  INTEGER NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 2,
    name: "permission_grants",
    up(db) {
      // A grant is scoped to (agent, conversation-or-null, capability). A null
      // conversation is an "always" grant; a set one expires with the
      // conversation. The unique index is what makes a repeated approval an
      // update rather than a pile of duplicates nobody can revoke.
      db.exec(`
        CREATE TABLE permission_grant (
          id              TEXT PRIMARY KEY,
          capability_key  TEXT NOT NULL,
          agent_id        TEXT NOT NULL,
          conversation_id TEXT,
          project_id      TEXT,
          verdict         TEXT NOT NULL,
          granted_at      INTEGER NOT NULL,
          revoked_at      INTEGER
        ) STRICT;

        CREATE UNIQUE INDEX permission_grant_scope
          ON permission_grant (capability_key, agent_id, IFNULL(conversation_id, ''))
          WHERE revoked_at IS NULL;
      `);
    },
  },
  {
    version: 3,
    name: "grant_resource_pattern",
    up(db) {
      // A grant now narrows to what the call touched, so "allow editing under
      // src" is expressible and does not silently become "allow editing
      // anything". A null pattern keeps the old meaning — the whole capability
      // — so grants written before this migration still mean what the user
      // approved.
      //
      // The index is dropped and rebuilt because the uniqueness rule itself
      // changed: the same capability may now be granted twice with different
      // patterns, and the old index would reject the second as a duplicate.
      db.exec(`
        ALTER TABLE permission_grant ADD COLUMN resource_pattern TEXT;

        DROP INDEX permission_grant_scope;

        CREATE UNIQUE INDEX permission_grant_scope
          ON permission_grant (
            capability_key,
            agent_id,
            IFNULL(conversation_id, ''),
            IFNULL(resource_pattern, '')
          )
          WHERE revoked_at IS NULL;
      `);
    },
  },
  {
    version: 4,
    name: "workspace_trust",
    up(db) {
      // Trust is per folder and deliberately not per conversation: opening the
      // same repository again must not re-ask, and trusting it in one
      // conversation must not leave it untrusted in the next.
      //
      // The absence of a row is meaningful — it means "never decided", which is
      // untrusted. So a revoked trust is stored as `trusted = 0` rather than
      // deleted, to keep "declined" distinguishable from "never asked".
      db.exec(`
        CREATE TABLE workspace_trust (
          root        TEXT PRIMARY KEY,
          trusted     INTEGER NOT NULL,
          decided_at  INTEGER NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 5,
    name: "grant_project_scope",
    up(db) {
      // `project_id` was written from the start and never read, so "always allow
      // git:push" approved in one project applied in every other one. The query
      // matches on it now, and the uniqueness rule has to follow: without
      // `project_id` in the index, approving the same thing in a second project
      // collides with the first row and is rejected as a duplicate.
      //
      // No data changes. Existing rows already carry the project they were
      // approved in, so they narrow to it rather than being lost.
      db.exec(`
        DROP INDEX permission_grant_scope;

        CREATE UNIQUE INDEX permission_grant_scope
          ON permission_grant (
            capability_key,
            agent_id,
            IFNULL(conversation_id, ''),
            IFNULL(project_id, ''),
            IFNULL(resource_pattern, '')
          )
          WHERE revoked_at IS NULL;
      `);
    },
  },
  {
    version: 6,
    name: "extension_selection",
    up(db) {
      // Which extensions a project has switched on. One row per decision the
      // user made, and nothing else: absence means off, which is the default
      // for every kind, so a project that has chosen nothing has no rows.
      //
      // This is scoping, not permission. A row here does not authorize
      // anything — it decides whether the extension is present at all, and
      // everything present still goes through the kernel per call. The two are
      // kept apart deliberately: a selection that could grant would be a second
      // permission system with none of the first one's rules.
      //
      // `kind` is stored rather than split into a table per kind. The spine
      // does not know what a kind is, and a table per kind would force it to.
      db.exec(`
        CREATE TABLE extension_selection (
          kind          TEXT NOT NULL,
          extension_id  TEXT NOT NULL,
          project_id    TEXT NOT NULL,
          enabled       INTEGER NOT NULL,
          decided_at    INTEGER NOT NULL,
          PRIMARY KEY (kind, extension_id, project_id)
        ) STRICT;
      `);
    },
  },
  {
    version: 7,
    name: "mcp_server",
    up(db) {
      // An installed MCP server: how to reach it, and nothing about whether it
      // is allowed. Selection lives in `extension_selection` and approvals live
      // in `permission_grant`, because those answer different questions and a
      // row here must never imply either.
      //
      // **No column holds a secret, and the guard enforces it.** A bearer token
      // or a password lives in the OS credential store under the server's id.
      // `auth_env_var` is the *name* of the environment variable the secret is
      // injected into at spawn time — a name is configuration, the value never
      // touches this file. An earlier draft called it `secret_env_name` and the
      // migration guard refused it, correctly, which is the guard doing exactly
      // what it is for.
      //
      // `args` and `env` are JSON arrays and objects. A command is an
      // executable plus an argument vector, never a string, so there is no
      // column that could hold `node server.js --flag` and be re-split by
      // something later.
      db.exec(`
        CREATE TABLE mcp_server (
          id            TEXT PRIMARY KEY,
          title         TEXT NOT NULL,
          transport     TEXT NOT NULL,
          command       TEXT,
          args          TEXT NOT NULL DEFAULT '[]',
          env           TEXT NOT NULL DEFAULT '{}',
          url           TEXT,
          auth_kind     TEXT NOT NULL DEFAULT 'none',
          auth_header   TEXT,
          auth_env_var  TEXT,
          installed_at  INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 8,
    name: "grant_definition_hash",
    up(db) {
      // A connected server can keep the same tool name while changing what a
      // person approved. Existing grants have no proof of the definition they
      // covered, so they remain null and are asked about again on their next use.
      db.exec("ALTER TABLE permission_grant ADD COLUMN definition_hash TEXT");
    },
  },
  {
    version: 9,
    name: "pending_approval",
    up(db) {
      // A question put to a person outlives the process that asked it (ADR
      // 0036). Held in a `Map`, every in-flight approval vanished on restart
      // and the run waiting on one could never be resumed — the person was
      // simply never asked again.
      //
      // `request` and `decision` are the JSON the UI renders; they describe a
      // capability and a target, never a credential. `asked_at` is what orders
      // the queue. Nothing expires a row by age: durability is the design
      // (ADR 0036), so a row leaves only when it is answered or cancelled.
      db.exec(`
        CREATE TABLE pending_approval (
          id        TEXT PRIMARY KEY,
          request   TEXT NOT NULL,
          decision  TEXT NOT NULL,
          asked_at  INTEGER NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 10,
    name: "mcp_server_network",
    up(db) {
      // Whether *this* server needs the network, which nothing recorded before:
      // every contained MCP server was granted it, because a record had no way
      // to say otherwise and shipping them all offline would have produced a
      // sandbox users switch off.
      //
      // **Existing rows default to 1, and that is the point of doing it this
      // way.** A migration that defaulted to 0 would silently break every server
      // already installed — the user would meet it as an API client that
      // stopped working, with nothing connecting the failure to an upgrade. The
      // default is the behaviour they already have; the *declaration* is the new
      // thing, and a server can now be installed without one.
      db.exec(
        "ALTER TABLE mcp_server ADD COLUMN needs_network INTEGER NOT NULL DEFAULT 1",
      );
    },
  },
  {
    version: 11,
    name: "provider_connection_record",
    up(db) {
      // The provider contract's connection record: language, media, and web
      // retrieval in one table, because they differ only in `kind` and
      // `protocol` and a table per kind would make that difference structural.
      //
      // This does not replace `provider_connection` from migration 2. That one
      // records *that* a built-in provider was connected; this one is the full
      // user-declared connection the contract describes. They will be merged,
      // and until they are, two tables saying different things is honest and
      // one table saying both would not be.
      //
      // **`record_json` is the reason this comment is long.** The column guard
      // reads column *names*, so it cannot see inside a JSON blob — the
      // protection here is instead that every write is parsed through
      // `providerConnectionSchema`, which has no key field and strips unknown
      // ones, and every read refuses a record carrying `apiKey`. A column named
      // for a secret would be caught; a secret smuggled into this blob would
      // not, so the schema parse on the write path is load-bearing and must
      // never be removed.
      db.exec(`
        CREATE TABLE provider_connection_record (
          id          TEXT PRIMARY KEY,
          record_json TEXT NOT NULL,
          updated_at  INTEGER NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 12,
    name: "provider_model_catalog",
    up(db) {
      // These three tables keep three different user decisions separate:
      // an override patches a live catalog model, a manual model is a model in
      // its own right, and a default points at either one. Merging them would
      // make it impossible to tell whether a model was renamed or created.
      //
      // **`record_json` is not a secret column.** It carries a ProviderModel,
      // which has no credential field, and every write and read parses it
      // through providerModelSchema. The column-name guard cannot inspect the
      // contents of a JSON blob, so that schema validation is the protection.
      db.exec(`
        CREATE TABLE provider_model_override (
          connection_id TEXT NOT NULL,
          model_id      TEXT NOT NULL,
          display_name  TEXT,
          hidden        INTEGER NOT NULL DEFAULT 0,
          updated_at    INTEGER NOT NULL,
          PRIMARY KEY (connection_id, model_id)
        ) STRICT;

        CREATE TABLE provider_model_manual (
          connection_id TEXT NOT NULL,
          model_id      TEXT NOT NULL,
          record_json   TEXT NOT NULL,
          updated_at    INTEGER NOT NULL,
          PRIMARY KEY (connection_id, model_id)
        ) STRICT;

        CREATE TABLE provider_default (
          slot          TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          model_id      TEXT NOT NULL,
          updated_at    INTEGER NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 13,
    name: "provider_model_foreign_keys",
    up(db) {
      // Deleting a connection record used to leave its overrides, manual
      // models, and defaults behind: no foreign key existed, and cleanup was
      // each store's own responsibility, which is exactly the kind of rule a
      // second writer forgets. The database owns the relationship now.
      //
      // The rebuild is the standard SQLite pattern because ALTER TABLE cannot
      // add a constraint to an existing table: create under a temp name, copy
      // the rows across, drop the old, rename. The copy's WHERE clause is the
      // orphan sweep — a row whose connection_id matches no connection record
      // is dropped here rather than carried forward, because carrying it would
      // violate the very constraint this migration exists to add.
      //
      // `PRAGMA foreign_keys` is already ON before migrations run, so SQLite
      // enforces the cascade from here on and neither store has to remember.
      db.exec(`
        CREATE TABLE provider_model_override_v13 (
          connection_id TEXT NOT NULL,
          model_id      TEXT NOT NULL,
          display_name  TEXT,
          hidden        INTEGER NOT NULL DEFAULT 0,
          updated_at    INTEGER NOT NULL,
          PRIMARY KEY (connection_id, model_id),
          FOREIGN KEY (connection_id)
            REFERENCES provider_connection_record(id) ON DELETE CASCADE
        ) STRICT;

        INSERT INTO provider_model_override_v13
               (connection_id, model_id, display_name, hidden, updated_at)
        SELECT connection_id, model_id, display_name, hidden, updated_at
          FROM provider_model_override
         WHERE connection_id IN (SELECT id FROM provider_connection_record);

        CREATE TABLE provider_model_manual_v13 (
          connection_id TEXT NOT NULL,
          model_id      TEXT NOT NULL,
          record_json   TEXT NOT NULL,
          updated_at    INTEGER NOT NULL,
          PRIMARY KEY (connection_id, model_id),
          FOREIGN KEY (connection_id)
            REFERENCES provider_connection_record(id) ON DELETE CASCADE
        ) STRICT;

        INSERT INTO provider_model_manual_v13
               (connection_id, model_id, record_json, updated_at)
        SELECT connection_id, model_id, record_json, updated_at
          FROM provider_model_manual
         WHERE connection_id IN (SELECT id FROM provider_connection_record);

        CREATE TABLE provider_default_v13 (
          slot          TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          model_id      TEXT NOT NULL,
          updated_at    INTEGER NOT NULL,
          FOREIGN KEY (connection_id)
            REFERENCES provider_connection_record(id) ON DELETE CASCADE
        ) STRICT;

        INSERT INTO provider_default_v13
               (slot, connection_id, model_id, updated_at)
        SELECT slot, connection_id, model_id, updated_at
          FROM provider_default
         WHERE connection_id IN (SELECT id FROM provider_connection_record);

        DROP TABLE provider_model_override;
        DROP TABLE provider_model_manual;
        DROP TABLE provider_default;

        ALTER TABLE provider_model_override_v13
          RENAME TO provider_model_override;
        ALTER TABLE provider_model_manual_v13
          RENAME TO provider_model_manual;
        ALTER TABLE provider_default_v13
          RENAME TO provider_default;
      `);
    },
  },
  {
    version: 14,
    name: "conversations_and_projects",
    up(db) {
      // Studio owns the index; Flue owns the transcript. Every message, tool
      // call and attachment of a conversation lives in Flue's own journal,
      // addressed by a stream path (`agents/studio/<id>`) whose id the caller
      // chose (ADR 0045). That journal cannot be enumerated through any
      // supported surface — `listAgents()` names agents, not conversations —
      // so these rows are not a cache that could be rebuilt from somewhere:
      // they are the only record that a conversation exists at all.
      //
      // Nothing here stores text. A second transcript, even a summary one, is
      // exactly what the adapter contract refuses ("adapters must not model a
      // second authoritative transcript"), and one that drifts from the real
      // log is worse than none.
      //
      // `model_id` is written by nothing today and deliberately exists anyway:
      // the next task sends a model with every submission, and a conversation
      // that cannot say which model it was talking to would need this column
      // the moment it could. An empty nullable column now costs nothing; a
      // migration on release day would cost a rewrite of applied history.
      db.exec(`
        CREATE TABLE project (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          icon        TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          created_at  INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE project_folder (
          id         TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          path       TEXT NOT NULL,
          name       TEXT NOT NULL,
          position   INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
        ) STRICT;

        CREATE UNIQUE INDEX project_folder_path_per_project
          ON project_folder (project_id, path);

        CREATE INDEX project_folder_by_project
          ON project_folder (project_id, position);
      `);

      // A folder is a row, not a grant. It decides what a project *offers* its
      // sandboxes as roots when a turn binds them; everything that authorizes
      // an actual call keeps flowing through `permission_grant` alone, which
      // already carries `project_id`, `resource_pattern`, and per-conversation
      // scoping (migrations 2, 3 and 5). Two places able to authorize a read
      // is the failure `PermissionKernel`'s docblock opens with.
      //
      // The join columns below are ordinary configuration state:
      //
      // - `archived` is the failsafe the Archive pane promises: set, never
      //   swept, expired by nothing.
      // - `title_manual` records that a person named the conversation, so no
      //   later derivation ever overwrites their words again.
      // - deleting a project detaches its conversations rather than destroying
      //   them — ON DELETE SET NULL, mirroring what removing a project already
      //   means in the product.
      db.exec(`
        CREATE TABLE conversation (
          id           TEXT PRIMARY KEY,
          title        TEXT,
          title_manual INTEGER NOT NULL DEFAULT 0,
          project_id   TEXT REFERENCES project(id) ON DELETE SET NULL,
          pinned       INTEGER NOT NULL DEFAULT 0,
          archived     INTEGER NOT NULL DEFAULT 0,
          model_id     TEXT,
          created_at   INTEGER NOT NULL,
          last_turn_at INTEGER NOT NULL
        ) STRICT;

        CREATE INDEX conversation_recent
          ON conversation (archived, last_turn_at DESC);

        CREATE INDEX conversation_by_project
          ON conversation (project_id, last_turn_at DESC)
          WHERE project_id IS NOT NULL;
      `);
    },
  },
  {
    version: 15,
    name: "conversation_reasoning_level",
    up(db) {
      // The level of reasoning a conversation is held with, beside the model
      // column migration 14 added for exactly this moment. Migration 14 could
      // not have carried this one: Task 36 had only just established that a
      // reasoning request reached the request at all, and the choice - which
      // of the levels, or the provider's own default - is a separate fact from
      // which model answers, with a different lifecycle (it is per model, so
      // the two are picked together but stored apart).
      //
      // Nullable on purpose: null and "default" both arrive, and both mean the
      // same thing - no level asked for, the provider's own behaviour. Rows
      // written before this column existed are null and are read as default;
      // nothing is backfilled, because a backfill would rewrite a fact the
      // user never stated.
      db.exec("ALTER TABLE conversation ADD COLUMN reasoning_level TEXT");
    },
  },
  {
    version: 16,
    name: "provider_store_merge",
    up(db) {
      // Two provider stores existed and did not know about each other. This
      // one (`provider_connection_record`, migrations 11-13) held the full
      // user-declared connection the contract describes; the other
      // (`custom_provider` + `provider_connection` + `app_setting`'s
      // `local.*` keys, migration 1) held what the local BYOK runtime had
      // actually been driven with - and on real machines it is the one holding
      // the working connection. The merge direction follows from that: the
      // runtime world's rows are carried INTO the contract's store, which has
      // the richer shape and the HTTP surface, and the old tables stop being
      // written. They are deliberately not dropped - migrations are
      // append-only, and a machine may yet hold a database written by a build
      // that still reads them.
      //
      // Nothing here touches the OS credential store. The keys keep their
      // keychain entries (`provider:<pi-provider-id>`, Pi's own chunked JSON);
      // the merged store's credential resolution reads those entries as the
      // legacy location behind a connection's own key, so a connection that
      // worked before this migration works after it, same key, nothing
      // retyped. A row whose key is missing carries anyway and reports
      // credential "absent" - asking for a key, not looking broken.
      //
      // One deliberate normalization: a connection's `protocol` is a closed
      // contract union, so a carried built-in provider gets the protocol most
      // of its own catalog models speak (computed from the installed package,
      // since the value drives the probe and nothing else). A custom provider
      // keeps the api it was declared with.

      const now = Date.now();
      const carried = new Set<string>();

      const insertConnection = (
        id: string,
        record: Record<string, unknown>,
        updatedAt: number,
      ): void => {
        db.prepare(
          `INSERT INTO provider_connection_record (id, record_json, updated_at)
           VALUES (?, ?, ?)`,
        ).run(id, JSON.stringify(record), updatedAt);
        carried.add(id);
      };

      // Custom providers first: their rows carry the richest facts (base URL,
      // declared api, per-model ids, context window). A `provider_connection`
      // row for the same id is subsumed by this one.
      const customRows: readonly Record<string, unknown>[] = db
        .prepare(
          `SELECT id, name, base_url, api, models, context_window, max_tokens, updated_at
             FROM custom_provider ORDER BY id`,
        )
        .all();

      for (const raw of customRows) {
        const row = readCustomRow(raw);
        if (row === undefined || carried.has(row.id)) continue;
        if (!v.safeParse(languageProtocolSchema, row.api).success) {
          // A declared api outside the contract union cannot become a record
          // the contract would parse. Nothing current writes one; leaving the
          // row uncarried keeps the old tables as the honest record instead
          // of inventing a protocol the endpoint does not speak.
          continue;
        }
        insertConnection(
          row.id,
          {
            id: row.id,
            displayName: row.name,
            kind: "language",
            source: "local",
            baseUrl: row.baseUrl,
            enabled: true,
            protocol: row.api,
          },
          row.updatedAt,
        );

        let modelIds: readonly unknown[] = [];
        try {
          const parsed: unknown = JSON.parse(row.models);
          if (Array.isArray(parsed)) modelIds = parsed;
        } catch {
          modelIds = [];
        }
        for (const modelId of modelIds) {
          if (typeof modelId !== "string" || modelId.length === 0) continue;
          db.prepare(
            `INSERT INTO provider_model_manual (connection_id, model_id, record_json, updated_at)
             VALUES (?, ?, ?, ?)`,
          ).run(
            row.id,
            modelId,
            JSON.stringify({
              connectionId: row.id,
              modelId,
              displayName: modelId,
              capability: {
                textGeneration: "supported",
                streaming: "unknown",
                reasoning: "unknown",
                toolCalling: "unknown",
                vision: "unknown",
                embeddings: "unknown",
                reranking: "unknown",
                imageGeneration: "unknown",
                imageEditing: "unknown",
                videoGeneration: "unknown",
                speechGeneration: "unknown",
                transcription: "unknown",
                webSearch: "unknown",
                webFetch: "unknown",
                contextWindow: typeof row.contextWindow === "number" ? row.contextWindow : "unknown",
                maxOutputTokens: typeof row.maxTokens === "number" ? row.maxTokens : "unknown",
              },
              reasoningLevels: [],
              shape: "stream",
              pricing: { input: "unknown", output: "unknown", cacheRead: "unknown", cacheWrite: "unknown" },
              hidden: false,
              origin: "manual",
            }),
            row.updatedAt,
          );
        }
        // A provider-level context window or token cap with no declared model
        // has nothing to attach to and is dropped here; every real row names
        // its models, and a model-less connection's window is meaningless.
      }

      // Built-in connections: one row per connected Pi provider, drawing that
      // vendor's catalog.
      const connectionRows: readonly Record<string, unknown>[] = db
        .prepare(`SELECT provider_id, updated_at FROM provider_connection ORDER BY provider_id`)
        .all();

      for (const raw of connectionRows) {
        const providerId = raw.provider_id;
        const updatedAt = raw.updated_at;
        if (typeof providerId !== "string" || typeof updatedAt !== "number") continue;
        if (carried.has(providerId)) continue;
        const protocol = majorityProtocolFor(providerId);
        if (protocol === undefined) {
          // Not a provider the installed catalog knows, and no custom row
          // described it. There is no honest protocol to declare.
          continue;
        }
        insertConnection(
          providerId,
          {
            id: providerId,
            displayName: providerId,
            kind: "language",
            source: "local",
            enabled: true,
            catalogProvider: providerId,
            protocol,
          },
          updatedAt,
        );
      }

      // The default model the stable alias routed to: carried into the
      // contract's defaults table as the textGeneration slot, because that is
      // what `local.default_model` meant. The legacy key stays where it is
      // (append-only); a carried default makes it redundant, an uncarried one
      // keeps the legacy fallback derivation the only reader.
      const defaultRow = db
        .prepare(`SELECT value FROM app_setting WHERE key = 'local.default_model'`)
        .get() as Record<string, unknown> | undefined;
      const defaultRaw = defaultRow?.value;
      if (typeof defaultRaw === "string" && defaultRaw.length > 0) {
        try {
          const parsed: unknown = JSON.parse(defaultRaw);
          if (isRecord(parsed)) {
            const provider = parsed.provider;
            const model = parsed.model;
            if (typeof provider === "string" && typeof model === "string") {
              const records: readonly Record<string, unknown>[] = db
                .prepare(`SELECT id, record_json FROM provider_connection_record`)
                .all();
              const match = records
                .map((row) => {
                  const id = row.id;
                  const rawRecord = row.record_json;
                  if (typeof id !== "string" || typeof rawRecord !== "string") return undefined;
                  try {
                    const record: unknown = JSON.parse(rawRecord);
                    if (!isRecord(record)) return undefined;
                    const catalog = record.catalogProvider;
                    return {
                      id,
                      vendor: typeof catalog === "string" ? catalog : id,
                    };
                  } catch {
                    return undefined;
                  }
                })
                .find((entry) => entry !== undefined && entry.vendor === provider);
              if (match !== undefined) {
                db.prepare(
                  `INSERT INTO provider_default (slot, connection_id, model_id, updated_at)
                   VALUES ('textGeneration', ?, ?, ?)
                   ON CONFLICT(slot) DO NOTHING`,
                ).run(match.id, model, now);
              }
            }
          }
        } catch {
          // An unreadable legacy key is left exactly as it is; the fallback
          // reader will refuse it the same way it always has.
        }
      }

      // The probe's learned availability (added in this schema for the same
      // task that unified the stores): what the provider's own model list
      // named the last time its connection was probed. Keyed by connection so
      // the catalog can mark what the provider no longer offers, and cascaded
      // like every other per-connection table.
      db.exec(`
        CREATE TABLE provider_probe_state (
          connection_id TEXT PRIMARY KEY,
          served_ids    TEXT NOT NULL DEFAULT '[]',
          probed_at     INTEGER NOT NULL,
          FOREIGN KEY (connection_id)
            REFERENCES provider_connection_record(id) ON DELETE CASCADE
        ) STRICT;
      `);
    },
  },
  {
    version: 17,
    name: "conversation_permission_mode",
    up(db) {
      // The execution mode a conversation is held with, beside the model and
      // reasoning columns (migrations 14 and 15) that were added for exactly
      // this shape of fact: a per-conversation choice, settled at admission,
      // read by the run. Until now the mode was a process-wide callback that
      // every composition left unset, so every conversation was Manual forever
      // and nothing could widen it.
      //
      // Nullable on purpose: the absence of a stored answer IS Manual. A mode
      // is a consent, so a row written before this column existed records no
      // consent, which is precisely what Manual means - backfilling it would
      // rewrite a decision nobody made, and writing "manual" at creation would
      // make an unset row indistinguishable from one the user looked at and
      // left alone. The reader treats null, and any value that no longer
      // parses, as Manual.
      db.exec("ALTER TABLE conversation ADD COLUMN permission_mode TEXT");
    },
  },
  {
    version: 18,
    name: "extension_scope",
    up(db) {
      // Selection gains two scopes: one above projects and one below them.
      //
      // Migration 6 keyed a decision by `(kind, extension_id, project_id)`,
      // with `project_id` NOT NULL and inside the primary key. That shape can
      // express exactly one question - "is this on for this project" - and two
      // more now have to fit beside it:
      //
      //   global        the user's default, inherited by everything
      //   conversation  an override for one conversation, project or not
      //
      // Resolution is narrowest-first: conversation, then project, then
      // global. A quick conversation with no project inherits the global
      // default and works with no setup, which is the case the product is
      // built around; a project narrows or widens from there.
      //
      // **This changes the default that migration 6 recorded.** Its comment
      // says "absence means off, which is the default for every kind". Absence
      // at a scope still means "no decision here", but the ANSWER for a scope
      // with no decision is now whatever the wider scope said, and only an
      // absent global default is off. That was a deliberate decision: with a
      // hundred extensions installed, on-by-default is unusable, and
      // off-with-no-way-to-say-otherwise makes the fastest path in the product
      // the one demanding the most setup.
      //
      // The scope is a pair - a kind and an id - rather than three nullable
      // columns, because a nullable column inside a primary key is a shape
      // SQLite will let you write and then quietly disagree with you about.
      // `scope_id` is the empty string for the global scope, which has no id;
      // that is a value the other two scopes can never produce, since project
      // and conversation ids are always non-empty.
      //
      // The table is new rather than altered because the primary key changes,
      // and the old rows are carried in as project-scope decisions so nobody
      // loses a choice they made. The old table is dropped in the same
      // migration: it has one reader, `ExtensionSelectionStore`, which moves
      // to this table in the same change.
      db.exec(`
        CREATE TABLE extension_scope (
          kind          TEXT NOT NULL,
          extension_id  TEXT NOT NULL,
          scope_kind    TEXT NOT NULL,
          scope_id      TEXT NOT NULL,
          enabled       INTEGER NOT NULL,
          decided_at    INTEGER NOT NULL,
          PRIMARY KEY (kind, extension_id, scope_kind, scope_id)
        ) STRICT;
      `);

      db.exec(`
        INSERT INTO extension_scope
          (kind, extension_id, scope_kind, scope_id, enabled, decided_at)
        SELECT kind, extension_id, 'project', project_id, enabled, decided_at
          FROM extension_selection;
      `);

      db.exec("DROP TABLE extension_selection;");
    },
  },
  {
    version: 19,
    name: "pending_question",
    up(db) {
      // The ask-a-question tool's own table, deliberately not a second use of
      // `pending_approval` (migration 9). A permission question has no
      // timeout and no default, because for a permission the absence of an
      // answer must never become consent; a product question has both, and
      // one table for the two would let the first bug that confuses them
      // turn a permission prompt into an auto-approval. ADR 0036's durability
      // holds here too: the row survives the process that asked it.
      //
      // `payload` is the JSON the UI renders - a question sentence, its
      // header, its options, and which option a timeout may take. It
      // describes the question and carries no credential.
      //
      // `outcome` is null while the question waits, and one of
      // answered / deferred / stopped / timed_out once settled. `answer`
      // records what was chosen the moment it was chosen, so the answer
      // itself is durable (ADR 0036) rather than living only in the parked
      // call's result. Settled rows are kept, not deleted: the queue reads
      // `outcome IS NULL`, and the settled row is the record of a decision.
      // Which rows one tool call asked is the parked call's own knowledge -
      // a call is resolved by its waiter in one process - so no column
      // records it, and none would have a reader after a restart.
      db.exec(`
        CREATE TABLE pending_question (
          id              TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          payload         TEXT NOT NULL,
          asked_at        INTEGER NOT NULL,
          expires_at      INTEGER,
          outcome         TEXT,
          answer          TEXT
        ) STRICT;

        CREATE INDEX pending_question_queue
          ON pending_question (conversation_id, asked_at);
      `);
    },
  },
];

/** A `custom_provider` row whose columns all carry the shapes this file reads. */
interface CarriedCustomProvider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly api: string;
  readonly models: string;
  readonly contextWindow: number | null;
  readonly maxTokens: number | null;
  readonly updatedAt: number;
}

function readCustomRow(raw: Record<string, unknown>): CarriedCustomProvider | undefined {
  const id = raw.id;
  const name = raw.name;
  const baseUrl = raw.base_url;
  const api = raw.api;
  const models = raw.models;
  const contextWindow = raw.context_window;
  const maxTokens = raw.max_tokens;
  const updatedAt = raw.updated_at;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof baseUrl !== "string" ||
    typeof api !== "string" ||
    typeof models !== "string" ||
    typeof updatedAt !== "number" ||
    (contextWindow !== null && typeof contextWindow !== "number") ||
    (maxTokens !== null && typeof maxTokens !== "number")
  ) {
    return undefined;
  }
  return {
    id,
    name,
    baseUrl,
    api,
    models,
    contextWindow,
    maxTokens,
    updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Reads the schema version the file itself records.
 *
 * Exported for the read-only open in `database.ts`, which must know the
 * version without ever advancing it: a reader that migrated would be a writer.
 */
export function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as
    | { user_version?: number }
    | undefined;
  return row?.user_version ?? 0;
}

/**
 * Words that mean a column holds a secret.
 *
 * Matched as **whole words**, anywhere in the name, rather than as a suffix.
 * The old pattern anchored the keyword at the end, so anything after it escaped
 * — `api_key_hash` and `private_key_pem` both passed — and bare `key` was not a
 * keyword at all, so `secret_key`, `encryption_key`, and `signing_key` passed
 * too.
 *
 * Singular `token` is a credential; plural `tokens` is a count. That is why
 * `max_tokens` is absent from the list rather than excused by the allowlist
 * below: it never matches in the first place.
 */
const SECRET_WORDS = new Set([
  "secret",
  "password",
  "passphrase",
  "credential",
  "credentials",
  "token",
  "key",
  "apikey",
  "privatekey",
]);

/**
 * Column names that contain a secret word and are still not secrets.
 *
 * Deliberately an allowlist rather than a cleverer pattern. `key` is too common
 * a word to refuse on sight and too dangerous to ignore, so the default is to
 * refuse and each exception is written down once, here, where it can be argued
 * with. A new column named `cache_key` fails the check — and the fix is to add
 * it to this list on purpose, not to weaken the rule for everything.
 */
const NOT_SECRET_COLUMNS = new Set([
  // `app_setting.key` — the key half of a key/value table.
  "key",
  // `permission_grant.capability_key` — a capability identifier, not key material.
  "capability_key",
]);

/**
 * Words that make `token` a measurement rather than a credential.
 *
 * Only `token` needs this. Usage accounting is full of `token_count` and
 * `total_tokens`, and refusing those would be the guard crying wolf. `key`,
 * `secret`, `password`, and the rest never appear in a measurement, so they get
 * no such excuse — and `token_secret` is still refused, because the excuse
 * applies to `token` alone and `secret` is still there.
 */
const MEASUREMENT_WORDS = new Set(["count", "total", "usage", "limit", "max", "used"]);

/**
 * Splits a column name into words on `_`, `-`, and camel-case boundaries.
 *
 * The camel-case case is defence rather than need: our own columns are all
 * snake_case, but the guard must not be defeated by a migration that is not.
 */
function words(columnName: string): string[] {
  return columnName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word !== "");
}

/**
 * Whether a column name means a secret had been written here. Enforced rather
 * than documented: the keychain/database split is the whole security boundary,
 * and it is one careless column away from being undone.
 */
function looksLikeSecret(columnName: string): boolean {
  if (NOT_SECRET_COLUMNS.has(columnName.toLowerCase())) return false;

  const parts = words(columnName);
  const found = parts.filter((word) => SECRET_WORDS.has(word));
  if (found.length === 0) return false;

  const onlyToken = found.every((word) => word === "token");
  if (onlyToken && parts.some((word) => MEASUREMENT_WORDS.has(word))) return false;

  return true;
}

export function assertNoSecretColumns(db: DatabaseSync): void {
  const columns = db
    .prepare(
      `SELECT m.name AS table_name, i.name AS column_name
         FROM sqlite_master AS m
         JOIN pragma_table_info(m.name) AS i
        WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'`,
    )
    .all() as { table_name: string; column_name: string }[];

  for (const column of columns) {
    if (looksLikeSecret(column.column_name)) {
      throw new StorageError("migration", {
        message: `Schema column ${column.table_name}.${column.column_name} looks like secret storage. Secrets belong in the OS credential store.`,
      });
    }
  }
}

/**
 * Brings the database up to `LATEST_SCHEMA_VERSION`.
 *
 * Each migration runs in its own transaction, so a failure leaves the file at
 * the last fully applied version rather than half-migrated.
 *
 * The secret-column guard runs in two places, and both are needed:
 *
 * 1. **Inside each migration's transaction**, so a migration that adds a
 *    credential column rolls back instead of committing. Checking after the
 *    loop was too late — the column and its `user_version` bump were already on
 *    disk, and only the process that ran the migration ever saw the error.
 * 2. **On every open**, before the early return. Otherwise a file poisoned by an
 *    older build passes forever: `current === latest` returns immediately, and
 *    the application starts normally with the column present.
 */
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS,
): number {
  const current = readUserVersion(db);
  const latest = migrations.length;

  // A newer build has already written this file. Downgrades happen on desktop,
  // and running old code against a new schema corrupts data quietly; refusing
  // is the only safe response.
  if (current > latest) {
    throw new StorageError("migration", {
      message: `The database was written by a newer version of Project Studio (schema ${current}, this build supports ${latest}).`,
    });
  }

  // Every open, not only one that migrates.
  assertNoSecretColumns(db);

  if (current === latest) {
    return current;
  }

  // Nothing in `src/` reads this table, on purpose. Migration control flow uses
  // `user_version`; the rows are for opening a user's `studio.db` by hand and
  // asking which migrations ran and when. The record is not free-floating —
  // `tests/unit/storage.test.ts` asserts one row per migration, in order, by
  // name, so a migration that forgets to record itself fails. ADR 0010 and
  // meta-task #81.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  INTEGER NOT NULL
    ) STRICT;
  `);

  for (const migration of migrations) {
    if (migration.version <= current) {
      continue;
    }

    db.exec("BEGIN");
    try {
      migration.up(db);
      // Inside the transaction: a refusal must undo the column, not report it.
      assertNoSecretColumns(db);
      db.prepare(
        "INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, Date.now());
      // `user_version` cannot be parameterized.
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      // Our own refusal already says what is wrong and names the column.
      // `storageErrorFrom` would replace it with the generic schema message,
      // which is the one thing the person reading it cannot act on.
      if (error instanceof StorageError) throw error;
      throw storageErrorFrom(error, "migration");
    }
  }

  return latest;
}
