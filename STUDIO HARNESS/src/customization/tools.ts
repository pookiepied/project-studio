import { rmSync } from "node:fs";
import { basename } from "node:path";

import { ExtendError } from "../extend/errors.js";
import type { ToolResult } from "../serve/stdio.js";
import { connectionDirectory, installPackage } from "./installer.js";
import {
  connectionRecord,
  managementEndpoint,
  ManagementClient,
  type ConnectionView,
  type ManagementEnvironment,
} from "./management.js";

/**
 * The connection tools of Studio Customization.
 *
 * Six verbs, each a real tool with its own schema and its own description,
 * because a model reads descriptions rather than input-union documentation
 * - and because each verb's failure has its own honest next step. What they
 * all share is that none of them owns state: every one of them speaks the
 * management routes the settings screens speak, so there is one authority
 * over what is installed, who gets it and what the approvals meant, and
 * this file only decides what the answer *says*.
 *
 * Two timing truths repeat in these answers on purpose, because both have
 * bitten before. A connection that was just added starts in the background;
 * its tools arrive through discovery, and `connection_status` tells you when
 * - or what went wrong. And a switch answers with what it *resolves to*
 * after the change, not just what was stored, because "off" and "back to
 * inheriting" leave the model with different reach and read as the same
 * silence.
 */

export interface ConnectionTool {
  readonly definition: {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
  };
  readonly run: (conversationId: string, input: Record<string, unknown>) => Promise<ToolResult>;
}

/** The JSON-schema envelope every tool here uses. */
function object(
  properties: Record<string, unknown>,
  required: readonly string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    ...(required.length === 0 ? {} : { required: [...required] }),
    additionalProperties: false,
  };
}

function answer(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function requiredText(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ExtendError("internal", { message: `${field} must be a non-empty string.` });
  }
  return value;
}

function optionalText(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ExtendError("internal", { message: `${field} must be text.` });
  }
  return value;
}

