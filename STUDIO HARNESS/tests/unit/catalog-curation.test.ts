import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProviderConfigurationError } from "../../src/contracts/models.js";
import { curatedKinds, curationPath, readCuration } from "../../src/gateway/catalog/curation.js";
import { listLibraryProviders } from "../../src/gateway/catalog/index.js";
import { languageCatalogProviders } from "../../src/gateway/language/pi-catalog.js";

/**
 * The curation file is the whole answer to "which vendors does the library
 * offer". Three things are pinned: the shipped file is the curated list the
 * user gave on 2026-09-19 and nothing more; the library obeys it, so a
 * vendor Pi knows but the file disables is not offered; and a malformed or
 * missing file is a configuration error naming the path, never a silent
 * widening to everything.
 */

/** The language vendors curated in on 2026-09-19 (Vercel AI Gateway went the same day). */
const CURATED_LANGUAGE = [
  "anthropic",
  "openai",
  "google",
  "mistral",
  "xai",
  "deepseek",
  "groq",
  "cerebras",
  "together",
  "fireworks",
  "baseten",
  "nvidia",
  "openrouter",
  "cloudflare-workers-ai",
  "github-copilot",
  "opencode",
  "opencode-go",
  "minimax",
  "moonshotai",
  "zai",
];

const CURATED_MEDIA = ["openai", "google", "openrouter", "fal", "elevenlabs", "deepgram", "fish-audio", "minimax", "mistral"];
const CURATED_RETRIEVAL = ["tavily", "brave", "exa", "jina", "firecrawl"];

let scratch: string | undefined;

afterEach(async () => {
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  scratch = undefined;
});

async function fileWith(text: string): Promise<string> {
  scratch = await mkdtemp(join(tmpdir(), "studio-curation-"));
  const path = join(scratch, "providers.json");
  await writeFile(path, text, "utf8");
  return path;
}

describe("the shipped curation", () => {
  it("names exactly the curated vendors per kind", () => {
    const kinds = curatedKinds();
    const of = (kind: "language" | "media" | "retrieval") =>
      [...kinds.entries()].filter(([, set]) => set.has(kind)).map(([id]) => id).sort();
    expect(of("language")).toEqual([...CURATED_LANGUAGE].sort());
    expect(of("media")).toEqual([...CURATED_MEDIA].sort());
    expect(of("retrieval")).toEqual([...CURATED_RETRIEVAL].sort());
  });

  it("lists every language vendor Pi knows, enabled or not, so a toggle is an edit and not an addition", () => {
    const listed = new Set(readCuration().filter((row) => row.kind === "language").map((row) => row.id));
    // The three Pi vendors no plain key can drive are the only ones absent.
    const absent = languageCatalogProviders().filter((id) => !listed.has(id));
    expect(absent).toEqual(["amazon-bedrock", "google-vertex", "openai-codex"]);
  });

  it("lives beside the package, outside the bundle", () => {
    expect(curationPath().replaceAll("\\", "/")).toMatch(/STUDIO HARNESS\/catalog\/providers\.json$/);
  });
});

describe("the library under the curation", () => {
  it("offers the curated vendors and none of the disabled ones", async () => {
    const ids = (await listLibraryProviders()).map((entry) => entry.id);
    for (const id of CURATED_LANGUAGE) expect(ids).toContain(id);
    for (const id of ["ant-ling", "cloudflare-ai-gateway", "azure", "meta", "radius", "typesafe", "huggingface", "kimi-coding", "qwen-token-plan", "xiaomi", "zai-coding-cn", "minimax-cn", "moonshotai-cn"]) {
      expect(ids).not.toContain(id);
    }
  });

  it("narrows a vendor to the kinds it is offered for", async () => {
    const entries = await listLibraryProviders();
    const openai = entries.find((entry) => entry.id === "openai");
    expect(openai?.serves.language).toBe("openai-responses");
    expect(openai?.serves.media).toBe("openai");
    const fal = entries.find((entry) => entry.id === "fal");
    expect(fal?.serves.language).toBeUndefined();
    expect(fal?.serves.media).toBe("fal");
  });

  it("advertises document reading for every vendor with a model that reads one", async () => {
    // The library summarises a vendor's models into slots so a settings page
    // can offer it under Documents. Mistral earns the slot from its declared
    // OCR model, OpenAI and Google from vision models on a wire that carries
    // a file, OpenRouter from its live listing; a slot the summary forgets
    // leaves the vendor unlisted under Documents even though the picker
    // would accept its models.
    const entries = await listLibraryProviders();
    for (const id of ["mistral", "openai", "google", "openrouter"]) {
      const vendor = entries.find((entry) => entry.id === id);
      expect(vendor?.capabilities, id).toContain("documentReading");
    }
    const elevenlabs = entries.find((entry) => entry.id === "elevenlabs");
    expect(elevenlabs?.capabilities).not.toContain("documentReading");
  });
});

describe("a curation file that cannot be trusted", () => {
  it("is a configuration error naming the path, for a missing file", () => {
    const path = join(tmpdir(), "studio-curation-missing", "providers.json");
    expect(() => readCuration(path)).toThrow(ProviderConfigurationError);
    expect(() => readCuration(path)).toThrow(path);
  });

  it("is a configuration error naming the field, for a malformed row", async () => {
    const path = await fileWith(JSON.stringify({ providers: [{ id: "openai", kind: "chat", enabled: true }] }));
    expect(() => readCuration(path)).toThrow(/providers\.0\.kind/);
  });

  it("is a configuration error, for a file that is not JSON", async () => {
    const path = await fileWith("{ providers: [");
    expect(() => readCuration(path)).toThrow(/not valid JSON/);
  });

  it("drops a disabled row and keeps the rest", async () => {
    const path = await fileWith(
      JSON.stringify({
        providers: [
          { id: "openai", kind: "language", enabled: false },
          { id: "openai", kind: "media", enabled: true },
        ],
      }),
    );
    const kinds = curatedKinds(path);
    expect([...(kinds.get("openai") ?? [])]).toEqual(["media"]);
  });
});
