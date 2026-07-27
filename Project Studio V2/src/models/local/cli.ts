/**
 * Provider connection for local BYOK.
 *
 * Usage:
 *   pnpm providers list
 *   pnpm providers connect <provider-id>
 *   pnpm providers disconnect <provider-id>
 *
 * Keys entered here go straight into the OS keychain through Pi's credential
 * store. They are never echoed, never written to a file, and never passed
 * through the harness's own model code.
 */
import { createInterface } from "node:readline";

import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";

import { KeyringCredentialStore } from "../../credentials/keyring-store.js";
import { resolveCustomProviders } from "./config.js";
import { PiCredentialStore } from "./credential-bridge.js";
import { createModelsCollection } from "./runtime.js";

function buildCollection() {
  return createModelsCollection({
    customProviders: resolveCustomProviders(),
    credentials: new PiCredentialStore(new KeyringCredentialStore()),
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

async function list(): Promise<number> {
  const models = buildCollection();
  const providers = models.getProviders();

  process.stdout.write(`${providers.length} providers available.\n\n`);

  const connected: string[] = [];
  for (const provider of providers) {
    const check = await models.checkAuth(provider.id).catch(() => undefined);
    if (check) connected.push(`  ${provider.id}  (${check.type}, ${check.source ?? "configured"})`);
  }

  if (connected.length === 0) {
    process.stdout.write(
      "No providers are configured yet. Connect one:\n  pnpm providers connect openai\n",
    );
    return 0;
  }

  process.stdout.write(`Configured:\n${connected.join("\n")}\n`);
  return 0;
}

async function connect(providerId: string | undefined): Promise<number> {
  if (!providerId) {
    process.stderr.write("Usage: pnpm providers connect <provider-id>\n");
    return 2;
  }

  const models = buildCollection();
  const provider = models.getProvider(providerId);
  if (!provider) {
    process.stderr.write(
      `Unknown provider "${providerId}". Run "pnpm providers list" to see the available ids, or declare a custom provider in PROJECT_STUDIO_LOCAL_PROVIDERS.\n`,
    );
    return 1;
  }

  // Prefer an API key when the provider offers one; OAuth providers fall back
  // to their own flow, which Pi drives through the same interaction callbacks.
  const type = provider.auth.apiKey ? "api_key" : "oauth";
  await models.login(providerId, type, interaction);

  process.stdout.write(`Connected ${providerId}. The credential is in your OS keychain.\n`);
  return 0;
}

async function disconnect(providerId: string | undefined): Promise<number> {
  if (!providerId) {
    process.stderr.write("Usage: pnpm providers disconnect <provider-id>\n");
    return 2;
  }

  const models = buildCollection();
  await models.logout(providerId);
  process.stdout.write(`Disconnected ${providerId}.\n`);
  return 0;
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? "list";
  const target = process.argv[3];

  switch (command) {
    case "list":
      return list();
    case "connect":
      return connect(target);
    case "disconnect":
      return disconnect(target);
    default:
      process.stderr.write(
        `Unknown command "${command}". Expected list, connect, or disconnect.\n`,
      );
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Never print a stack here: this path handles credentials.
    process.stderr.write(
      `${error instanceof Error ? error.message : "Provider command failed."}\n`,
    );
    process.exitCode = 1;
  });
