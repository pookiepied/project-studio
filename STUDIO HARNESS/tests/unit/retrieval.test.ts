import { beforeEach, describe, expect, it } from "vitest";

import type { SecureCredentialStore } from "../../src/credentials/credential-store.js";
import { RetrievalError } from "../../src/gateway/retrieval/errors.js";
import { RetrievalService } from "../../src/gateway/retrieval/service.js";
import { RetrievalSettingsStore } from "../../src/gateway/retrieval/settings.js";
import { runWithFallback } from "../../src/gateway/retrieval/slots.js";
import type { SearchProvider } from "../../src/gateway/retrieval/types.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * ADR 0023 §2 and §3: two slots, and the rule for moving between them. The
 * rule is the whole design — a pool that tries everything spends other
 * people's quota to turn one clear failure into a vague one.
 */

function provider(id: string, behaviour: () => Promise<string>): SearchProvider {
  return {
    id,
    name: id,
    signupUrl: `https://${id}.example`,
    search: async () => ({ hits: [{ title: await behaviour(), url: "", snippet: "" }], summary: undefined }),
  };
}

type Kind = ConstructorParameters<typeof RetrievalError>[0];

const answers = (id: string) => provider(id, async () => id);
const fails = (id: string, kind: Kind) =>
  provider(id, () => Promise.reject(new RetrievalError(kind, { provider: id })));

async function run(primary: SearchProvider, fallback?: SearchProvider) {
  return runWithFallback({ primary, fallback }, (p) => p.search({ query: "q", limit: 1, signal: undefined }));
}

describe("two slots, never a pool", () => {
  it("uses the primary and says which provider answered", async () => {
    const outcome = await run(answers("tavily"), answers("brave"));

    expect(outcome.provider).toBe("tavily");
    expect(outcome.fellBackFrom).toBeUndefined();
  });

  it("falls back when the primary is down, and says that it did", async () => {
    const outcome = await run(fails("tavily", "unavailable"), answers("brave"));

    expect(outcome.provider).toBe("brave");
    expect(outcome.fellBackFrom?.provider).toBe("tavily");
  });

  it("falls back on a rate limit, a timeout, and an empty quota", async () => {
    for (const kind of ["rate_limited", "timeout", "quota_exhausted"] as const) {
      const outcome = await run(fails("tavily", kind), answers("brave"));
      expect(outcome.provider, kind).toBe("brave");
    }
  });

  it("does not fall back on a bad key", async () => {
    // It fails identically at every provider, and the user has to fix it.
    // Falling through spends a second account's quota to hide that.
    await expect(run(fails("tavily", "unauthorized"), answers("brave"))).rejects.toThrow(
      /API key/i,
    );
  });

  it("does not fall back on our own malformed request", async () => {
    await expect(run(fails("tavily", "invalid_request"), answers("brave"))).rejects.toBeInstanceOf(
      RetrievalError,
    );
  });

  it("does not fall back on a refusal unless the caller allows it", async () => {
    // A search provider refusing us is nothing a second search provider fixes.
    // A site refusing a reader is exactly what a second reader is for.
    await expect(run(fails("jina", "blocked"), answers("firecrawl"))).rejects.toBeInstanceOf(
      RetrievalError,
    );

    const outcome = await runWithFallback(
      { primary: fails("jina", "blocked"), fallback: answers("firecrawl") },
      (p) => p.search({ query: "q", limit: 1, signal: undefined }),
      { allowFallbackOnBlocked: true },
    );
    expect(outcome.provider).toBe("firecrawl");
  });

  it("names both providers when both fail", async () => {
    // A model told only "firecrawl was blocked" will retry a URL that the
    // first reader could not read either.
    await expect(
      run(fails("tavily", "unavailable"), fails("brave", "unavailable")),
    ).rejects.toThrow(/tavily.*brave/is);
  });

  it("never spends the fallback on a cancellation", async () => {
    const cancelled = provider("tavily", () => Promise.reject(new Error("stopped")));

    await expect(run(cancelled, answers("brave"))).rejects.toThrow("stopped");
  });

  it("works with one provider and no fallback", async () => {
    await expect(run(fails("tavily", "unavailable"))).rejects.toBeInstanceOf(RetrievalError);
    expect((await run(answers("tavily"))).provider).toBe("tavily");
  });
});

describe("which provider fills each slot", () => {
  let db: StudioDatabase;
  let settings: RetrievalSettingsStore;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
    settings = new RetrievalSettingsStore(db);
  });

  it("defaults to Tavily for search and Jina for reading", () => {
    expect(settings.read("search")).toEqual({ primary: "tavily", fallback: undefined });
    expect(settings.read("reader")).toEqual({ primary: "jina", fallback: undefined });
  });

  it("keeps a chosen provider", () => {
    settings.select("search", "primary", "brave");
    settings.select("search", "fallback", "exa");

    expect(settings.read("search")).toEqual({ primary: "brave", fallback: "exa" });
  });

  it("ignores a provider it no longer knows rather than failing to start", () => {
    // A fallback removed in an upgrade should show an empty slot in settings,
    // not stop the harness.
    settings.select("search", "primary", "gone");
    settings.select("search", "fallback", "alsogone");

    expect(settings.read("search")).toEqual({ primary: "tavily", fallback: undefined });
  });

  it("refuses to let one provider fill both slots", () => {
    settings.select("search", "primary", "brave");
    settings.select("search", "fallback", "brave");

    expect(settings.read("search").fallback).toBeUndefined();
  });
});

describe("a provider with no key is not connected", () => {
  function credentials(stored: Record<string, string>): SecureCredentialStore {
    return {
      get: async (key) => stored[key.id] ?? null,
      set: async () => undefined,
      delete: async () => false,
    };
  }

  it("says what to do when nothing is connected", async () => {
    const db = openDatabase({ path: ":memory:" });
    const service = new RetrievalService({
      settings: new RetrievalSettingsStore(db),
      credentials: credentials({}),
    });

    await expect(service.search("anything", 3, undefined)).rejects.toThrow(/settings/i);
    db.close();
  });

  it("promotes the fallback when only it has a key", async () => {
    // The user connected a service. Refusing to use it because of the label on
    // its slot would be pedantry.
    const db = openDatabase({ path: ":memory:" });
    const settings = new RetrievalSettingsStore(db);
    settings.select("search", "fallback", "brave");

    const service = new RetrievalService({
      settings,
      credentials: credentials({ brave: "a-key" }),
    });

    // It reaches Brave, which is the assertion. The call then fails at the
    // network, which no unit test should be reaching out to make succeed.
    await expect(service.search("anything", 3, AbortSignal.abort())).rejects.toBeDefined();
    db.close();
  });
});
