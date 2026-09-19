import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { ExtendError } from "../errors.js";
import { installationRoot, userCommandsDirectory } from "../../platform/paths.js";

/**
 * Slash commands: a name the person types after `/`, and what it does.
 *
 * ---- Two kinds -------------------------------------------------------------
 *
 * A **prompt command** is a Markdown file. Its body is a prompt the command
 * expands to, with the words typed after the name substituted for
 * `$ARGUMENTS` (and `$1` to `$9` for the individual words); its frontmatter
 * carries a one-line description for the picker and an argument hint. That
 * is the shape Claude Code settled on for `.claude/commands/<name>.md`, and
 * it is kept exactly so a file written for one works in the other: the
 * person's own commands are files they can read, copy and edit by hand.
 *
 * An **action command** is built into Studio and does something other than
 * send a prompt - `/compact` compacts the conversation. It has no file; it
 * is listed here so the picker offers everything the slash can do from one
 * list, and the webview runs the action itself.
 *
 * ---- Where files live -------------------------------------------------------
 *
 * Two roots, in the order they are trusted: the commands Studio ships under
 * the installation, then the person's own under the Studio home. The folder
 * IS the installation, as it is for skills: dropping a file in installs a
 * command, and the settings pane's editor is a convenience over the same
 * file. A user file that reuses a shipped name loses, for the reason skills
 * give; a user file that reuses a built-in name is refused, because a
 * prompt cannot stand in for an action.
 *
 * A command grants nothing. The prompt it expands to is sent as the
 * person's own words, and every tool the model then reaches for is judged
 * by the kernel exactly as if the person had typed the prompt out.
 */

export type CommandProvenance = "builtin" | "system" | "user";

export interface CommandRecord {
  /** The name typed after the slash. Lowercase letters, digits and hyphens. */
  readonly id: string;
  /** The picker's line: what the command does. */
  readonly description: string;
  /** What to type after the name, for the picker. Empty when nothing is expected. */
  readonly argumentHint: string;
  readonly provenance: CommandProvenance;
  /** A prompt to expand and send, or an action the webview runs. */
  readonly kind: "prompt" | "action";
  /** The file, absolute, for a prompt command. */
  readonly path: string | null;
}

/** A file that looked like a command and was not one, and why. */
export interface CommandProblem {
  readonly path: string;
  readonly reason: string;
}

export interface CommandRoot {
  readonly directory: string;
  readonly provenance: "system" | "user";
}

export function defaultCommandRoots(): readonly CommandRoot[] {
  return [
    { directory: join(installationRoot(), "commands"), provenance: "system" },
    { directory: userCommandsDirectory(), provenance: "user" },
  ];
}

/**
 * The actions Studio ships. Listed first so the picker's top entries are the
 * ones every install has, and so a file cannot take their names.
 */
export const BUILTIN_COMMANDS: readonly CommandRecord[] = [
  {
    id: "compact",
    description: "Compact the conversation: fold the earlier turns into a summary",
    argumentHint: "",
    provenance: "builtin",
    kind: "action",
    path: null,
  },
];

const COMMAND_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Whether a name may be a command's. */
export function isCommandId(value: string): boolean {
  return COMMAND_ID.test(value);
}

/** A command file's frontmatter, as much of YAML as a command needs. */
export interface CommandFrontmatter {
  readonly description: string;
  readonly argumentHint: string;
}

/** A command file, read apart into its two halves. */
export interface CommandSource {
  readonly frontmatter: CommandFrontmatter;
  readonly body: string;
}

/**
 * Splits a command file into frontmatter and body.
 *
 * The frontmatter is `key: value` lines between two `---` fences, and the
 * two keys a command has are strings. That is the whole of what is read: a
 * nested value, a list, or a key this reader does not know is left alone
 * rather than refused, so a file that carries fields another tool wrote
 * still works here. A file with no fences is all body, with no description,
 * which the picker shows as the first line of the prompt.
 */
