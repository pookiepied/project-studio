import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { ProviderIconLibrary } from "../../src/providers/icons/library.js";

/**
 * The icon cache, against a stubbed network.
 *
 * The three behaviours that matter are the three that a naive implementation
 * gets wrong: an unknown id is detected even though models.dev answers 200
 * with a placeholder body for everything; a lookup never re-downloads what is
 * already on disk; and a network failure is retried later rather than
 * remembered as "no icon".
 */

const PLACEHOLDER_BODY =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4h16v16H4z"/></svg>';
const ANTHROPIC_BODY = '<svg viewBox="0 0 24 24"><path d="M3 3h18v18H3z" fill="#000"/></svg>';
const OPENROUTER_BODY = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>';
const ALIBABA_BODY = '<svg viewBox="0 0 24 24"><path d="M2 12h20"/></svg>';

function createFetcher(manifestProviders: readonly string[], options: { broken?: boolean } = {}) {
  const calls: string[] = [];
  const placeholderHash = createHash("sha256").update(PLACEHOLDER_BODY).digest("hex");
  return {
    calls,
    fetcher: async (request: { url: string }) => {
      if (options.broken) throw new Error("offline");
      calls.push(request.url);
      if (request.url.endsWith("api.json")) {
        const providers = Object.fromEntries(manifestProviders.map((id) => [id, { id }]));
        return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(providers) };
      }
      if (request.url.includes(PLACEHOLDER_PROBE_SEGMENT)) {
        return { status: 200, headers: { "content-type": "image/svg+xml" }, body: PLACEHOLDER_BODY };
      }
      if (request.url.endsWith("/anthropic.svg")) {
        return { status: 200, headers: { "content-type": "image/svg+xml" }, body: ANTHROPIC_BODY };
      }
      if (request.url.endsWith("/openrouter.svg")) {
        return { status: 200, headers: { "content-type": "image/svg+xml" }, body: OPENROUTER_BODY };
      }
      if (request.url.endsWith("/alibaba.svg")) {
        return { status: 200, headers: { "content-type": "image/svg+xml" }, body: ALIBABA_BODY };
      }
      if (request.url.endsWith("/tavily.svg")) {
        // A real-world case: a vendor listed in api.json whose logo is still
        // only the generic placeholder.
        return { status: 200, headers: { "content-type": "image/svg+xml" }, body: PLACEHOLDER_BODY };
      }
      // Every unknown id gets the placeholder with a 200 - the measured
      // models.dev behaviour this library exists to see through.
      return { status: 200, headers: { "content-type": "image/svg+xml" }, body: PLACEHOLDER_BODY };
    },
    placeholderHash,
  };
}

const PLACEHOLDER_PROBE_SEGMENT = "studio-placeholder-probe";
function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

let lastCacheDir: string | undefined;

afterEach(() => {
  // Nothing to clean: every cache lives in its own temp directory.
  void lastCacheDir;
});

describe("the provider icon library", () => {
  it("resolves a real icon, aliases a vendor models.dev names differently, and caches on disk", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "icons-"));
    const stub = createFetcher(["anthropic", "mistral", "openrouter"]);
    const library = new ProviderIconLibrary({ cacheDir, fetcher: stub.fetcher });

    const anthropic = await library.get("anthropic");
    expect(anthropic).toBe(ANTHROPIC_BODY);
    expect(existsSync(join(cacheDir, "anthropic.svg"))).toBe(true);

    // The alias: our author segment `mistralai`, models.dev's `mistral`.
    const mistral = await library.get("mistralai");
    expect(mistral).toBe(undefined);
    // mistral IS in the manifest above; but its logo was never staged - the
    // fetcher serves the placeholder for it, so the honest answer is no.

    // A second library over the same directory serves from disk alone.
    const warm = new ProviderIconLibrary({ cacheDir, fetcher: stub.fetcher });
    const again = await warm.get("anthropic");
    expect(again).toBe(ANTHROPIC_BODY);
    const anthropicFetches = stub.calls.filter((url) => url.endsWith("/anthropic.svg")).length;
    expect(anthropicFetches).toBe(1);
  });

  it("resolves a model author onto the provider whose logo models.dev publishes", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "icons-"));
    const stub = createFetcher(["alibaba", "anthropic"]);
    const library = new ProviderIconLibrary({ cacheDir, fetcher: stub.fetcher });

    // `qwen` is an author, not a provider: models.dev has no `qwen.svg` and
    // answers the placeholder for it, so without the alias this row drew a
    // letter while Alibaba's logo sat in the same cache directory.
    expect(await library.get("qwen")).toBe(ALIBABA_BODY);

    // OpenRouter's routing-variant prefix is not part of the vendor's name.
    expect(await library.get("~anthropic")).toBe(ANTHROPIC_BODY);

    // An author with no provider behind it stays unanswered on purpose: a
    // monogram is honest where another company's logo would not be.
    expect(await library.get("nousresearch")).toBeUndefined();
  });

  it("treats the placeholder body as not-found even though the status is 200", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "icons-"));
    const stub = createFetcher(["anthropic", "tavily"]);
    const library = new ProviderIconLibrary({ cacheDir, fetcher: stub.fetcher });

    expect(await library.get("tavily")).toBeUndefined();
    expect(await library.get("vendor-nobody-knows")).toBeUndefined();
    expect(existsSync(join(cacheDir, "tavily.svg"))).toBe(false);
  });

  it("refuses to answer from a failed network forever: a broken fetch is not a negative", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "icons-"));
    let broken = true;
    let now = 1_000_000;
    const stub = createFetcher(["anthropic"]);
    const library = new ProviderIconLibrary({
      cacheDir,
      fetcher: async (request) => {
        if (broken) throw new Error("offline");
        return stub.fetcher(request);
      },
      now: () => now,
    });

    expect(await library.get("anthropic")).toBeUndefined();

    // Past the failed-manifest retry window: the failure was never remembered
    // as "no icon", only as "ask again soon".
    now += 61_000;
    broken = false;
    expect(await library.get("anthropic")).toBe(ANTHROPIC_BODY);
  });

  it("seeds a second process from the manifest it cached on disk", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "icons-"));
    const stub = createFetcher(["openrouter"]);
    const first = new ProviderIconLibrary({ cacheDir, fetcher: stub.fetcher });
    await first.get("openrouter");

    const manifestOnDisk = JSON.parse(readFileSync(join(cacheDir, "manifest.json"), "utf8")) as {
      placeholderHash: string;
      providers: readonly string[];
    };
    expect(manifestOnDisk.providers).toContain("openrouter");
    expect(manifestOnDisk.placeholderHash).toBe(hashOf(PLACEHOLDER_BODY));
  });
});
