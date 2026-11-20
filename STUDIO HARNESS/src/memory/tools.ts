import { ExtendError } from "../extend/errors.js";
import type { ToolResult } from "../serve/stdio.js";
import { managementEndpoint, type ManagementEnvironment } from "../customization/management.js";
import { MemoryRelay, type MemoryBatchView, type MemoryView, type ProfileView, type ProjectView } from "./relay.js";

/**
 * The tools of Studio Memory.
 *
 * ---- When to save is the hard part, so the descriptions carry it ------------
 *
 * Capture costs no model call of its own: a memory exists only because the
 * model called `studio_memory_save` or the person wrote one in Settings. The
 * save description and the system prompt's Memory section are therefore the
 * whole policy, and both are written to make the model save rarely - a
 * durable fact the person would expect to be known next time, not a summary
 * of every conversation.
 *
 * ---- Every write is a batch -------------------------------------------------
 *
 * Save, update and forget each take a list, so tidying ten memories is one
 * call and one approval, not ten. One entry is a list of one. The routes
 * answer entry by entry, and so do these tools.
 *
 * ---- Scope is two words, and the harness owns the rest ----------------------
 *
 * `personal` is about the person and is the default. `project` is about the
 * current project's work and is accepted only in a conversation filed under
 * a project; the route derives which project, so there is no project id in
 * any schema here for a model to get wrong.
 */

export interface MemoryTool {
  readonly definition: {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
    readonly annotations?: Record<string, unknown>;
  };
  readonly run: (conversationId: string, input: Record<string, unknown>) => Promise<ToolResult>;
}

const KINDS = ["fact", "preference", "instruction", "event"] as const;
const SCOPES = ["personal", "project"] as const;
const PRIORITIES = ["low", "normal", "high"] as const;
const PROFILE_FIELDS = ["name", "preferredName", "about", "replyStyle"] as const;
const MAX_BATCH = 50;

function object(properties: Record<string, unknown>, required: readonly string[] = []): Record<string, unknown> {
  return {
    type: "object",
    properties,
    ...(required.length === 0 ? {} : { required: [...required] }),
    additionalProperties: false,
  };
}