export function parseCommandMarkdown(text: string): CommandSource {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: { description: "", argumentHint: "" }, body: text.trim() };
  }
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (close === -1) {
    throw new ExtendError("invalid", {
      message: "The frontmatter opened with --- and never closed.",
    });
  }
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, close)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = unquote(line.slice(separator + 1).trim());
    fields.set(key, value);
  }
  return {
    frontmatter: {
      description: fields.get("description") ?? "",
      argumentHint: fields.get("argument-hint") ?? fields.get("argumentHint") ?? "",
    },
    body: lines.slice(close + 1).join("\n").trim(),
  };
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** The file a command is written to, from its two halves. */
export function renderCommandMarkdown(source: CommandSource): string {
  const fields: string[] = [];
  if (source.frontmatter.description !== "") {
    fields.push(`description: ${quoteIfNeeded(source.frontmatter.description)}`);
  }
  if (source.frontmatter.argumentHint !== "") {
    fields.push(`argument-hint: ${quoteIfNeeded(source.frontmatter.argumentHint)}`);
  }
  const head = fields.length === 0 ? "" : `---\n${fields.join("\n")}\n---\n\n`;
  return `${head}${source.body.trim()}\n`;
}

function quoteIfNeeded(value: string): string {
  return /[:#"'\n]/.test(value) ? JSON.stringify(value) : value;
}

/**
 * The prompt a command expands to for one set of arguments.
 *
 * `$ARGUMENTS` is everything typed after the name; `$1` to `$9` are its
 * words. A body that names none of them gets the arguments appended on a
 * line of their own, so a command written without a placeholder still
 * receives what the person typed rather than silently dropping it.
 */
export function expandCommand(body: string, args: string): string {
  const trimmed = args.trim();
  const words = trimmed === "" ? [] : trimmed.split(/\s+/);
  let used = false;
  const expanded = body.replace(/\$ARGUMENTS|\$([1-9])/g, (_match, index: string | undefined) => {
    used = true;
    if (index === undefined) return trimmed;
    return words[Number(index) - 1] ?? "";
  });
  if (used || trimmed === "") return expanded;
  return `${expanded}\n\n${trimmed}`;
}

/** The first sentence-ish line of a body, for a file with no description. */
function firstLine(body: string): string {
  const line = body.split(/\r?\n/).find((entry) => entry.trim() !== "") ?? "";
  return line.trim().slice(0, 120);
}

interface Scanned {
  readonly record: CommandRecord;
  readonly source: CommandSource;
  readonly stamp: string;
}

export class CommandRegistry {
  readonly #roots: readonly CommandRoot[];
  readonly #scanned = new Map<string, Scanned>();
  #problems: readonly CommandProblem[] = [];

  constructor(options: { readonly roots?: readonly CommandRoot[] } = {}) {
    this.#roots = options.roots ?? defaultCommandRoots();
  }

  /** The folder the person's own commands live in. */
  get userDirectory(): string {
    const root = this.#roots.find((entry) => entry.provenance === "user");
    return root?.directory ?? userCommandsDirectory();
  }

  /**
   * Every command, built-ins first, then files by name. Re-read from disk
   * on every call, with the same stat-not-read memo the skills use, so an
   * edit by hand shows on the next keystroke and a list per keystroke costs
   * a few stats.
   */
  list(): readonly CommandRecord[] {
    const found = new Map<string, CommandRecord>();
    for (const builtin of BUILTIN_COMMANDS) found.set(builtin.id, builtin);
    const problems: CommandProblem[] = [];
    const seen = new Set<string>();

    for (const root of this.#roots) {
      for (const path of commandFiles(root.directory)) {
        seen.add(path);
        const scanned = this.#scan(path, root.provenance, problems);
        if (scanned === undefined) continue;
        const existing = found.get(scanned.record.id);
        if (existing !== undefined) {
          problems.push({
            path,
            reason:
              existing.provenance === "builtin"
                ? `"${scanned.record.id}" is a built-in command. Rename this file.`
                : `A command named "${scanned.record.id}" already exists at ${existing.path}. Rename this file.`,
          });
          continue;
        }
        found.set(scanned.record.id, scanned.record);
      }
    }

    for (const path of this.#scanned.keys()) {
      if (!seen.has(path)) this.#scanned.delete(path);
    }
    this.#problems = problems;

    const files = [...found.values()]
      .filter((record) => record.provenance !== "builtin")
      .sort((a, b) => a.id.localeCompare(b.id));
    return [...BUILTIN_COMMANDS, ...files];
  }

  problems(): readonly CommandProblem[] {
    return this.#problems;
  }

  get(id: string): CommandRecord | undefined {
    return this.list().find((record) => record.id === id);
  }

  /** A prompt command's two halves, as its file holds them. */
  source(id: string): CommandSource {
    const record = this.#require(id);
    if (record.path === null) {
      throw new ExtendError("invalid", {
        message: `"/${id}" is built in and has no prompt to show.`,
      });
    }
    const scanned = this.#scanned.get(record.path);
    if (scanned === undefined) {
      throw new ExtendError("not_installed", { message: `No command named "${id}" exists.` });
    }
    return scanned.source;
  }

  /** The prompt one command expands to for the words typed after it. */
  expand(id: string, args: string): string {
    return expandCommand(this.source(id).body, args);
  }

  /**
   * Writes one of the person's own commands, creating or replacing its file.
   * A shipped or built-in name is refused: what Studio ships under a name
   * is part of what Studio is.
   */
  save(id: string, source: CommandSource): CommandRecord {
    if (!isCommandId(id)) {
      throw new ExtendError("invalid", {
        message: "A command name is lowercase letters, digits and hyphens, starting with a letter or digit.",
      });
    }
    if (source.body.trim() === "") {
      throw new ExtendError("invalid", { message: "A command needs a prompt." });
    }
    const existing = this.get(id);
    if (existing !== undefined && existing.provenance !== "user") {
      throw new ExtendError("invalid", {
        message:
          existing.provenance === "builtin"
            ? `"/${id}" is built in. Choose another name.`
            : `"/${id}" ships with Studio. Choose another name.`,
      });
    }
    mkdirSync(this.userDirectory, { recursive: true });
    writeFileSync(join(this.userDirectory, `${id}.md`), renderCommandMarkdown(source), "utf8");
    const saved = this.get(id);
    if (saved === undefined) {
      throw new ExtendError("internal", { message: `The command "${id}" was written but did not read back.` });
    }
    return saved;
  }

  /** Removes one of the person's own commands. Only theirs: the rest are not files they own. */
  remove(id: string): void {
    const record = this.#require(id);
    if (record.provenance !== "user" || record.path === null) {
      throw new ExtendError("invalid", {
        message: `"/${id}" is not one of your own commands and cannot be removed here.`,
      });
    }
    rmSync(record.path, { force: true });
    this.#scanned.delete(record.path);
  }

  #require(id: string): CommandRecord {
    const record = this.get(id);
    if (record === undefined) {
      throw new ExtendError("not_installed", { message: `No command named "${id}" exists.` });
    }
    return record;
  }

  #scan(path: string, provenance: "system" | "user", problems: CommandProblem[]): Scanned | undefined {
    let stamp: string;
    try {
      const stat = statSync(path);
      stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return undefined;
    }
    const held = this.#scanned.get(path);
    if (held !== undefined && held.stamp === stamp) return held;

    const id = basename(path, extname(path));
    if (!isCommandId(id)) {
      problems.push({
        path,
        reason: "A command's file name is its name: lowercase letters, digits and hyphens.",
      });
      return undefined;
    }
    try {
      const source = parseCommandMarkdown(readFileSync(path, "utf8"));
      if (source.body === "") {
        problems.push({ path, reason: "The file has no prompt under its frontmatter." });
        return undefined;
      }
      const record: CommandRecord = {
        id,
        description:
          source.frontmatter.description !== ""
            ? source.frontmatter.description
            : firstLine(source.body),
        argumentHint: source.frontmatter.argumentHint,
        provenance,
        kind: "prompt",
        path,
      };
      const scanned: Scanned = { record, source, stamp };
      this.#scanned.set(path, scanned);
      return scanned;
    } catch (error) {
      problems.push({
        path,
        reason: error instanceof Error ? error.message : "The file could not be read.",
      });
      return undefined;
    }
  }
}

/** The `.md` files directly inside one root, in name order. */
function commandFiles(directory: string): readonly string[] {
  if (!existsSync(directory)) return [];
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  return entries
    .filter((name) => extname(name).toLowerCase() === ".md")
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(directory, name));
}
