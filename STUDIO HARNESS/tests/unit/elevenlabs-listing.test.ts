import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { elevenlabsListing } from "../../src/gateway/catalog/elevenlabs-media.js";
import {
  initializeObservability,
  shutdownObservability,
} from "../../src/observability/index.js";

/**
 * ElevenLabs' live listing, against a stand-in speaking its documented shape
 * on a real loopback socket - the connection's own base URL, which is why
 * the requestDirect that carries the credential in production is the one
 * this test watches. What is pinned: the bare-array answer, the
 * `can_do_text_to_speech` flag as the whole classification, the `xi-api-key`
 * header's single ride, and the vendor's 401 answering nothing uncached.
 */

interface SeenCall {
  readonly authorization: string | undefined;
}

interface StagedAnswer {
  readonly status: number;
  readonly body: string;
}

function listed(
  modelId: string,
  name: string,
  canDoTextToSpeech: boolean | undefined,
): Record<string, unknown> {
  return {
    model_id: modelId,
    name,
    ...(canDoTextToSpeech === undefined ? {} : { can_do_text_to_speech: canDoTextToSpeech }),
  };
}

let standIn: Server;
let port = 0;
let seen: SeenCall[];
/** Answers in order; a question past the end of the queue gets 404. */
let answers: StagedAnswer[];
let written: string[];

beforeEach(async () => {
  seen = [];
  answers = [];
  written = [];
  initializeObservability({ exporter: "memory", deploymentEnvironment: "test" });
  // The listing's dropped count lands in a structured log line; the capture
  // mirrors what the boot log test does, so the test asserts a fact of ours.
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  };
  processStash = original;
  standIn = createServer((request, response) => {
    const key = request.headers["xi-api-key"];
    seen.push({ authorization: Array.isArray(key) ? key[0] : key });
    const answer = answers.shift();
    if (answer === undefined) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ detail: "nothing staged" }));
      return;
    }
    response.writeHead(answer.status, { "content-type": "application/json" });
    response.end(answer.body);
  });
  await new Promise<void>((resolve) => standIn.listen(0, "127.0.0.1", resolve));
  port = (standIn.address() as AddressInfo).port;
});

let processStash: typeof process.stdout.write;

afterEach(async () => {
  elevenlabsListing.forget();
  standIn.closeAllConnections();
  standIn.close();
  process.stdout.write = processStash;
  await shutdownObservability();
});

function origin(): string {
  return `http://127.0.0.1:${String(port)}`;
}

function loggedLines(): readonly Record<string, unknown>[] {
  return written
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("ElevenLabs' live listing", () => {
  it("classifies by the vendor's one flag, and counts what the flag does not cover", async () => {
    answers = [
      {
        status: 200,
        body: JSON.stringify([
          listed("eleven_v3", "Eleven v3", true),
          listed("scribe_v2", "Scribe v2", false),
          listed("mystery_model", "Mystery", undefined),
        ]),
      },
    ];

    const models = await elevenlabsListing.models(origin(), "the-ll-key");

    expect(seen).toHaveLength(1);
    expect(seen[0]?.authorization).toBe("the-ll-key");

    // The flag's word: one speech model, supported and nothing else stated.
    expect(models).toHaveLength(1);
    expect(models[0]?.modelId).toBe("eleven_v3");
    expect(models[0]?.displayName).toBe("Eleven v3");
    expect(models[0]?.capability.speechGeneration).toBe("supported");
    expect(models[0]?.capability.textGeneration).toBe("unsupported");
    expect(models[0]?.shape).toBe("sync");

    // Scribe stays with the declared catalog, where the plan keeps it; the
    // unflagged answer is the vendor declining to say, which is still not a
    // speech model. Both counted, neither classified.
    const line = loggedLines().find((fields) =>
      (fields["msg"] ?? fields["message"])?.toString().includes("ElevenLabs answered its listing"),
    );
    expect(line).toBeDefined();
    expect(line?.["kept"]).toBe(1);
    expect(line?.["dropped"]).toBe(2);
  });

  it("answers nothing when the vendor refuses the keyless read, and asks again with the key", async () => {
    // Keyless: the vendor's documented 401. Then the same question, keyed.
    answers = [
      { status: 401, body: JSON.stringify({ detail: { status: "invalid_api_key" } }) },
      {
        status: 200,
        body: JSON.stringify([listed("eleven_v3", "Eleven v3", true)]),
      },
    ];

    expect(await elevenlabsListing.models(origin(), undefined)).toEqual([]);
    expect(seen[0]?.authorization).toBeUndefined();

    const models = await elevenlabsListing.models(origin(), "the-ll-key");
    expect(models).toHaveLength(1);
    expect(seen).toHaveLength(2);
    expect(seen[1]?.authorization).toBe("the-ll-key");
  });

  it("keeps two keys' catalogues apart at one origin", async () => {
    // What a key may see is the key's own: the second connection's answer is
    // read, not inherited from the first connection's hour.
    answers = [
      { status: 200, body: JSON.stringify([listed("eleven_v3", "Eleven v3", true)]) },
      { status: 200, body: JSON.stringify([listed("eleven_flash_v2_5", "Eleven Flash v2.5", true)]) },
    ];

    const first = await elevenlabsListing.models(origin(), "the-ll-key");
    const second = await elevenlabsListing.models(origin(), "the-other-key");

    expect(seen).toHaveLength(2);
    expect(seen.map((call) => call.authorization)).toEqual(["the-ll-key", "the-other-key"]);
    expect(first[0]?.modelId).toBe("eleven_v3");
    expect(second[0]?.modelId).toBe("eleven_flash_v2_5");
  });
});
