import * as v from "valibot";

export const harnessEventSchema = v.variant("type", [
  v.object({
    type: v.literal("run.accepted"),
    threadId: v.string(),
    submissionId: v.string(),
  }),
  v.object({
    type: v.literal("text.delta"),
    threadId: v.string(),
    text: v.string(),
  }),
  v.object({
    type: v.literal("tool.started"),
    threadId: v.string(),
    toolCallId: v.string(),
    toolName: v.string(),
  }),
  v.object({
    type: v.literal("tool.completed"),
    threadId: v.string(),
    toolCallId: v.string(),
    toolName: v.string(),
    isError: v.boolean(),
  }),
  v.object({
    type: v.literal("run.completed"),
    threadId: v.string(),
    submissionId: v.string(),
  }),
  v.object({
    type: v.literal("run.aborted"),
    threadId: v.string(),
    submissionId: v.string(),
  }),
  v.object({
    type: v.literal("run.failed"),
    threadId: v.string(),
    submissionId: v.string(),
    message: v.string(),
  }),
]);

export type HarnessEvent = v.InferOutput<typeof harnessEventSchema>;
