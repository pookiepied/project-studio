import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeContext, Type } from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";
import { tracePrompt } from "../../src/gateway/language/prompt-trace.js";

afterEach(() => vi.unstubAllEnvs());

it("traces the current prompt and tools from Pi's transcript without recording their contents", async () => {
  const home = await mkdtemp(join(tmpdir(), "studio-prompt-trace-"));
  vi.stubEnv("PROJECT_STUDIO_HOME", home);
  vi.stubEnv("STUDIO_PROMPT_TRACE", "1");
  try {
    const context = normalizeContext({
      systemPrompt: "private prompt content",
      tools: [{ name: "read", description: "private tool description", parameters: Type.Object({}) }],
      messages: [
        { role: "system", content: "later private instruction", timestamp: 1, toolsRemoved: [{ name: "read" }], toolsAdded: [{ name: "glob", description: "private replacement description", parameters: Type.Object({}) }] },
        { role: "user", content: "private message content", timestamp: 2 },
      ],
    });
    tracePrompt("test/default", context);
    const line = await readFile(join(home, "logs", "prompt-trace.jsonl"), "utf8");
    const record: unknown = JSON.parse(line);
    expect(record).toMatchObject({
      tools: { count: 1, each: [{ name: "glob" }] },
      messages: { count: 1, each: [{ role: "user" }] },
    });
    expect(record).toHaveProperty("system.chars", "private prompt content\n\nlater private instruction".length);
    expect(line).not.toContain("private");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
