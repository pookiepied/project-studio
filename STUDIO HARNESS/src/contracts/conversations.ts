import * as v from "valibot";

import { reasoningChoiceSchema, type ReasoningChoice } from "./models.js";
import { executionModeSchema, type ExecutionMode } from "../permissions/mode.js";

/**
 * The conversation index contract.
 *
 * A record here describes *that* a conversation exists — identity, its title
 * as the product shows it, where it is filed, and when it was last used. It
 * never carries transcript content: the words live in Flue's conversation
 * stream at `agents/studio/<id>` and are re-read from there, so a record and
 * a stream disagreeing about text is not a state this schema can even
 * represent.
 *
 * `modelId` names the model the conversation is held with, in the local
 * runtime's own `<provider>/<model>` vocabulary, or null for the stable
 * default alias. It is written when a turn carrying a model is admitted, and
 * read when a conversation is reopened, so the picker restores the choice
 * rather than resetting to the default. `reasoningLevel` is the same fact for
 * the reasoning effort: a level, "default", or null - null and "default" are
 * the same state, kept distinct on the wire only so a choice is never turned
 * into an absence by a parser.
 *
 * `permissionMode` is the same shape of fact for the execution mode: the
 * per-conversation answer to "what does an unapproved call do", stored in the
 * harness's own vocabulary (`ask` / `auto`) and validated at every boundary
 * that accepts one. It never reads as null - the store maps an unset row to
 * Ask before this schema sees it, because an absent consent IS Ask and a
 * nullable mode would put a third state beside two real ones.
 */

const conversationIdSchema = v.pipe(v.string(), v.minLength(1));

/** The marks the sidebar's project rail may wear; mirrored in the webview. */
const projectIconSchema = v.picklist([
  "arc",
  "stack",
  "grid",
  "ring",
  "wave",
  "burst",
  "prism",
  "diamond",
]);

export type ProjectIcon = v.InferOutput<typeof projectIconSchema>;

export interface ConversationRecord {
  readonly id: string;
  readonly title: string | null;
  readonly projectId: string | null;
  /** A renamed conversation has stopped being auto-titled, permanently. */
  readonly titleManual: boolean;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly modelId: string | null;
  readonly reasoningLevel: ReasoningChoice | null;
  readonly permissionMode: ExecutionMode;
  readonly createdAt: number;
  readonly lastTurnAt: number;
}

/**
 * What creating an index row means.
 *
 * The id is caller-chosen (ADR 0045) and already addresses a stream by the
 * time this body is sent: creation happens on the admission receipt, never
 * before a harness has taken the turn, so a refused first send creates no row,
 * no sidebar entry, and no navigation. `firstMessage` is what the title is
 * derived from once, unless the caller says the title is already named.
 *
 * `modelId` and `reasoningLevel` record the settings the first turn was sent
 * with. They are normally written by the turn-settings middleware at
 * admission, before the run's initializer reads them; a create call carrying
 * them lands on an existing row through this schema and is the same write.
 * `permissionMode` rides beside them on the same terms: a value here is the
 * mode the conversation is held with from that turn on, absent leaves the
 * stored answer (unset reads as Manual) standing.
 */
export const conversationCreateSchema = v.object({
  id: conversationIdSchema,
  firstMessage: v.pipe(v.string(), v.minLength(1)),
  projectId: v.optional(v.nullable(conversationIdSchema)),
  modelId: v.optional(v.nullable(v.pipe(v.string(), v.minLength(1)))),
  reasoningLevel: v.optional(v.nullable(reasoningChoiceSchema)),
  permissionMode: v.optional(executionModeSchema),
  createdAt: v.optional(v.number()),
});

export type ConversationCreateInput = v.InferInput<typeof conversationCreateSchema>;

/**
 * Everything a rename, pin, archive, filing change, or later-turn stamp changes.
 * Absent keys are left alone; `projectId` distinguishes absence from clearing with null, the
 * same convention the provider connection patch uses.
 *
 * `modelId` and `reasoningLevel` settle the conversation's settings before any
 * turn runs. null clears the model back to the stable default alias - the
 * picker's "Studio default" row is that write - and a level choice replaces
 * whatever was stored, "default" included. `permissionMode` patches the same
 * way minus the null: Manual is the bottom of the scale, not a clearing of
 * it, so an absent key leaves the stored mode alone and a named one replaces
 * it.
 */
export const conversationPatchSchema = v.object({
  title: v.optional(v.pipe(v.string(), v.minLength(1))),
  pinned: v.optional(v.boolean()),
  archived: v.optional(v.boolean()),
  projectId: v.optional(v.nullable(conversationIdSchema)),
  modelId: v.optional(v.nullable(v.pipe(v.string(), v.minLength(1)))),
  reasoningLevel: v.optional(v.nullable(reasoningChoiceSchema)),
  permissionMode: v.optional(executionModeSchema),
  lastTurnAt: v.optional(v.number()),
});

export const projectFolderSpecSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  path: v.pipe(v.string(), v.minLength(1)),
});

export const projectCreateSchema = v.object({
  id: v.optional(v.pipe(v.string(), v.minLength(1))),
  name: v.pipe(v.string(), v.minLength(1)),
  icon: projectIconSchema,
  description: v.optional(v.pipe(v.string(), v.maxLength(2_000))),
  folders: v.optional(v.array(projectFolderSpecSchema)),
  createdAt: v.optional(v.number()),
});

export type ProjectCreateInput = v.InferInput<typeof projectCreateSchema>;

export const projectPatchSchema = v.object({
  name: v.optional(v.pipe(v.string(), v.minLength(1))),
  description: v.optional(v.pipe(v.string(), v.maxLength(2_000))),
  icon: v.optional(projectIconSchema),
});
