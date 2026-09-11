import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { falListing } from "../../src/gateway/catalog/fal-media.js";
import {
  initializeObservability,
  shutdownObservability,
} from "../../src/observability/index.js";

/**
 * FAL's live listing, against a stand-in that speaks its documented shape on
 * a real loopback socket: a paged catalogue carrying a cursor, the vendor's
 * own category word on each model, and the credential riding FAL's `Key`
 * scheme in the outbound header alone. The listing's host is the vendor's
 * (api.fal.ai; the connection's queue base lists nothing), so the test's
 * fetch - the contract's own transport seam - maps the vendor's URLs onto
 * the stand-in, and the wire asserts here are the vendor's.
 */

interface SeenPage {
  readonly url: string;
  readonly authorization: string | undefined;
}

function listed(
  id: string,
  displayName: string,
  category: string,
): Record<string, unknown> {
  return { endpoint_id: id, metadata: { display_name: displayName, category } };
}

let standIn: Server;
let port = 0;
let seen: SeenPage[];
/** What each page answers, keyed by the query exactly as the vendor spells it. */
let pages: ReadonlyMap<string, string>;
/** The structured log lines the harness wrote while the read ran. */
let written: string[];

beforeEach(async () => {
  seen = [];
  pages = new Map();
  written = [];
  initializeObservability({ exporter: "memory", deploymentEnvironment: "test" });
  // The listing's dropped count lands in a structured log line; capturing it
  // means the test asserts a fact of ours the way the boot log test does.
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  };
  processStash = original;
  standIn = createServer((request, response) => {
    const answer = pages.get(request.url ?? "");
    if (answer === undefined) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ detail: "no such page staged" }));
      return;
    }
    // The injected seam is what records the call - it sees the vendor's own
    // spelling of the URL, which is what the wire assertions are about.
    response.writeHead(200, { "content-type": "application/json" });
    response.end(answer);
  });
  await new Promise<void>((resolve) => standIn.listen(0, "127.0.0.1", resolve));
  port = (standIn.address() as AddressInfo).port;
});

let processStash: typeof process.stdout.write;

afterEach(async () => {
  falListing.forget();
  standIn.closeAllConnections();
  standIn.close();
  process.stdout.write = processStash;
  await shutdownObservability();
});

/**
 * The contract's own transport seam, pointed at the loopback. The vendor's
 * URLs are what the read spells; only where they are answered moves.
 */
function falFetchWith(_key: string | undefined) {
  return (url: string, headers: Record<string, string>): Promise<string> => {
    seen.push({ url, authorization: headers.authorization });
    return fetch(url.replace("https://api.fal.ai", `http://127.0.0.1:${String(port)}`), {
      headers,
    }).then((answered) => answered.text());
  };
}

