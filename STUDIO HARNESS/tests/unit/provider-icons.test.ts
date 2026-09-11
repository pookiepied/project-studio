import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { IconCache } from "../../src/gateway/catalog/icons/cache.js";
import { ProviderIconCatalog, cacheFor } from "../../src/gateway/catalog/icons/catalog.js";
import type { Fetcher } from "../../src/gateway/catalog/icons/source.js";
import { createModelsDevSource } from "../../src/gateway/catalog/icons/sources/models-dev.js";
import { createLobehubSource } from "../../src/gateway/catalog/icons/sources/lobehub.js";

/**
 * The icon catalog and its two sources, against a stubbed network.
 *
 * What matters here is the behaviour a naive implementation gets wrong.
 * models.dev answers 200 with a placeholder body for ids it has never heard
 * of, so an unknown vendor has to be detected from the body rather than the
 * status. The two sources cover different populations, so the catalog has to
 * fall through rather than stop at the first. A lookup must not re-download
 * what is already on disk, and a network failure must not be remembered as
 * "no icon" or an offline session would never heal.
 */

const PLACEHOLDER = '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>';
const ANTHROPIC_MD = '<svg viewBox="0 0 24 24"><path d="M3 3h18v18H3z"/></svg>';
const CLAUDE_LOBE = '<svg viewBox="0 0 24 24"><path d="M12 2 2 22h20Z"/></svg>';
const QWEN_LOBE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>';
const PROBE = "studio-placeholder-probe";

interface StubOptions {
  /** Provider ids models.dev names in its manifest. */
  readonly modelsDev?: readonly string[];
  /** Ids models.dev serves a real body for. */
  readonly modelsDevBodies?: Readonly<Record<string, string>>;
  /** Ids lobehub serves. Everything else 404s, as jsDelivr really does. */
  readonly lobehub?: Readonly<Record<string, string>>;
  readonly offline?: boolean;
}

function createStub(options: StubOptions = {}) {
  const calls: string[] = [];
  let offline = options.offline ?? false;
  const fetcher: Fetcher = async (request) => {
    if (offline) throw new Error("offline");
    calls.push(request.url);

    if (request.url.includes("cdn.jsdelivr.net")) {
      const name = request.url.split("/").pop()?.replace(/\.svg$/, "") ?? "";
      const body = options.lobehub?.[name];
      return body === undefined
        ? { status: 404, headers: { "content-type": "text/plain" }, body: "not found" }
        : { status: 200, headers: { "content-type": "image/svg+xml" }, body };
    }

    if (request.url.endsWith("api.json")) {
      const map = Object.fromEntries((options.modelsDev ?? []).map((id) => [id, { id }]));
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(map),
      };
    }

    const name = request.url.split("/").pop()?.replace(/\.svg$/, "") ?? "";
    if (name === PROBE) {
      return { status: 200, headers: { "content-type": "image/svg+xml" }, body: PLACEHOLDER };
    }
    const body = options.modelsDevBodies?.[name] ?? PLACEHOLDER;
    return { status: 200, headers: { "content-type": "image/svg+xml" }, body };
  };
  return { calls, fetcher, goOnline: () => (offline = false) };
}

function build(stub: { fetcher: Fetcher }, cacheDir: string, now: () => number = Date.now) {
  const root = new IconCache(cacheDir);
  return new ProviderIconCatalog([
    createModelsDevSource({
      cache: cacheFor(root, "models-dev"),
      fetcher: stub.fetcher,
      now,
      ttlMs: 24 * 60 * 60 * 1000,
    }),
    createLobehubSource({ cache: cacheFor(root, "lobehub"), fetcher: stub.fetcher }),
  ]);
}

const temp = () => mkdtempSync(join(tmpdir(), "icons-"));

