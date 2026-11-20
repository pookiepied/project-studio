import { conversationKey, serveStdio } from "../serve/stdio.js";
import { ExtendError } from "../extend/errors.js";
import { memoryTools } from "./tools.js";

/**
 * Studio Memory, the fourth of Studio's own MCP servers (ADR 0049 §3).
 *
 * A relay like Studio Customization: the profile and the memories live in
 * the harness's database, and these tools speak its conversation-scoped
 * memory routes, so this process holds no state to lose and a wedged relay
 * is a process to restart. Discovered, not eager, like every server over
 * MCP: at rest its only cost is a purpose sentence in the inventory, and the
 * remembered context itself reaches a conversation through the harness's
 * first-turn signal whether or not these tools are ever loaded.
 *
 * The conversation id comes from the call's `_meta`, which the harness
 * writes; the routes resolve visibility and the project from it.
 */
const tools = memoryTools();

serveStdio({
  info: { name: "studio-memory", version: "1.0.0" },
  definitions: () => tools.map((tool) => tool.definition),
  has: (name) => tools.some((tool) => tool.definition.name === name),
  call: async (name, args, meta) => {
    const tool = tools.find((candidate) => candidate.definition.name === name);
    if (tool === undefined) {
      throw new ExtendError("internal", { message: `No memory tool is called ${name}.` });
    }
    return tool.run(conversationKey(meta), args);
  },
  explain: (message) =>
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|aborted|timed? ?out/i.test(message)
      ? `${message} The harness's memory interface did not answer; it is usually restarting. Trying again shortly is the remedy.`
      : message,
  finish: async () => undefined,
});
