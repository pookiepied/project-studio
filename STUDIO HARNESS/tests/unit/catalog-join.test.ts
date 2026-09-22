import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

import { forgetOpenrouterListings } from "../../src/gateway/catalog/openrouter-media.js";
import { ConnectionStore } from "../../src/gateway/connections/connection-store.js";
import { ModelCatalog } from "../../src/gateway/connections/model-catalog.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import type { ProviderConnectionDraft } from "../../src/contracts/providers.js";

/**
 * The whole path the Media pane's answer takes, against a stand-in that speaks
 * OpenRouter's four listing shapes on a real loopback socket: the connection
 * joins the language catalog, the declared one, and the live listing, and what
 * reaches `listModels` is what the Media page shows.
 *
 * The count pinned is the plan's own: 54 image, 29 video, 18 speech and 20
 * transcription models - 121. One of the 54 is also a Pi language model, the
 * way `google/gemini-3-pro-image` is, and the join must keep both halves of it
 * rather than dedupe the model away; that row is the difference between a
 * catalogue of 122 sources' truth and one of 121.
 */

const LISTED = { images: 54, videos: 29, speech: 18, transcription: 20, documents: 7 } as const;
const LIVE_TOTAL = LISTED.images + LISTED.videos + LISTED.speech + LISTED.transcription + LISTED.documents;

/** A model entry as the vendor spells it; extra fields ride along. */
function listed(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, name: id, ...extra };
}

let standIn: Server;
let port = 0;
let seen: { readonly url: string; readonly headers: IncomingMessage["headers"] }[];

beforeEach(async () => {
  seen = [];
  // The colliding id is a real Pi id, whichever one the installed Pi ships
  // first: the test pins the JOIN, not a Pi snapshot. The other 120 ids are
  // `stand-in/`-prefixed, which no Pi id is, so the arithmetic is exact.
  const firstPi = getBuiltinModels("openrouter").at(0);
  if (firstPi === undefined) {
    throw new Error("Pi's openrouter catalog is empty; the join test needs one of its ids.");
  }

  const images = [
    listed(firstPi.id, {
      supported_parameters: { input_references: { type: "range", min: 0, max: 16 } },
    }),
    ...Array.from({ length: LISTED.images - 1 }, (_, at) => listed(`stand-in/image-${at}`)),
  ];
  const answerFor = (url: string): string | undefined => {
    if (url === "/api/v1/models?output_modalities=speech") {
      return JSON.stringify({
        data: Array.from({ length: LISTED.speech }, (_, at) => listed(`stand-in/speech-${at}`)),
      });
    }
    if (url === "/api/v1/models?output_modalities=transcription") {
      return JSON.stringify({
        data: Array.from({ length: LISTED.transcription }, (_, at) =>
          listed(`stand-in/transcription-${at}`),
        ),
      });
    }
    if (url === "/api/v1/models?input_modalities=file") {
      // The colliding Pi id again: a chat model that takes a file joins its
      // language row, the same way the image half does.
      return JSON.stringify({
        data: [
          listed(firstPi.id),
          ...Array.from({ length: LISTED.documents - 1 }, (_, at) => listed(`stand-in/document-${at}`)),
        ],
      });
    }
    if (url === "/api/v1/images/models") return JSON.stringify({ data: images });
    if (url === "/api/v1/videos/models") {
      return JSON.stringify({
        data: Array.from({ length: LISTED.videos }, (_, at) => listed(`stand-in/video-${at}`)),
      });
    }
    return undefined;
  };

  standIn = createServer((request, response) => {
    const url = request.url ?? "";
    seen.push({ url, headers: request.headers });
    const answer = answerFor(url);
    if (answer === undefined) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: `nothing staged for ${url}` }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(answer);
  });
  await new Promise<void>((resolve) => standIn.listen(0, "127.0.0.1", resolve));
  port = (standIn.address() as AddressInfo).port;
});

afterEach(() => {
  forgetOpenrouterListings();
  standIn.closeAllConnections();
  standIn.close();
  db.close();
});

let db: StudioDatabase;
let connections: ConnectionStore;
let catalog: ModelCatalog;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  connections = new ConnectionStore({
    db,
    credentials: new InMemoryCredentialStore(),
  });
  catalog = new ModelCatalog({ db, connections });
});

const OPENROUTER: ProviderConnectionDraft = {
  id: "openrouter-everything",
  displayName: "OpenRouter",
  serves: { language: "openai-completions", media: "openrouter" },
  source: "local",
  enabled: true,
  catalogProvider: "openrouter",
  // Stand-ins do not read credentials, and the listing is keyless besides:
  // what the test asserts about the wire is that no secret rides on it.
};

describe("the Media pane's answer, joined at the catalog", () => {
  it("keeps every listed model, including one a language record already holds", async () => {
    await connections.add({ ...OPENROUTER, baseUrl: `http://127.0.0.1:${String(port)}/api/v1` });

    const models = await catalog.listModels({ connectionId: "openrouter-everything" });

    // Every Pi model, and every listed model, on one shared id: 333 + 128
    // less the one they all name, listed twice (images and documents). One
    // MORE row fewer than that is the leak this pins.
    const piCount = getBuiltinModels("openrouter").length;
    expect(models).toHaveLength(piCount + LIVE_TOTAL - 2);

    const byId = new Map(models.map((model) => [model.modelId, model]));
    const joined = byId.get(firstPiId());
    expect(joined?.capability.textGeneration).toBe("supported");
    expect(joined?.capability.imageGeneration).toBe("supported");
    expect(joined?.capability.imageEditing).toBe("supported");
    expect(joined?.capability.documentReading).toBe("supported");
    // The listing's classification, sliced the way the Media page slices it:
    // exactly what the vendor listed, nothing more.
    expect(
      models.filter((model) => model.capability.imageGeneration === "supported"),
    ).toHaveLength(LISTED.images);
    expect(
      models.filter((model) => model.capability.videoGeneration === "supported"),
    ).toHaveLength(LISTED.videos);
    expect(
      models.filter((model) => model.capability.speechGeneration === "supported"),
    ).toHaveLength(LISTED.speech);
    expect(
      models.filter((model) => model.capability.transcription === "supported"),
    ).toHaveLength(LISTED.transcription);
    expect(
      models.filter((model) => model.capability.documentReading === "supported"),
    ).toHaveLength(LISTED.documents);
  });

  it("asks the five listings without a credential, because the listing is public", async () => {
    await connections.add({
      ...OPENROUTER,
      baseUrl: `http://127.0.0.1:${String(port)}/api/v1`,
      apiKey: "sk-KEYS-STAY-ON-THE-STORE",
    });

    await catalog.listModels({ connectionId: "openrouter-everything" });

    expect(seen.map((call) => call.url).sort()).toEqual([
      "/api/v1/images/models",
      "/api/v1/models?input_modalities=file",
      "/api/v1/models?output_modalities=speech",
      "/api/v1/models?output_modalities=transcription",
      "/api/v1/videos/models",
    ]);
    for (const call of seen) {
      expect(call.headers.authorization).toBeUndefined();
    }
  });
});

/** The id of the first Pi model, read again inside the assertions. */
function firstPiId(): string {
  const id = getBuiltinModels("openrouter").at(0)?.id;
  if (id === undefined) throw new Error("Pi's openrouter catalog is empty.");
  return id;
}