describe("the provider icon catalog", () => {
  it("takes the first source's answer and caches it on disk", async () => {
    const dir = temp();
    const stub = createStub({
      modelsDev: ["anthropic"],
      modelsDevBodies: { anthropic: ANTHROPIC_MD },
      lobehub: { claude: CLAUDE_LOBE },
    });
    const catalog = build(stub, dir);

    // Both sources have Anthropic. models.dev is first, so its mark is the one
    // drawn -- the column stays on one grid rather than mixing two styles.
    expect(await catalog.get("anthropic")).toBe(ANTHROPIC_MD);
    expect(catalog.whichSource("anthropic")).toBe("models-dev");
    expect(existsSync(join(dir, "models-dev", "anthropic.svg"))).toBe(true);
  });

  it("falls through to the second source for an author the first has never heard of", async () => {
    const dir = temp();
    // `qwen` is a model author, not a provider. models.dev names it nowhere
    // and answers the placeholder; lobehub has it. This fall-through is the
    // whole reason there are two sources.
    const stub = createStub({ modelsDev: ["anthropic"], lobehub: { qwen: QWEN_LOBE } });
    const catalog = build(stub, dir);

    expect(await catalog.get("qwen")).toBe(QWEN_LOBE);
    expect(catalog.whichSource("qwen")).toBe("lobehub");
  });

  it("maps a vendor onto whatever each source happens to call it", async () => {
    const dir = temp();
    // lobehub files Anthropic's mark under the product name.
    const stub = createStub({ modelsDev: [], lobehub: { claude: CLAUDE_LOBE, grok: QWEN_LOBE } });
    const catalog = build(stub, dir);

    expect(await catalog.get("anthropic")).toBe(CLAUDE_LOBE);
    expect(await catalog.get("x-ai")).toBe(QWEN_LOBE);
    // OpenRouter's routing-variant prefix is not part of a vendor's identity.
    expect(await catalog.get("~anthropic")).toBe(CLAUDE_LOBE);
  });

  it("sees through the placeholder models.dev serves with a 200", async () => {
    const dir = temp();
    // `tavily` is in the manifest but its logo is still the generic body.
    const stub = createStub({ modelsDev: ["tavily"] });
    const catalog = build(stub, dir);

    expect(await catalog.get("tavily")).toBeUndefined();
    expect(await catalog.get("vendor-nobody-knows")).toBeUndefined();
    expect(existsSync(join(dir, "models-dev", "tavily.svg"))).toBe(false);
  });

  it("asks each source once for a vendor nobody has", async () => {
    const dir = temp();
    const stub = createStub({ modelsDev: [] });
    const catalog = build(stub, dir);

    await catalog.get("thedrummer");
    const before = stub.calls.length;
    await catalog.get("thedrummer");
    await catalog.get("thedrummer");

    // A third of OpenRouter's authors have no logo anywhere. Without the
    // negative cache each of those rows would re-ask both sources forever.
    expect(stub.calls.length).toBe(before);
  });

  it("shares one request between callers asking at the same moment", async () => {
    const dir = temp();
    const stub = createStub({ modelsDev: ["anthropic"], modelsDevBodies: { anthropic: ANTHROPIC_MD } });
    const catalog = build(stub, dir);

    const [a, b, c] = await Promise.all([
      catalog.get("anthropic"),
      catalog.get("anthropic"),
      catalog.get("anthropic"),
    ]);
    expect([a, b, c]).toEqual([ANTHROPIC_MD, ANTHROPIC_MD, ANTHROPIC_MD]);
    expect(stub.calls.filter((url) => url.endsWith("/anthropic.svg")).length).toBe(1);
  });

  it("serves a second process from disk without going back to the network", async () => {
    const dir = temp();
    const stub = createStub({ modelsDev: ["anthropic"], modelsDevBodies: { anthropic: ANTHROPIC_MD } });
    await build(stub, dir).get("anthropic");
    const after = stub.calls.length;

    expect(await build(stub, dir).get("anthropic")).toBe(ANTHROPIC_MD);
    expect(stub.calls.length).toBe(after);

    const manifest = JSON.parse(
      readFileSync(join(dir, "models-dev", "manifest.json"), "utf8"),
    ) as { placeholderHash: string; providers: readonly string[] };
    expect(manifest.providers).toContain("anthropic");
    expect(manifest.placeholderHash).toBe(createHash("sha256").update(PLACEHOLDER).digest("hex"));
  });

  it("does not remember a network failure as 'no icon'", async () => {
    const dir = temp();
    let clock = 1_000_000;
    const stub = createStub({
      modelsDev: ["anthropic"],
      modelsDevBodies: { anthropic: ANTHROPIC_MD },
      offline: true,
    });
    const catalog = build(stub, dir, () => clock);

    expect(await catalog.get("anthropic")).toBeUndefined();

    // Past the failed-manifest retry window, and back online. An offline
    // session heals on its own rather than needing a restart.
    clock += 61_000;
    stub.goOnline();
    expect(await catalog.get("anthropic")).toBe(ANTHROPIC_MD);
  });

  it("refuses an id that could escape its own cache directory", async () => {
    const dir = temp();
    const stub = createStub({ modelsDev: [] });
    const catalog = build(stub, dir);

    // An id is also a filename. These never reach a fetch, let alone a write.
    for (const bad of ["../../etc/passwd", "a/b", "", "  ", "-leading"]) {
      expect(await catalog.get(bad)).toBeUndefined();
    }
    expect(stub.calls.length).toBe(0);
  });
});
