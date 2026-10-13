import { StorageError } from "../storage/errors.js";

export type QueueAction = "list" | "steer" | "remove" | "edit";

declare global {
  var __projectStudioManageQueuedAgentInstance:
    | ((agent: unknown, id: string, submissionId: string | null, action: QueueAction) => Promise<unknown>)
    | undefined;
}

/** The runtime owns the queue and performs each change atomically with claims. */
export function manageQueuedMessages(agent: unknown, id: string, submissionId: string | null, action: QueueAction): Promise<unknown> {
  const manage = globalThis.__projectStudioManageQueuedAgentInstance;
  if (manage === undefined) throw new StorageError("unavailable", { message: "Queue control is unavailable." });
  return manage(agent, id, submissionId, action);
}
