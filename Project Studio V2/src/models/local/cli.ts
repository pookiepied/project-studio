/**
 * Provider management for local BYOK.
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
 * This is a thin caller over `LocalProviderService`; the settings UI calls the
 * same methods. Keys entered here go straight into the OS keychain through Pi's
 * credential store — never echoed, never written to a file, never passed
 * through the harness's own model code.
 */
import { createInterface } from "node:readline";

import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";

import { KeyringCredentialStore } from "../../credentials/keyring-store.js";
import { createDomainReporter } from "../../observability/error-reporter.js";
import { closeDatabase, getDatabase } from "../../storage/database.js";
import { parseModelSpecifier } from "./config.js";
import { LocalProviderService } from "./provider-service.js";
import { ProviderSettingsStore } from "./settings-store.js";

function buildService(): LocalProviderService {
  return new LocalProviderService({
    settings: new ProviderSettingsStore(getDatabase()),
    credentials: new KeyringCredentialStore(),
    reporter: createDomainReporter("models"),
  });
}

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
        reject(new Error("No value entered."));
        return;
      }
      resolve(trimmed);
    });
    rl.on("SIGINT", () => {
      rl.close();
      reject(new Error("Cancelled."));
    });
  });
}

function readVisible(message: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message}: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const interaction = {
  async prompt(prompt: AuthPrompt): Promise<string> {
    if (prompt.type === "secret") return readSecret(prompt.message);
    if (prompt.type === "select") {
      process.stdout.write(`${prompt.message}\n`);
      for (const option of prompt.options) {
        process.stdout.write(`  ${option.id}  ${option.label}\n`);
      }
      return readVisible("Choice");
    }
    return readVisible(prompt.message);
  },
  notify(event: AuthEvent): void {
    if (event.type === "auth_url") {
      process.stdout.write(`\nOpen this URL to continue:\n${event.url}\n\n`);
      return;
    }
    if (event.type === "device_code") {
      process.stdout.write(
        `\nGo to ${event.verificationUri} and enter code: ${event.userCode}\n\n`,
      );
      return;
    }
    if (event.type === "info" || event.type === "progress") {
      process.stdout.write(`${event.message}\n`);
    }
  },
};

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

async function list(service: LocalProviderService): Promise<number> {
  const providers = await service.listProviders();
  const connected = providers.filter((entry) => entry.connected);

  process.stdout.write(
    `${providers.length} providers available, ${connected.length} connected.\n\n`,
  );

  if (connected.length === 0) {
    process.stdout.write(
      "No providers are configured yet. Connect one:\n  pnpm providers connect openai\n",
    );
    return 0;
  }

  for (const provider of connected) {
    const managed = provider.managed ? "" : "  [ambient, not removable here]";
    process.stdout.write(
      `  ${provider.id}  (${provider.authType ?? "unknown"}, ${
        provider.credentialSource ?? "configured"
      })${managed}\n`,
    );
  }

  const selection = service.getDefaultModel();
  process.stdout.write(
    `\nDefault model: ${
      selection ? `${selection.provider}/${selection.model}` : "none selected"
    }\n`,
  );
  return 0;
}

function models(service: LocalProviderService, providerId: string | undefined): number {
  const entries = service.listModels(providerId);
  if (entries.length === 0) {
    process.stdout.write(
      providerId
        ? `No known models for "${providerId}".\n`
        : "No models are known yet.\n",
    );
    return 0;
  }

  for (const entry of entries) {
    const window = entry.contextWindow ? `  ${entry.contextWindow} ctx` : "";
    process.stdout.write(`  ${entry.id}${window}\n`);
  }
  return 0;
}

async function connect(
  service: LocalProviderService,
  providerId: string | undefined,
): Promise<number> {
  if (!providerId) {
    process.stderr.write("Usage: pnpm providers connect <provider-id>\n");
    return 2;
  }

  await service.connectInteractively(providerId, interaction);
  process.stdout.write(
    `Connected ${providerId}. The credential is in your OS keychain.\n`,
  );
  return 0;
}

async function disconnect(
  service: LocalProviderService,
  providerId: string | undefined,
): Promise<number> {
  if (!providerId) {
    process.stderr.write("Usage: pnpm providers disconnect <provider-id>\n");
    return 2;
  }

  await service.disconnect(providerId);
  process.stdout.write(`Disconnected ${providerId}.\n`);
  return 0;
}

function add(service: LocalProviderService, args: readonly string[]): number {
  const [id, baseUrl] = args;
  if (!id || !baseUrl) {
    process.stderr.write(
      "Usage: pnpm providers add <id> <base-url> [--name N] [--api A] [--models a,b]\n",
    );
    return 2;
  }

  const flags = readFlags(args.slice(2));
  const config = service.addCustomProvider({
    id,
    baseUrl,
    ...(flags.name === undefined ? {} : { name: flags.name }),
    ...(flags.api === undefined ? {} : { api: flags.api }),
    ...(flags.models === undefined
      ? {}
      : { models: flags.models.split(",").map((entry) => entry.trim()).filter(Boolean) }),
  });

  process.stdout.write(
    `Added ${config.id} (${config.api}) at ${config.baseUrl} with ${config.models.length} model(s).\n`,
  );
  return 0;
}

async function remove(
  service: LocalProviderService,
  id: string | undefined,
): Promise<number> {
  if (!id) {
    process.stderr.write("Usage: pnpm providers remove <id>\n");
    return 2;
  }

  const removed = await service.removeCustomProvider(id);
  process.stdout.write(
    removed ? `Removed ${id}.\n` : `No custom provider "${id}".\n`,
  );
  return removed ? 0 : 1;
}

async function select(
  service: LocalProviderService,
  specifier: string | undefined,
): Promise<number> {
  if (!specifier) {
    process.stderr.write("Usage: pnpm providers select <provider/model>\n");
    return 2;
  }

  const selection = await service.selectDefaultModel(
    parseModelSpecifier(specifier),
  );
  process.stdout.write(
    `Default model is now ${selection.provider}/${selection.model}.\n`,
  );
  return 0;
}

function showDefault(service: LocalProviderService): number {
  const selection = service.getDefaultModel();
  process.stdout.write(
    selection
      ? `${selection.provider}/${selection.model}\n`
      : "No default model selected. Run: pnpm providers select <provider/model>\n",
  );
  return selection ? 0 : 1;
}

async function main(): Promise<number> {
  const [, , command = "list", ...rest] = process.argv;
  const service = buildService();

  switch (command) {
    case "list":
      return list(service);
    case "models":
      return models(service, rest[0]);
    case "connect":
      return connect(service, rest[0]);
    case "disconnect":
      return disconnect(service, rest[0]);
    case "add":
      return add(service, rest);
    case "remove":
      return remove(service, rest[0]);
    case "select":
      return select(service, rest[0]);
    case "default":
      return showDefault(service);
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
    closeDatabase();
  });
