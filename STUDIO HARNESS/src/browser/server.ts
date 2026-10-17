import { conversationKey, isRecord, serveStdio } from "../serve/stdio.js";
import { BrowserError } from "./errors.js";
import { BrowserSession } from "./session.js";
import { definitions, toolByName } from "./tools.js";
import * as v from "valibot";
import { browserInteractionSchema } from "./interaction.js";

/**
 * The browser capability, as an MCP server in its own process.
 *
 * Not in-process tools, though that would have been simpler, and ADR 0049 §3
 * gives both reasons. **The MCP path should be exercised by something real** —
 * the registry, the supervisor, the catalog, discovery and `list_changed` are
 * all mechanisms whose only user would otherwise be a test, and a mechanism
 * nobody trusts is a mechanism nobody maintains. **And a browser is the thing
 * most likely to wedge** — a separate process that hangs is a process to
 * restart, while an in-process hang is the harness.
 *
 * The protocol lives in `serve/stdio.ts`, shared with the computer server.
 * What is here is what is the browser's alone: one session per conversation,
 * and the one error whose library wording would mislead a model.
 *
 * **Nothing here launches a browser.** Connecting, discovering and listing all
 * happen with no Chromium anywhere. The first `tools/call` is what costs
 * something, which is the fourth state in ADR 0049 §4 and the reason the other
 * three are cheap.
 */

/**
 * One browser per conversation, when the caller says which conversation.
 *
 * MCP carries no conversation identity of its own — a tool call is a name and
 * some arguments — so Studio's own client sends one in `_meta`, and it does
 * that only for servers it wrote itself. A caller that sends nothing shares
 * one session, which is what any other MCP client gets and is the honest
 * fallback rather than a pretence of isolation.
 *
 * The point of the split is that one conversation's pages must not appear in
 * another's: a signed-in session, a half-filled form, a tab left on an
 * internal page are all things the next conversation has no business seeing.
 */
const sessions = new Map<string, BrowserSession>();

function sessionFor(meta: unknown): BrowserSession {
  const key = conversationKey(meta);
  const existing = sessions.get(key);
  if (existing !== undefined) return existing;
  const created = new BrowserSession(key);
  sessions.set(key, created);
  return created;
}

/**
 * Says what actually went wrong, where the library's own words would mislead.
 *
 * A reference that is not on the page produces a ten-second timeout and a call
 * log about a selector the model never wrote, which reads as "the page is
 * slow" — and a model told a page is slow waits and tries again, forever. The
 * true story is almost always that the page navigated since it was read, and
 * the fix is to read it again, so that is what the sentence says.
 *
 * Only failures whose real cause is knowable are rewritten. Everything else is
 * passed through exactly as it came, because inventing an explanation for an
 * error we do not understand is worse than showing the error.
 */
function explain(message: string): string {
  const stale = /data-studio-ref="(\d+)"/.exec(message);
  if (stale !== null && message.includes("Timeout")) {
    return (
      `There is no ref_${stale[1] as string} on this page any more. ` +
      "References come from reading a page and stop meaning anything once it navigates. " +
      "Read the page again and use a reference from that reading."
    );
  }
  return message;
}

serveStdio({
  info: { name: "studio-browser", version: "1.0.0" },
  definitions,
  has: (name) => toolByName(name) !== undefined,
  call: async (name, args, meta) => {
    const tool = toolByName(name);
    // Unreachable through `serveStdio`, which asks `has` first; kept as a
    // typed refusal so the taxonomy holds even for the impossible branch.
    if (tool === undefined) throw new BrowserError("bad_input", { message: `There is no tool called "${name}".` });
    const session = sessionFor(meta);
    const humanStop = name === "studio_browser_quit" && isRecord(meta) && meta["studio/human-stop"] === true;
    return session.live.agent(() => tool.run(session, args), humanStop);
  },
  control: async (_method, params) => {
    const parsed = v.safeParse(browserInteractionSchema, params["input"]);
    if (!parsed.success) throw new BrowserError("bad_input", { message: "The browser interaction is invalid." });
    const session = sessions.get(conversationKey(params["_meta"]));
    if (session === undefined) throw new BrowserError("no_tab", { message: "This browser session has ended. Ask Studio to open a page again." });
    try {
      return await session.live.interact(parsed.output);
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      // Library errors can echo an address or text the person entered. The
      // private input path must never turn those into diagnostic content.
      throw new BrowserError("internal", { message: "The browser interaction failed. Reconnect before continuing." });
    }
  },
  explain,
  // A browser with nobody to answer to is 300 megabytes doing nothing.
  // Closing before exiting is what keeps a Chromium out of the person's task
  // manager after Studio quits.
  finish: async () => {
    await Promise.all([...sessions.values()].map((session) => session.close()));
  },
});