function optionalTextList(input: Record<string, unknown>, field: string): readonly string[] | undefined {
  const value = input[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ExtendError("internal", { message: `${field} must be a list of text.` });
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function optionalBoolean(input: Record<string, unknown>, field: string): boolean | undefined {
  const value = input[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new ExtendError("internal", { message: `${field} must be true or false.` });
  }
  return value;
}

/** `on`, `off` or `inherit` - the third answer the selection store carries and a boolean cannot. */
function stateOf(input: Record<string, unknown>): "on" | "off" | "inherit" {
  const value = requiredText(input, "state");
  if (value === "on" || value === "off" || value === "inherit") return value;
  throw new ExtendError("internal", {
    message: "state must be \"on\", \"off\", or \"inherit\" to hand the decision back to the wider scope.",
  });
}

type AddKind = "address" | "package" | "command";

function kindOf(input: Record<string, unknown>): AddKind {
  const value = requiredText(input, "kind");
  if (value === "address" || value === "package" || value === "command") return value;
  throw new ExtendError("internal", {
    message: "kind must be \"address\" (a remote server), \"package\" (an npm name), or \"command\" (a program on this machine).",
  });
}

function scopeOf(input: Record<string, unknown>): "conversation" | "project" | "everywhere" {
  const value = optionalText(input, "scope");
  // The ask was explicit - the model says "add this" - so the record's
  // default is the widest thing that still means one connection: everywhere.
  // A narrower switch is one set_connection away, which the answer says.
  if (value === undefined || value === "everywhere") return "everywhere";
  if (value === "project" || value === "conversation") return value;
  throw new ExtendError("internal", {
    message: "scope must be \"conversation\", \"project\", or \"everywhere\".",
  });
}

function authOf(input: Record<string, unknown>): "none" | "bearer" | "header" {
  const value = optionalText(input, "auth");
  if (value === undefined || value === "none") return "none";
  if (value === "bearer" || value === "header") return value;
  throw new ExtendError("internal", { message: "auth must be none, bearer, or header." });
}

/** The words for where a decision was made, as the settings screens would say them. */
function decidedBy(decidedAt: string | undefined): string {
  switch (decidedAt) {
    case "conversation": return "this conversation's own decision";
    case "project": return "its project's decision";
    case "global": return "the user's default";
    default: return "nobody, so it is off here";
  }
}

/** How the switch reads for this conversation, whatever the status call knew. */
function enablePhrase(view: ConnectionView): string {
  const reading = view.conversation;
  if (reading === undefined) {
    return `${view.enabledByDefault ? "on" : "off"} by the user's default (no switch recorded for this conversation)`;
  }
  if (reading.decision === null) {
    return `inherits: ${reading.resolved ? "on" : "off"} here, by ${decidedBy(reading.decidedAt)}`;
  }
  return `${reading.resolved ? "on" : "off"} here, by this conversation's own decision`;
}

/** What the process is doing, in words, with the reason when there is one. */
function statePhrase(view: ConnectionView): string {
  const status = view.status;
  if (status === undefined) return "not started yet";
  switch (status.state) {
    case "ready": return "running";
    case "starting": return "starting";
    case "failed":
      return `failed: ${status.lastError ?? "no reason given"}`;
    case "given-up":
      return `gave up: ${status.lastError ?? "no reason given"}`;
    case "idle":
      return "not running";
    default:
      return status.state;
  }
}

/** The one fact that says what this connection actually is. */
function wherePhrase(view: ConnectionView): string {
  if (view.transport === "http" && view.url !== undefined) return view.url;
  if (view.command !== undefined) {
    const args = view.args.length === 0 ? "" : ` + ${String(view.args.length)} argument(s)`;
    return `${basename(view.command)}${args}`;
  }
  return "of unknown reach";
}

/** The endpoint this process was launched with, or the answer that says it was not. */
function clientOf(environment: ManagementEnvironment): ManagementClient {
  const endpoint = managementEndpoint(environment);
  if (endpoint === undefined) {
    throw new ExtendError("internal", {
      message:
        "This process was launched without the harness's management endpoint, so it cannot reach " +
        "Studio's settings. Launched outside the harness - a test or a plain run - most likely.",
    });
  }
  return new ManagementClient(endpoint);
}

/** The scope's own words, for answers that name where a decision now lives. */
function scopeWords(scope: "conversation" | "project" | "everywhere", projectId: string | undefined): string {
  switch (scope) {
    case "conversation": return "this conversation";
    case "project": return `the project ${projectId ?? ""}`.trim();
    case "everywhere": return "every conversation, as the user's default";
  }
}

const addConnection: ConnectionTool = {
  definition: {
    name: "add_connection",
    description:
      "Installs one MCP connection for this installation of Studio and switches it on. Three ways in: " +
      "an address (a remote MCP server, with its authentication), an npm package (downloaded here and " +
      "launched by its own entry), or a command (a program already on this machine, by its absolute " +
      "path). The connection starts in the background; its own tools arrive through discovery once it is.",
    inputSchema: object(
      {
        id: { type: "string", description: "A short unique name: letters, numbers, dots, dashes, underscores." },
        title: { type: "string", description: "The human label, usually the product's own name." },
        description: {
          type: "string",
          description: "One sentence saying what it is FOR - this is what every conversation is told.",
        },
        kind: { type: "string", description: "How to reach it: address, package, or command." },
        url: { type: "string", description: "kind=address: the https address the MCP server answers on." },
        command: { type: "string", description: "kind=command: the program's ABSOLUTE path - resolve it with your shell first if you only know the name." },
        args: { type: "array", items: { type: "string" }, description: "kind=command: the program's arguments, the entry script usually among them." },
        npmPackage: { type: "string", description: "kind=package: the npm package name; it is downloaded and its single binary entry launched." },
        auth: { type: "string", description: "kind=address: none, bearer, or header. Default none." },
        authHeader: { type: "string", description: "kind=address with a header: which header carries the secret." },
        secret: { type: "string", description: "The credential, when the connection has one. Saved to this machine's keychain, never stored in a conversation." },
        secretEnvVar: { type: "string", description: "With a secret on a local connection: the NAME of the environment variable the server reads its key from - its own documentation says." },
        needsNetwork: { type: "boolean", description: "Whether the connection is given the network when contained. Default true; most connections call an API." },
        scope: { type: "string", description: "Where the enabling decision lives: conversation (this conversation's switch only), project (needs projectId), or everywhere - the default, since the ask was explicit. The process starts for a project or everywhere connection." },
        projectId: { type: "string", description: "With scope=project: which project." },
      },
      ["id", "title", "description", "kind"],
    ),
  },
  run: async (conversationId, input) => {
    const id = requiredText(input, "id");
    const title = requiredText(input, "title");
    const description = requiredText(input, "description");
    const kind = kindOf(input);
    const scope = scopeOf(input);
    const projectId = optionalText(input, "projectId");
    const secret = optionalText(input, "secret");
    const secretEnvVar = optionalText(input, "secretEnvVar");
    const url = optionalText(input, "url");
    const command = optionalText(input, "command");
    const args = optionalTextList(input, "args");
    const npmPackage = optionalText(input, "npmPackage");
    const needsNetwork = optionalBoolean(input, "needsNetwork");
    const authHeader = optionalText(input, "authHeader");

    if (kind === "address" && url === undefined) {
      throw new ExtendError("internal", {
        message: "An address connection needs its URL - the address the MCP server answers on.",
      });
    }
    if (kind === "command" && command === undefined) {
      throw new ExtendError("internal", {
        message:
          "A command connection needs the program's absolute path. Resolve the name with your shell " +
          "first - `where` on Windows, `which` elsewhere - and pass what it answers.",
      });
    }
    if (kind === "package" && (npmPackage === undefined || npmPackage.trim() === "")) {
      throw new ExtendError("internal", { message: "A package connection needs the npm package's name." });
    }
    if (kind !== "address" && secret !== undefined && secretEnvVar === undefined) {
      throw new ExtendError("internal", {
        message:
          "A secret for a local connection needs the NAME of the environment variable the server reads " +
          "it from - the package's own documentation says which.",
      });
    }
    if (scope === "project" && (projectId === undefined || projectId === "")) {
      throw new ExtendError("internal", {
        message: "Switching it on for a project needs the project's id; scope=conversation needs none.",
      });
    }

    const installed =
      kind === "package" && npmPackage !== undefined
        ? installPackage(npmPackage, id, process.execPath)
        : undefined;

    // A secret implies its channel: the credential route refuses an
    // auth-less record, so the simplest truthful reading of "here is a key"
    // is bearer. An explicit choice still wins.
    const chosen = kind === "address" ? authOf(input) : "none";
    const auth = secret !== undefined && secret !== "" && chosen === "none" ? "bearer" : chosen;

    const record = connectionRecord({
      id,
      title,
      description,
      kind,
      ...(url === undefined ? {} : { url }),
      ...(command === undefined ? {} : { command }),
      ...(args === undefined ? {} : { args }),
      auth,
      ...(kind === "address" && authHeader !== undefined ? { authHeader } : {}),
      ...(needsNetwork === undefined ? {} : { needsNetwork }),
      ...(secretEnvVar === undefined ? {} : { secretEnvVar }),
      ...(installed === undefined ? {} : { installed }),
    });

    await clientOf(processEnv).add(record, {
      conversationId,
      ...(secret === undefined ? {} : { secret }),
      scope,
      ...(projectId === undefined ? {} : { projectId }),
    });

    const whatItIs =
      kind === "address"
        ? `Its address: ${url ?? ""}.`
        : kind === "package"
          ? `Downloaded into ${connectionDirectory(id)} and launched by its own entry.`
          : `Its program: ${command}${args === undefined ? "" : ` ${args.join(" ")}`}.`;
    const keyLine = secret === undefined ? "" : " Its secret: saved to this machine's credential store.";

    return answer(
      `Installed ${title} as ${id}. ${whatItIs}${keyLine} ` +
        `Switched on for ${scopeWords(scope, projectId)}. A project or everywhere connection starts in ` +
        `the background: connection_status ${id} says when it is ready - or what went wrong if it is not - ` +
        `and discover with action load, server "mcp:${id}" and tools all loads its tools once it is. A conversation-only switch starts ` +
        "nothing; it narrows what this conversation's own array resolves.",
    );
  },
};

const listConnections: ConnectionTool = {
  definition: {
    name: "list_connections",
    description:
      "Lists the MCP connections this installation of Studio knows: each one's state, and how its " +
      "switch resolves for this conversation. Any connection work - diagnosing, switching, " +
      "restarting, removing - starts here.",
    inputSchema: object({}),
  },
  run: async (conversationId) => {
    const connections = await clientOf(processEnv).list(conversationId);
    if (connections.length === 0) {
      return answer(
        "This installation has no MCP connections. add_connection starts one - by address, " +
          "by npm package, or by a program already on this machine.",
      );
    }
    const lines = connections.map(
      (connection) =>
        `${connection.id}  ${connection.title}  ${wherePhrase(connection)}  ` +
        `${statePhrase(connection)}; ${enablePhrase(connection)}.`,
    );
    return answer(
      `${lines.join("\n")}\n` +
        "connection_status names one's whole story - what it runs, why it failed, what it printed.",
    );
  },
};

const connectionStatus: ConnectionTool = {
  definition: {
    name: "connection_status",
    description:
      "One connection's whole story: what it runs, why it last failed, what its process printed, and " +
      "how its switch resolves for this conversation. Use it when a connection will not start or answers strangely.",
    inputSchema: object(
      { id: { type: "string", description: "The connection's id, as list_connections spells it." } },
      ["id"],
    ),
  },
  run: async (conversationId, input) => {
    const id = requiredText(input, "id");
    const view = await clientOf(processEnv).read(id, conversationId);

    const lines = [
      `${view.title} (${view.id}) - ${statePhrase(view)}.`,
      `What it is: ${view.transport === "http" ? `${view.url ?? "an address"}, ${view.auth} authentication` : `${view.command ?? ""} ${view.args.join(" ")}`.trim()}.`,
      `Purpose: ${view.description === "" ? "nobody has written one" : view.description}`,
      `Switch: ${enablePhrase(view)}. Network while contained: ${view.needsNetwork ? "granted" : "not granted"}.`,
    ];
    const status = view.status;
    if (status !== undefined && status.attempts > 0) {
      lines.push(`Failed starts: ${String(status.attempts)}${status.lastError === undefined ? "" : `. Last reason: ${status.lastError}`}.`);
    }
    if (status !== undefined && status.diagnostics.length > 0) {
      lines.push(`Its process's own output, most recent last:`, ...status.diagnostics.slice(-3).map((line) => `  ${line}`));
    }

    return answer(lines.join("\n"));
  },
};

const setConnection: ConnectionTool = {
  definition: {
    name: "set_connection",
    description:
      "Switches a connection on or off at one scope - this conversation, its project, or everywhere - " +
      "or hands the decision back with 'inherit'. Also replaces its secret, which stops and starts it, " +
      "because secrets are read at launch. The narrowest decision wins; 'inherit' removes this scope's " +
      "own opinion. The answer says what now applies, not just what was stored.",
    inputSchema: object(
      {
        id: { type: "string", description: "The connection's id." },
        state: { type: "string", description: "on, off, or inherit - inherit removes this scope's own opinion so the wider one applies again." },
        secret: { type: "string", description: "A new credential, when rotating. Replaces the saved one and restarts the connection." },
        scope: { type: "string", description: "Where the decision is written: everywhere (the user's default, the default), project (needs projectId), or conversation (this one only)." },
        projectId: { type: "string", description: "With scope=project: which project." },
      },
      ["id"],
    ),
  },
  run: async (conversationId, input) => {
    const id = requiredText(input, "id");
    const state = stateOf(input);
    const scope = scopeOf(input);
    const projectId = optionalText(input, "projectId");
    const secret = optionalText(input, "secret");
    if (scope === "project" && (projectId === undefined || projectId === "")) {
      throw new ExtendError("internal", { message: "A project's switch needs the project's id." });
    }

    let view = await clientOf(processEnv).set(id, scope, state, conversationId, projectId);
    if (secret !== undefined && secret !== "") {
      view = await clientOf(processEnv).setSecret(id, secret, conversationId);
    }
    const reading = view.conversation;
    const nowReads =
      reading === undefined
        ? "the wider scopes decide what applies here"
        : `it now reads ${reading.resolved ? "on" : "off"} here, by ${decidedBy(reading.decidedAt)}`;

    return answer(
      `${id}: ${state} at ${scopeWords(scope, projectId)}${secret === undefined ? "" : ", secret replaced"}. ${nowReads}.` +
        (state === "inherit" ? " (Inherit is not the same as off: it gives the decision back.)" : ""),
    );
  },
};

const restartConnection: ConnectionTool = {
  definition: {
    name: "restart_connection",
    description:
      "Stops a connection and lets the harness start it again immediately. Use it when a connection is " +
      "wedged, or just after changing its secret. connection_status says what happened.",
    inputSchema: object(
      { id: { type: "string", description: "The connection's id." } },
      ["id"],
    ),
  },
  run: async (_conversationId, input) => {
    const id = requiredText(input, "id");
    await clientOf(processEnv).restart(id);
    return answer(
      `${id}: stopped and told to come back. Starting takes a moment; ` +
        `connection_status ${id} shows when it is ready - or what failed this time.`,
    );
  },
};

const removeConnection: ConnectionTool = {
  definition: {
    name: "remove_connection",
    description:
      "Uninstalls a connection: its record, its approvals, its saved key, its decisions at every scope, " +
      "its process, and anything downloaded for it. Studio's own connections (the browser, the computer) " +
      "cannot be removed - switch those off instead.",
    inputSchema: object(
      { id: { type: "string", description: "The connection's id." } },
      ["id"],
    ),
  },
  run: async (_conversationId, input) => {
    const id = requiredText(input, "id");
    const removed = await clientOf(processEnv).remove(id);
    if (!removed) {
      throw new ExtendError("internal", { message: `${id} is not installed, so there is nothing to remove.` });
    }
    // The harness has forgotten it; the download is this process's to sweep, and
    // only here - where the convention that put it there is the neighbouring module.
    rmSync(connectionDirectory(id), { recursive: true, force: true });
    return answer(
      `Removed ${id}: its record, its approvals, its saved key if it had one, its decisions at every ` +
        "scope, and its process. Its downloaded copy, if it was installed from a package, went with it.",
    );
  },
};

/** The environment this process was launched with - a seam, so tests can name another. */
const processEnv: ManagementEnvironment = process.env;

export const connectionTools: readonly ConnectionTool[] = [
  addConnection,
  listConnections,
  connectionStatus,
  setConnection,
  restartConnection,
  removeConnection,
];
