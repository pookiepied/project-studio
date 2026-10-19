import { conversationKey, serveStdio } from "../serve/stdio.js";
import { ComputerError } from "./errors.js";
import { ComputerSession } from "./session.js";
import { definitions, toolByName } from "./tools.js";

/**
 * The computer-use capability, as an MCP server in its own process.
 *
 * The browser's shape (ADR 0049 §3), for the browser's reasons, plus one of
 * its own: the driver is a PowerShell process holding native handles and
 * UI Automation objects, and a fault inside one of those calls takes down
 * the process it is in. Better that process be this one than the harness.
 *
 * **Nothing here starts a driver.** Connecting, discovering and listing all
 * happen with no PowerShell anywhere; the first `tools/call` is what costs
 * something.
 */

/**
 * One driver per conversation, when the caller says which conversation.
 *
 * The refs `read_ui` hands out live in the driver's memory, so two
 * conversations on one driver would see each other's `ui_12`. Studio's own
 * client sends the conversation in `_meta`; any other caller shares one.
 */
const sessions = new Map<string, ComputerSession>();

function sessionFor(meta: unknown): ComputerSession {
  const key = conversationKey(meta);
  const existing = sessions.get(key);
  if (existing !== undefined) return existing;
  const created = new ComputerSession(key);
  sessions.set(key, created);
  return created;
}

serveStdio({
  info: { name: "studio-computer", version: "1.0.0" },
  definitions,
  has: (name) => toolByName(name) !== undefined,
  call: async (name, args, meta) => {
    const tool = toolByName(name);
    // Unreachable through `serveStdio`, which asks `has` first; kept as a
    // typed refusal so the taxonomy holds even for the impossible branch.
    if (tool === undefined) throw new ComputerError("bad_input", { message: `There is no tool called "${name}".` });
    const session = sessionFor(meta);
    // Stop bypasses the queue so cancellation invalidates queued input.
    return name === "studio_computer_stop"
      ? tool.run(session, args)
      : session.run(() => tool.run(session, args));
  },
  // A driver with nobody to answer to is a PowerShell doing nothing, and one
  // that dies mid-hold leaves a key held. Closing before exit is what keeps
  // both out of the person's way after Studio quits.
  finish: async () => {
    await Promise.all([...sessions.values()].map((session) => session.close()));
  },
});