describe("FAL's live listing", () => {
  it("pages by the vendor's cursor, classifies what a slot answers, and counts the rest", async () => {
    // Three pages: two of categories a slot answers (one of each), and the
    // dropped ones spread across both - a lister that stops at page one
    // would call the second page's drops invisible.
    pages = new Map([
      [
        "/v1/models?limit=500",
        JSON.stringify({
          models: [
            listed("fal-ai/flux-2-pro", "FLUX.2 Pro", "text-to-image"),
            listed("fal-ai/nano-banana-2/edit", "Nano Banana 2 (edit)", "image-to-image"),
            listed("vendor/upscale-1", "Upscaler", "upscale"),
          ],
          has_more: true,
          next_cursor: "Mg",
        }),
      ],
      [
        "/v1/models?limit=500&cursor=Mg",
        JSON.stringify({
          models: [
            listed("alibaba/wan-3.0/text-to-video", "Wan 3.0", "text-to-video"),
            listed("fal-ai/wan-3.0/i2v", "Wan 3.0 (image)", "image-to-video"),
            listed("vendor/upscale-2", "Upscaler 2", "image-to-3d"),
          ],
          has_more: true,
          next_cursor: "Mg2",
        }),
      ],
      [
        "/v1/models?limit=500&cursor=Mg2",
        JSON.stringify({
          models: [
            listed("fal-ai/tts-1", "FAL TTS", "text-to-speech"),
            listed("vendor/transcribe", "FAL STT", "speech-to-text"),
          ],
          has_more: false,
        }),
      ],
    ]);

    const models = await falListing.models("https://queue.fal.run", "the-fal-key", {
      fetch: falFetchWith("the-fal-key"),
    });

    expect(seen.map((call) => call.url)).toEqual([
      "https://api.fal.ai/v1/models?limit=500",
      "https://api.fal.ai/v1/models?limit=500&cursor=Mg",
      "https://api.fal.ai/v1/models?limit=500&cursor=Mg2",
    ]);

    const byId = new Map(models.map((model) => [model.modelId, model]));
    expect(byId.get("fal-ai/flux-2-pro")?.capability.imageGeneration).toBe("supported");
    expect(byId.get("fal-ai/nano-banana-2/edit")?.capability.imageEditing).toBe("supported");
    expect(byId.get("fal-ai/nano-banana-2/edit")?.capability.vision).toBe("supported");
    expect(byId.get("alibaba/wan-3.0/text-to-video")?.capability.videoGeneration).toBe("supported");
    expect(byId.get("fal-ai/wan-3.0/i2v")?.capability.videoGeneration).toBe("supported");
    expect(byId.get("fal-ai/tts-1")?.capability.speechGeneration).toBe("supported");
    expect(byId.get("vendor/transcribe")?.capability.transcription).toBe("supported");
    // Everything the vendor lists is a job; the queue host is the wire.
    expect(models.every((model) => model.shape === "poll")).toBe(true);
    // The two categories no Studio slot answers were counted, and their
    // models are not offered to a picker that nothing would invoke.
    expect(models.map((model) => model.modelId)).not.toContain("vendor/upscale-1");
    expect(models).toHaveLength(6);

    // The read was recorded once, with the number the next slot's decision
    // reads - including the vendor, so two aggregators' numbers stay apart.
    const logged = written
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const line = logged.find((fields) =>
      (fields["msg"] ?? fields["message"])?.toString().includes("FAL answered its listing"),
    );
    expect(line).toBeDefined();
    expect(line?.["dropped"]).toBe(2);
    expect(line?.["kept"]).toBe(6);
    expect(line?.["vendor"]).toBe("FAL");
  });

  it("rides the credential in FAL's own scheme, and nothing when there is none", async () => {
    pages = new Map([
      ["/v1/models?limit=500", JSON.stringify({ models: [], has_more: false })],
    ]);
    await falListing.models("https://queue.fal.run", "the-fal-key", { fetch: falFetchWith("x") });
    await falListing.models("https://queue.fal.run", undefined, { fetch: falFetchWith(undefined) });
    expect(seen.map((call) => call.authorization)).toEqual(["Key the-fal-key", undefined]);
  });

  it("answers nothing uncached when a page speaks another shape", async () => {
    pages = new Map([
      ["/v1/models?limit=500", JSON.stringify({ models: [], has_more: false })],
    ]);
    expect(await falListing.models("https://queue.fal.run", undefined, { fetch: falFetchWith(undefined) })).toEqual([]);

    // An unusable answer is what "offline" looks like, and the next read asks
    // again rather than showing nothing for an hour.
    pages = new Map([
      [
        "/v1/models?limit=500",
        JSON.stringify({
          models: [listed("fal-ai/flux-2-pro", "FLUX.2 Pro", "text-to-image")],
          has_more: false,
        }),
      ],
    ]);
    const models = await falListing.models("https://queue.fal.run", undefined, { fetch: falFetchWith(undefined) });
    expect(models).toHaveLength(1);
    expect(seen).toHaveLength(2);
  });

  it("stops at the ceiling when a wedged cursor would read forever", async () => {
    pages = new Map([
      [
        "/v1/models?limit=500",
        JSON.stringify({ models: [listed("x", "X", "text-to-image")], has_more: true, next_cursor: "wedge" }),
      ],
      [
        "/v1/models?limit=500&cursor=wedge",
        JSON.stringify({ models: [listed("x", "X", "text-to-image")], has_more: true, next_cursor: "wedge" }),
      ],
    ]);
    await falListing.models("https://queue.fal.run", undefined, { fetch: falFetchWith(undefined) });
    // Ten pages were the ceiling the read names; a wedged cursor cost ten
    // questions, not an evening.
    expect(seen).toHaveLength(10);
  });
});
