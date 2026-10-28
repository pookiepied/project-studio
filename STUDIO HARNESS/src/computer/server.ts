import { serveStdio } from "../serve/stdio.js";
import { ComputerService } from "./service.js";
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
 *
 * One driver per conversation, when the caller says which conversation: the
 * refs `read_ui` hands out live in the driver's memory, so two conversations
 * on one driver would see each other's `ui_12`. Studio's own client sends the
 * conversation, and the acting agent, in `_meta`; any other caller shares one.
 * One desktop lease over all of them (`control.ts`).
 */
const service = new ComputerService();

serveStdio({
  info: { name: "studio-computer", version: "1.0.0" },
  definitions,
  has: (name) => toolByName(name) !== undefined,
  call: (name, args, meta) => service.call(name, args, meta),
  controlMethod: "studio/computer",
  control: (_method, params) => service.control(params),
  // A driver with nobody to answer to is a PowerShell doing nothing, and one
  // that dies mid-hold leaves a key held. Closing before exit is what keeps
  // both out of the person's way after Studio quits.
  finish: () => service.finish(),
});
