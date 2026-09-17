import { conversationKey, serveStdio } from "../serve/stdio.js";
import { ExtendError } from "../extend/errors.js";
import { connectionTools } from "./tools.js";

/**
 * Studio Customization, the third of Studio's own MCP servers (ADR 0049 §3).
 *
 * Where the browser and the computer reach *the machine and the web*, this
 * one reaches *Studio itself*: the connections installed for it, the scopes
 * they are switched on for, what each is doing. Its tools are a relay - they
 * speak the same management routes the settings screens speak, so the
 * harness stays the only authority over what is installed and what the
 * approvals meant, and this process owns no state of its own to lose.
 *
 * Being the third matters more than being third. The MCP path - registry,
 * supervisor, discovery, the update-on-refresh mechanics - now has a real
 * caller whose failure nobody special-cases, and a wedged relay is a process
 * to restart, not the harness.
 *
 * Like the other two, it is discovered, not eager: ADR 0049 §5 leaves nothing
 * over MCP eager, whoever wrote it, so the one cost this capability carries
 * at rest is its purpose sentence in the capability inventory. The relay has
 * no per-conversation state, so there is no session map here; the
 * conversation the call came in with rides only as far as the read's query,
 * because that is what decides whose switch readings come back.
 */
serveStdio({
  info: { name: "studio-customization", version: "1.0.0" },
  definitions: () => connectionTools.map((tool) => tool.definition),
  has: (name) => connectionTools.some((tool) => tool.definition.name === name),
  call: async (name, args, meta) => {
    const conversationId = conversationKey(meta);
    const tool = connectionTools.find((candidate) => candidate.definition.name === name);
    if (tool === undefined) {
      // Gates are dispatched by the definitions the tools themselves declare,
      // so this is a caller that answered the handshake differently; the
      // failure taxonomy carries it like every other refusal in src.
      throw new ExtendError("internal", {
        message: `No connection tool is called ${name}.`,
      });
    }
    return tool.run(conversationId, args);
  },
  // Identity for everything the client cannot yet predict. The one failure
  // worth rewriting is the unreachable endpoint: the words the network gives
  // ("ENOTFOUND", "ECONNREFUSED") say nothing about which side to trust, and
  // the honest answer is that the harness's management interface is what did
  // not answer - usually because the harness is itself mid-restart.
  explain: (message) =>
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|aborted|timed? ?out/i.test(message)
      ? `${message} The harness's management interface did not answer; it is usually restarting. Trying again shortly is the remedy.`
      : message,
  finish: async () => undefined,
});