function answer(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

function invalid(message: string): ExtendError {
  return new ExtendError("internal", { message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(input: Record<string, unknown>, field: string, where = ""): string | undefined {
  const value = input[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalid(`${where}${field} must be text.`);
  return value;
}

function requiredText(input: Record<string, unknown>, field: string, where = ""): string {
  const value = optionalText(input, field, where);
  if (value === undefined || value.trim() === "") throw invalid(`${where}${field} must be a non-empty string.`);
  return value;
}

function oneOf<T extends string>(input: Record<string, unknown>, field: string, allowed: readonly T[], where = ""): T | undefined {
  const value = optionalText(input, field, where);
  if (value === undefined) return undefined;
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw invalid(`${where}${field} must be one of ${allowed.join(", ")}.`);
  return found;
}

function tags(input: Record<string, unknown>, where = ""): readonly string[] | undefined {
  const value = input["tags"];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw invalid(`${where}tags must be a list of words.`);
  return value.filter((tag): tag is string => typeof tag === "string");
}

function priorityNumber(input: Record<string, unknown>, where = ""): 1 | 2 | 3 | undefined {
  const priority = oneOf(input, "priority", PRIORITIES, where);
  if (priority === undefined) return undefined;
  return priority === "low" ? 1 : priority === "high" ? 3 : 2;
}

function priorityWord(value: number): string {
  return value === 3 ? "high" : value === 1 ? "low" : "normal";
}

/** The list a batch tool was given, bounded, each entry a record. */
function entries(input: Record<string, unknown>, field: string): readonly Record<string, unknown>[] {
  const value = input[field];
  if (!Array.isArray(value) || value.length === 0) throw invalid(`${field} must be a non-empty list.`);
  if (value.length > MAX_BATCH) throw invalid(`${field} takes at most ${String(MAX_BATCH)} entries per call.`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw invalid(`${field}[${String(index)}] must be an object.`);
    return entry;
  });
}

function day(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10);
}

/** One memory as the model reads it: what, how important, where it applies, when. */
export function memoryLine(item: MemoryView, project: ProjectView | null): string {
  const where = item.scope === "project" ? `project${project === null ? "" : ` ${project.name}`}` : "personal";
  const tagged = item.tags.length === 0 ? "" : `, tags: ${item.tags.join(", ")}`;
  return `- ${item.content} [${item.kind}, ${where}, ${priorityWord(item.priority)} priority${tagged}; id ${item.id}; updated ${day(item.updatedAt)}]`;
}

function profileText(profile: ProfileView): string {
  return PROFILE_FIELDS.map((field) => `${field}: ${profile[field] === "" ? "(empty)" : profile[field]}`).join("\n");
}

/**
 * A batch answer, entry by entry, with a refusal marked as an error only when
 * nothing in the batch succeeded - a partly applied batch is a result the
 * model must read, not a failure to retry whole.
 */
function batchAnswer(view: MemoryBatchView, verb: string): ToolResult {
  const lines: string[] = [];
  let succeeded = 0;
  view.results.forEach((result, index) => {
    const label = view.results.length === 1 ? "" : `${String(index + 1)}. `;
    if (!result.ok) {
      lines.push(`${label}Not ${verb}${result.id === undefined ? "" : ` (${result.id})`}: ${result.error ?? "refused"}`);
      return;
    }
    succeeded += 1;
    if (result.item === undefined) {
      lines.push(`${label}${verb[0]?.toUpperCase() ?? ""}${verb.slice(1)}: ${result.id ?? ""}`);
      return;
    }
    lines.push(`${label}${result.existed === true ? "Already remembered, nothing added" : `${verb[0]?.toUpperCase() ?? ""}${verb.slice(1)}`}:`);
    lines.push(memoryLine(result.item, view.project));
    if (result.similar !== undefined && result.similar.length > 0) {
      lines.push("  Similar memories already saved; if one says the same thing or is now wrong, merge them with studio_memory_update and forget the other:");
      for (const similar of result.similar) lines.push(`  ${memoryLine(similar, view.project)}`);
    }
  });
  if (view.results.length > 1) lines.unshift(`${String(succeeded)} of ${String(view.results.length)} ${verb}.`);
  return answer(lines.join("\n"), succeeded === 0);
}

function relayFor(environment: ManagementEnvironment): MemoryRelay {
  const endpoint = managementEndpoint(environment);
  if (endpoint === undefined) {
    throw new ExtendError("internal", {
      message: "Studio's memory interface is not available to this process. Restarting the memory connection usually fixes it.",
    });
  }
  return new MemoryRelay(endpoint);
}

const MEMORY_FIELDS = {
  content: { type: "string", minLength: 1, maxLength: 500, description: "One self-contained statement, third person." },
  kind: {
    type: "string",
    enum: [...KINDS],
    description:
      "fact: about the user or their world. preference: how they like things done. instruction: a standing rule for you. event: something dated or in progress.",
  },
  scope: {
    type: "string",
    enum: [...SCOPES],
    description: "personal (default): about the user, seen everywhere. project: about this project's own work, seen only in this project's conversations.",
  },
  priority: {
    type: "string",
    enum: [...PRIORITIES],
    description: "high: shown at the start of every conversation. normal: shown while recent, then found by search. low: search only.",
  },
  tags: { type: "array", items: { type: "string" }, maxItems: 8 },
} as const;

export function memoryTools(
  relay: () => MemoryRelay = () => relayFor(process.env),
): readonly MemoryTool[] {
  return [
    {
      definition: {
        name: "studio_memory_search",
        description:
          "Searches what Studio remembers about the user and, in a project conversation, about this project. " +
          "Use it when earlier context would change your answer and the memory block at the start of the " +
          "conversation does not already cover it, when the user asks what you remember, and before saving " +
          "or editing so you work from the current ids. Words are matched loosely, best match first; with no " +
          "query it lists the most recently changed. Do not search on every turn.",
        inputSchema: object({
          query: { type: "string", description: "Words to look for." },
          kind: { type: "string", enum: [...KINDS] },
          scope: { type: "string", enum: [...SCOPES], description: "Only personal, or only this project's." },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        }),
        annotations: { readOnlyHint: true },
      },
      run: async (conversationId, input) => {
        const limitValue = input["limit"];
        const query = optionalText(input, "query");
        const kind = oneOf(input, "kind", KINDS);
        const scope = oneOf(input, "scope", SCOPES);
        const view = await relay().search(conversationId, {
          ...(query === undefined ? {} : { query }),
          ...(kind === undefined ? {} : { kind }),
          ...(scope === undefined ? {} : { scope }),
          ...(typeof limitValue === "number" ? { limit: limitValue } : {}),
        });
        if (view.items.length === 0) {
          return answer(
            view.total === 0
              ? "Nothing is remembered yet."
              : `No memory matched. ${String(view.total)} memories are visible here; try other words, or no query for the newest.`,
          );
        }
        return answer(
          [
            `${String(view.items.length)} of ${String(view.total)} visible memories${view.project === null ? "" : ` (this conversation is in project ${view.project.name})`}:`,
            ...view.items.map((item) => memoryLine(item, view.project)),
          ].join("\n"),
        );
      },
    },
    {
      definition: {
        name: "studio_memory_save",
        description:
          "Saves one or more short, durable statements for future conversations. Save when the user asks you " +
          "to remember something, or states a lasting fact, preference or standing instruction they would be " +
          "annoyed to repeat. Do not save small talk, one-off task details, what the memory block already says, " +
          "guesses, secrets or credentials, or a summary of the conversation; most conversations need no save. " +
          "Several related facts from one message go in one call. An identical memory is not saved twice, and " +
          "each save lists similar existing memories so you can merge them instead.",
        inputSchema: object(
          {
            memories: {
              type: "array",
              minItems: 1,
              maxItems: MAX_BATCH,
              items: object(MEMORY_FIELDS, ["content", "kind"]),
            },
          },
          ["memories"],
        ),
      },
      run: async (conversationId, input) => {
        const items = entries(input, "memories").map((entry, index) => {
          const where = `memories[${String(index)}].`;
          const kind = oneOf(entry, "kind", KINDS, where);
          if (kind === undefined) throw invalid(`${where}kind must be one of ${KINDS.join(", ")}.`);
          const scope = oneOf(entry, "scope", SCOPES, where);
          const priority = priorityNumber(entry, where);
          const given = tags(entry, where);
          return {
            content: requiredText(entry, "content", where),
            kind,
            ...(scope === undefined ? {} : { scope }),
            ...(priority === undefined ? {} : { priority }),
            ...(given === undefined ? {} : { tags: given }),
          };
        });
        return batchAnswer(await relay().save(conversationId, items), "saved");
      },
    },
    {
      definition: {
        name: "studio_memory_update",
        description:
          "Edits one or more saved memories by id: correct the text when the user corrects it, change kind, " +
          "priority or tags, merge two memories into one (update the one you keep, forget the other), or move " +
          "one between personal and this project. Give each entry its id and only the fields that change.",
        inputSchema: object(
          {
            changes: {
              type: "array",
              minItems: 1,
              maxItems: MAX_BATCH,
              items: object({ id: { type: "string", minLength: 1 }, ...MEMORY_FIELDS }, ["id"]),
            },
          },
          ["changes"],
        ),
      },
      run: async (conversationId, input) => {
        const changes = entries(input, "changes").map((entry, index) => {
          const where = `changes[${String(index)}].`;
          const content = optionalText(entry, "content", where);
          const kind = oneOf(entry, "kind", KINDS, where);
          const scope = oneOf(entry, "scope", SCOPES, where);
          const priority = priorityNumber(entry, where);
          const given = tags(entry, where);
          const change = {
            id: requiredText(entry, "id", where),
            ...(content === undefined ? {} : { content }),
            ...(kind === undefined ? {} : { kind }),
            ...(scope === undefined ? {} : { scope }),
            ...(priority === undefined ? {} : { priority }),
            ...(given === undefined ? {} : { tags: given }),
          };
          if (Object.keys(change).length === 1) throw invalid(`${where} names no field to change.`);
          return change;
        });
        return batchAnswer(await relay().update(conversationId, changes), "updated");
      },
    },
    {
      definition: {
        name: "studio_memory_forget",
        description:
          "Deletes one or more saved memories by id, when the user asks you to forget them, they are no longer " +
          "true, or they duplicate another. New conversations stop seeing them; what this conversation has " +
          "already read is not unread. To forget everything about a topic, search first and pass every id.",
        inputSchema: object(
          { ids: { type: "array", minItems: 1, maxItems: MAX_BATCH, items: { type: "string", minLength: 1 } } },
          ["ids"],
        ),
        annotations: { destructiveHint: true },
      },
      run: async (conversationId, input) => {
        const raw = input["ids"];
        if (!Array.isArray(raw) || raw.length === 0) throw invalid("ids must be a non-empty list.");
        if (raw.length > MAX_BATCH) throw invalid(`ids takes at most ${String(MAX_BATCH)} entries per call.`);
        const ids = raw.map((id, index) => {
          if (typeof id !== "string" || id.trim() === "") throw invalid(`ids[${String(index)}] must be a memory id.`);
          return id.trim();
        });
        return batchAnswer(await relay().forget(conversationId, ids), "forgotten");
      },
    },
    {
      definition: {
        name: "studio_memory_profile",
        description:
          "Reads or updates the user's profile, which every new conversation starts with: name, what to call " +
          "them (preferredName), a short description of them and their work (about), and how they want replies " +
          "written (replyStyle). Call with no fields to read it. Change a field only when the user tells you " +
          "directly (\"call me Sam\", \"keep answers short\"); give only the fields that change, and an empty " +
          "string clears one. The user also edits it in Settings - Personalization.",
        inputSchema: object({
          name: { type: "string", maxLength: 80 },
          preferredName: { type: "string", maxLength: 80 },
          about: { type: "string", maxLength: 1000 },
          replyStyle: { type: "string", maxLength: 1000 },
        }),
      },
      run: async (conversationId, input) => {
        const change: Record<string, string> = {};
        for (const field of PROFILE_FIELDS) {
          const value = optionalText(input, field);
          if (value !== undefined) change[field] = value;
        }
        if (Object.keys(change).length === 0) {
          const { profile } = await relay().profile(conversationId);
          return answer(`Profile:\n${profileText(profile)}`);
        }
        const { profile } = await relay().setProfile(conversationId, change);
        return answer(`Profile updated:\n${profileText(profile)}`);
      },
    },
  ];
}
