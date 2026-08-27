import * as v from "valibot";

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
 * `modelId` names the model the last turn was taken with, or null while
 * nothing has recorded one. No submission carries a model today; the column
 * exists because a conversation that cannot remember which model it was
 * talking to would otherwise demand a migration the moment one could.
 */

export const conversationIdSchema = v.pipe(v.string(), v.minLength(1));

/** The marks the sidebar's project rail may wear; mirrored in the webview. */
export const projectIconSchema = v.picklist([
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

export const conversationRecordSchema = v.object({
  id: conversationIdSchema,
  title: v.nullable(v.pipe(v.string(), v.minLength(1))),
  projectId: v.nullable(conversationIdSchema),
  /** A renamed conversation has stopped being auto-titled, permanently. */
  titleManual: v.boolean(),
  pinned: v.boolean(),
  archived: v.boolean(),
  modelId: v.nullable(v.pipe(v.string(), v.minLength(1))),
  createdAt: v.number(),
  lastTurnAt: v.number(),
});

export type ConversationRecord = v.InferOutput<typeof conversationRecordSchema>;

/**
 * What creating an index row means.
 *
 * The id is caller-chosen (ADR 0045) and already addresses a stream by the
 * time this body is sent: creation happens on the admission receipt, never
 * before a harness has taken the turn, so a refused first send creates no row,
 * no sidebar entry, and no navigation. `firstMessage` is what the title is
 * derived from once, unless the caller says the title is already named.
 */
export const conversationCreateSchema = v.object({
  id: conversationIdSchema,
  firstMessage: v.pipe(v.string(), v.minLength(1)),
  projectId: v.optional(v.nullable(conversationIdSchema)),
  createdAt: v.optional(v.number()),
});

export type ConversationCreateInput = v.InferInput<typeof conversationCreateSchema>;

/**
 * Everything a rename, pin, archive, or filing change means. Absent keys are
 * left alone; `projectId` distinguishes absence from clearing with null, the
 * same convention the provider connection patch uses.
 */
export const conversationPatchSchema = v.object({
  title: v.optional(v.pipe(v.string(), v.minLength(1))),
  pinned: v.optional(v.boolean()),
  archived: v.optional(v.boolean()),
  projectId: v.optional(v.nullable(conversationIdSchema)),
  lastTurnAt: v.optional(v.number()),
});

export type ConversationPatch = v.InferOutput<typeof conversationPatchSchema>;

export const projectFolderSpecSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  path: v.pipe(v.string(), v.minLength(1)),
});

export type ProjectFolderSpec = v.InferInput<typeof projectFolderSpecSchema>;

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

export type ProjectPatch = v.InferOutput<typeof projectPatchSchema>;
