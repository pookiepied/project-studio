/**
 * Provider management over the one provider store.
 *
 * Usage:
 *   pnpm providers list
 *   pnpm providers models [provider-id]
 *   pnpm providers connect <provider-id>
 *   pnpm providers disconnect <provider-id>
 *   pnpm providers add <id> <base-url> [--name N] [--api A] [--models a,b]
 *   pnpm providers remove <id>
 *   pnpm providers select <provider/model>
 *   pnpm providers default
 *
 * Every command reads and writes the merged store - `provider_connection_record`
 * and the model tables the settings surface and the runtime both use - so the
 * CLI can no longer drift from what the app shows. Keys entered here go into
 * the OS keychain under the connection's own entry, exactly where the settings
 * dialog puts them; a provider connected through the app is this CLI's
 * `connect` with a dialog instead of a prompt.
 *
 * What was deliberately not carried over: the interactive OAuth/device-code
 * login. It wrote tokens only the old store could read and no settings surface
 * ever offered it; the vendors a person actually connects here accept a typed
 * key, and Pi's own token refresh continues to work for credentials already in
 * the keychain.
 */
import { createInterface } from "node:readline";

import { ProviderConfigurationError } from "../../../contracts/models.js";
import type { LanguageProtocol } from "../../../contracts/providers.js";
import { KeyringCredentialStore } from "../../../credentials/keyring-store.js";
import { createDomainReporter } from "../../../observability/error-reporter.js";
import { openDatabase, type StudioDatabase } from "../../../storage/database.js";
import { ConnectionStore } from "../../connections/connection-store.js";
import { ModelCatalog } from "../../connections/model-catalog.js";
import { majorityProtocolFor } from "../pi-catalog.js";
import { parseModelSpecifier } from "./config.js";

/**
 * This CLI is its own entry point, so it is its own composition root: it opens
 * the connection it uses and closes it on the way out.
 */
const database: StudioDatabase = openDatabase();

const connections = new ConnectionStore({
  db: database,
  credentials: new KeyringCredentialStore(),
  reporter: createDomainReporter("models"),
});
const catalog = new ModelCatalog({
  db: database,
  connections,
  reporter: createDomainReporter("models"),
});

/** Reads a line without echoing it, so a key never appears in the terminal. */
function readSecret(message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const asMutable = rl as unknown as { _writeToOutput?: (text: string) => void };
    let prompted = false;

    asMutable._writeToOutput = (text: string) => {
      if (!prompted) {
        process.stdout.write(text);
        prompted = true;
        return;
      }
      // Swallow the echo of typed characters.
      if (text.includes("\n")) process.stdout.write("\n");
    };

    rl.question(`${message}: `, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (trimmed === "") {
        reject(new ProviderConfigurationError("No value entered."));
        return;
      }
      resolve(trimmed);
    });
    rl.on("SIGINT", () => {
      rl.close();
      reject(new ProviderConfigurationError("Cancelled."));
    });
  });
}

/** Parses `--flag value` pairs from the tail of the argument list. */
function readFlags(args: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg?.startsWith("--")) {
      const value = args[index + 1];
      if (value !== undefined && !value.startsWith("--")) {
        flags[arg.slice(2)] = value;
        index += 1;
      }
    }
  }
  return flags;
}

async function list(): Promise<number> {
  const [records, models, defaults] = await Promise.all([
    connections.list(),
    catalog.listModels(),
    catalog.getDefaults(),
  ]);

  process.stdout.write(
    `${records.length} connection${records.length === 1 ? "" : "s"} configured.\n\n`,
  );

  if (records.length === 0) {
    process.stdout.write(
      "No providers are configured yet. Connect one:\n  pnpm providers connect openrouter\n",
    );
    return 0;
  }

  for (const record of records) {
    const count = models.filter((model) => model.connectionId === record.id).length;
    const vendor = record.catalogProvider === undefined ? "" : `  vendor: ${record.catalogProvider}`;
    process.stdout.write(
      `  ${record.id}  (${record.kind}, ${record.credential}, ${count} model${count === 1 ? "" : "s"}, ${record.enabled ? "enabled" : "disabled"})${vendor}\n`,
    );
  }

  const text = defaults.textGeneration;
  const defaultText =
    text === undefined
      ? "none selected"
      : `${await vendorOf(text.connectionId)}/${text.modelId}`;
  process.stdout.write(`\nDefault model: ${defaultText}\n`);
  return 0;
}

async function vendorOf(connectionId: string): Promise<string> {
  const record = await connections.get(connectionId);
  return record?.catalogProvider ?? connectionId;
}

async function models(providerId: string | undefined): Promise<number> {
  const all = await catalog.listModels();
  const entries =
    providerId === undefined
      ? all
      : all.filter((model) => {
          const vendor = vendorCache.get(model.connectionId);
          return vendor === providerId;
        });
  if (providerId !== undefined && entries.length === 0) {
    process.stdout.write(`No known models for "${providerId}".\n`);
    return 0;
  }
  if (entries.length === 0) {
    process.stdout.write("No models are known yet.\n");
    return 0;
  }

  for (const entry of entries) {
    const vendor = vendorCache.get(entry.connectionId) ?? entry.connectionId;
    process.stdout.write(`  ${vendor}/${entry.modelId}  (${entry.displayName})\n`);
  }
  return 0;
}

const vendorCache = new Map<string, string>();
async function fillVendorCache(): Promise<void> {
  for (const record of await connections.list()) {
    vendorCache.set(record.id, record.catalogProvider ?? record.id);
  }
}

