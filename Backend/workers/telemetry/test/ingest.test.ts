import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";

/**
 * The write path, which is this worker's whole job. Two properties matter more
 * than the rest: a caller cannot report as a source it does not hold the key
 * for, and a row that is accepted actually gets written rather than silently
 * dropped for being over a limit nobody sees.
 */

interface Point {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

let written: Point[];

function envWith(keys: Record<string, string>) {
  written = [];
  return {
    EVENTS: {
      writeDataPoint: (p: Point) => written.push(p),
    },
    INGEST_KEYS: JSON.stringify(keys),
  } as unknown as Parameters<typeof worker.fetch>[1];
}

const KEYS = { studio: "k-studio-0123456789abcdef", site: "k-site-0123456789abcdef" };

const send = (body: unknown, auth?: string, headers: Record<string, string> = {}) =>
  new Request("https://telemetry.x.dev/v1/events", {
    method: "POST",
    headers: { ...(auth ? { authorization: auth } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

let env: ReturnType<typeof envWith>;
beforeEach(() => {
  env = envWith(KEYS);
});

describe("only a holder of a write key may report", () => {
  const refused: [string, string | undefined][] = [
    ["no authorization header", undefined],
    ["an empty bearer", "Bearer "],
    ["a wrong key", "Bearer not-a-key"],
    ["a key from no source", "Bearer k-studio-0123456789abcde"],
    ["basic auth", "Basic a2V5"],
    ["a bare key with no scheme", KEYS.studio],
  ];

  for (const [name, auth] of refused) {
    it(`refuses ${name}`, async () => {
      const res = await worker.fetch(send({ evt: "x" }, auth), env);
      expect(res.status).toBe(401);
      expect(written).toHaveLength(0);
    });
  }

  it("accepts a valid key", async () => {
    const res = await worker.fetch(send({ evt: "x" }, `Bearer ${KEYS.studio}`), env);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ accepted: 1 });
  });

  it("refuses everything when the key map is malformed", async () => {
    const broken = { ...envWith(KEYS), INGEST_KEYS: "{not json" } as typeof env;
    const res = await worker.fetch(send({ evt: "x" }, `Bearer ${KEYS.studio}`), broken);
    expect(res.status).toBe(401);
  });
});

describe("a source cannot report as another source", () => {
  it("takes the source from the key, ignoring what the body claims", async () => {
    await worker.fetch(
      send({ evt: "login", source: "site", index1: "site" }, `Bearer ${KEYS.studio}`),
      env,
    );
    expect(written[0]?.indexes).toEqual(["studio"]);
  });

  it("labels each key with its own source", async () => {
    await worker.fetch(send({ evt: "x" }, `Bearer ${KEYS.site}`), env);
    expect(written[0]?.indexes).toEqual(["site"]);
  });
});

describe("what is accepted", () => {
  it("takes a batch and counts what it kept", async () => {
    const res = await worker.fetch(
      send([{ evt: "a" }, { evt: "b" }, { evt: "c" }], `Bearer ${KEYS.studio}`),
      env,
    );
    await expect(res.json()).resolves.toEqual({ accepted: 3 });
    expect(written).toHaveLength(3);
  });

  it("skips items with no event name rather than failing the batch", async () => {
    const res = await worker.fetch(
      send([{ evt: "a" }, { nope: 1 }, null, { evt: "b" }], `Bearer ${KEYS.studio}`),
      env,
    );
    await expect(res.json()).resolves.toEqual({ accepted: 2 });
  });

  it("refuses a batch that is too long", async () => {
    const big = Array.from({ length: 101 }, (_, i) => ({ evt: `e${i}` }));
    const res = await worker.fetch(send(big, `Bearer ${KEYS.studio}`), env);
    expect(res.status).toBe(400);
  });

  it("refuses invalid JSON", async () => {
    const res = await worker.fetch(send("{not json", `Bearer ${KEYS.studio}`), env);
    expect(res.status).toBe(400);
  });

  it("refuses an oversized body on its declared length, before reading it", async () => {
    const res = await worker.fetch(
      send({ evt: "x" }, `Bearer ${KEYS.studio}`, { "content-length": String(1024 * 1024) }),
      env,
    );
    expect(res.status).toBe(413);
  });

  it("refuses an oversized body that lied about its length", async () => {
    const huge = JSON.stringify({ evt: "x", pad: "a".repeat(70_000) });
    const res = await worker.fetch(send(huge, `Bearer ${KEYS.studio}`), env);
    expect(res.status).toBe(413);
  });

  it("only answers POST /v1/events", async () => {
    const res = await worker.fetch(
      new Request("https://telemetry.x.dev/v1/other", {
        method: "POST",
        headers: { authorization: `Bearer ${KEYS.studio}` },
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it("serves an unauthenticated health check", async () => {
    const res = await worker.fetch(new Request("https://telemetry.x.dev/health"), env);
    expect(res.status).toBe(200);
  });
});

describe("a point that is accepted is a point that fits", () => {
  const totalBlobBytes = (p: Point) =>
    p.blobs.reduce((n, b) => n + new TextEncoder().encode(b).length, 0);

  it("keeps the blobs within the budget when the fields bag is huge", async () => {
    await worker.fetch(
      send({ evt: "big", path: "/x", note: "a".repeat(20_000) }, `Bearer ${KEYS.studio}`),
      env,
    );
    expect(totalBlobBytes(written[0]!)).toBeLessThanOrEqual(5000);
  });

  it("counts the truncation instead of losing it silently", async () => {
    await worker.fetch(
      send({ evt: "big", note: "a".repeat(20_000) }, `Bearer ${KEYS.studio}`),
      env,
    );
    expect(written[1]?.blobs[0]).toBe("fields_truncated");
  });

  it("budgets a long path against the fields, not separately", async () => {
    await worker.fetch(
      send(
        { evt: "e", path: "/".padEnd(4_000, "p"), note: "b".repeat(4_000) },
        `Bearer ${KEYS.studio}`,
      ),
      env,
    );
    expect(totalBlobBytes(written[0]!)).toBeLessThanOrEqual(5000);
  });

  it("leaves a small point untouched and writes no truncation row", async () => {
    await worker.fetch(send({ evt: "small", ok: true }, `Bearer ${KEYS.studio}`), env);
    expect(written).toHaveLength(1);
    expect(written[0]?.blobs[3]).toBe(JSON.stringify({ ok: true }));
  });

  it("counts multi-byte characters by their bytes, not their length", async () => {
    await worker.fetch(
      send({ evt: "e", note: "🙂".repeat(2_000) }, `Bearer ${KEYS.studio}`),
      env,
    );
    expect(totalBlobBytes(written[0]!)).toBeLessThanOrEqual(5000);
  });
});