async function connect(providerId: string | undefined): Promise<number> {
  if (!providerId) {
    process.stderr.write("Usage: pnpm providers connect <provider-id>\n");
    return 2;
  }

  const existing = await connectionForVendor(providerId);
  const apiKey = await readSecret(`API key for ${providerId}`);
  if (existing !== undefined) {
    await connections.update(existing.id, { apiKey });
    process.stdout.write(`Updated the credential for ${providerId}. It is in your OS keychain.\n`);
    return 0;
  }

  await connections.add({
    id: providerId,
    displayName: providerId,
    kind: "language",
    source: "local",
    enabled: true,
    catalogProvider: providerId,
    protocol: majorityProtocolFor(providerId) ?? "openai-completions",
    apiKey,
  });
  process.stdout.write(
    `Connected ${providerId}. The credential is in your OS keychain; models draw from its catalog.\n`,
  );
  return 0;
}

async function disconnect(providerId: string | undefined): Promise<number> {
  if (!providerId) {
    process.stderr.write("Usage: pnpm providers disconnect <provider-id>\n");
    return 2;
  }

  const existing = await connectionForVendor(providerId);
  if (existing === undefined) {
    process.stdout.write(`No connection for "${providerId}".\n`);
    return 1;
  }
  await connections.remove(existing.id);
  process.stdout.write(`Disconnected ${providerId}.\n`);
  return 0;
}

async function connectionForVendor(providerId: string) {
  for (const record of await connections.list()) {
    if ((record.catalogProvider ?? record.id) === providerId) return record;
  }
  return undefined;
}

async function add(args: readonly string[]): Promise<number> {
  const [id, baseUrl] = args;
  if (!id || !baseUrl) {
    process.stderr.write(
      "Usage: pnpm providers add <id> <base-url> [--name N] [--api A] [--models a,b]\n",
    );
    return 2;
  }

  const flags = readFlags(args.slice(2));
  const api = flags.api ?? "openai-completions";
  const modelIds =
    flags.models === undefined
      ? []
      : flags.models.split(",").map((entry) => entry.trim()).filter(Boolean);

  const created = await connections.add({
    id,
    displayName: flags.name ?? id,
    kind: "language",
    source: "local",
    enabled: true,
    baseUrl,
    protocol: parseCustomApi(api),
  });  for (const modelId of modelIds) {
    await catalog.addManualModel(created.id, {
      modelId,
      displayName: modelId,
    });
  }
  process.stdout.write(
    `Added ${created.id} (${created.protocol}) at ${baseUrl} with ${modelIds.length} model(s).\n`,
  );
  return 0;
}

function parseCustomApi(api: string): LanguageProtocol {
  const known: readonly LanguageProtocol[] = [
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
    "mistral-conversations",
    "azure-openai-responses",
  ];
  const parsed = known.find((entry) => entry === api);
  if (parsed === undefined) {
    throw new ProviderConfigurationError(
      `Unsupported api "${api}". Supported: ${known.join(", ")}.`,
    );
  }
  return parsed;
}

async function remove(id: string | undefined): Promise<number> {
  if (!id) {
    process.stderr.write("Usage: pnpm providers remove <id>\n");
    return 2;
  }

  const records = await connections.list();
  const existing = records.find((record) => record.id === id);
  if (existing === undefined) {
    process.stdout.write(`No custom provider "${id}".\n`);
    return 1;
  }
  await connections.remove(id);
  process.stdout.write(`Removed ${id}.\n`);
  return 0;
}

async function select(specifier: string | undefined): Promise<number> {
  if (!specifier) {
    process.stderr.write("Usage: pnpm providers select <provider/model>\n");
    return 2;
  }

  const selection = parseModelSpecifier(specifier);
  await fillVendorCache();
  const connectionId = [...vendorCache.entries()].find(
    ([, vendor]) => vendor === selection.provider,
  )?.[0];
  if (connectionId === undefined) {
    throw new ProviderConfigurationError(
      `No connection for provider "${selection.provider}". Connect it first.`,
    );
  }

  await catalog.setDefault("textGeneration", {
    connectionId,
    modelId: selection.model,
  });
  process.stdout.write(`Default model is now ${selection.provider}/${selection.model}.\n`);
  return 0;
}

async function showDefault(): Promise<number> {
  const defaults = await catalog.getDefaults();
  const text = defaults.textGeneration;
  if (text === undefined) {
    process.stdout.write("No default model selected. Run: pnpm providers select <provider/model>\n");
    return 1;
  }
  process.stdout.write(`${await vendorOf(text.connectionId)}/${text.modelId}\n`);
  return 0;
}

async function main(): Promise<number> {
  const [, , command = "list", ...rest] = process.argv;
  await fillVendorCache();

  switch (command) {
    case "list":
      return list();
    case "models":
      return models(rest[0]);
    case "connect":
      return connect(rest[0]);
    case "disconnect":
      return disconnect(rest[0]);
    case "add":
      return add(rest);
    case "remove":
      return remove(rest[0]);
    case "select":
      return select(rest[0]);
    case "default":
      return showDefault();
    default:
      process.stderr.write(
        `Unknown command "${command}". Expected list, models, connect, disconnect, add, remove, select, or default.\n`,
      );
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    createDomainReporter("models").report(error, { operation: "providers.cli" });

    // Never print a stack here: this path handles credentials.
    process.stderr.write(
      `${error instanceof Error ? error.message : "Provider command failed."}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    database.close();
  });
