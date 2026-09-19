import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { StudioRuntime } from "../../src/application/studio-runtime.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { ConversationStore } from "../../src/conversations/store.js";
import type {
  Generation,
  MediaAdapter,
  MediaBytes,
} from "../../src/gateway/media/adapters/types.js";
import { ConnectionStore } from "../../src/gateway/connections/connection-store.js";
import { ModelCatalog } from "../../src/gateway/connections/model-catalog.js";
import { MediaJobs } from "../../src/gateway/media/jobs.js";
import { conversationWorkspaceDirectory } from "../../src/platform/paths.js";
import { WorkspaceTrustStore } from "../../src/permissions/trust.js";
import { openDatabase } from "../../src/storage/database.js";

/**
 * The finished-job announcement, end to end within this harness.
 *
 * A video the model starts through its own tool becomes a job; the job ends;
 * the conversation's deliver port hears of it - without anybody sending a
 * message, which is the whole point. What the last hop (Flue's dispatch, the
 * delivery, the wake) does with it is Flue's documented mechanic and is not
 * enacted here; everything this side of it is: the tool's start, the
 * registry's end, the announcement, the conversation guard, and the drain
 * that decides exactly once who tells the model.
 */

const MP4: MediaBytes = {
  bytes: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]),
  mimeType: "video/mp4",
};

function falAdapter(recorded: { prompts: string[] }): MediaAdapter {
  return {
    protocol: "fal",
    generateVideo: async (input): Promise<Generation> => {
      recorded.prompts.push(input.prompt);
      // Sync, and finished the moment its promise unwinds: the smallest end
      // that still goes through the registry's own store-and-announce.
      return { shape: "sync", result: Promise.resolve([MP4]) };
    },
  };
}

interface Harness {
  readonly runtime: StudioRuntime;
  /** Everything the deliver port received, oldest first. */
  readonly deliveries: { conversationId: string; body: string }[];
  readonly recorded: { prompts: string[] };
  /** Stops the runtime, closes the database, and gives the directories back. */
  readonly cleanup: () => Promise<void>;
}

async function harnessWith(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-job-pings-"));
  const previousHome = process.env.PROJECT_STUDIO_HOME;
  process.env.PROJECT_STUDIO_HOME = join(directory, "home");

  const database = openDatabase({ path: join(directory, "studio.db") });
  const credentials = new InMemoryCredentialStore();
  // The one connection, one truth: what the test writes here, the runtime's
  // own stores read there - they share the database and this very credential
  // store, which is the routes the key takes.
  const connections = new ConnectionStore({ db: database, credentials });
  const catalog = new ModelCatalog({ db: database, connections, liveListings: false });
  await connections.add({
    id: "fal",
    displayName: "FAL",
    serves: { media: "fal" },
    source: "local",
    enabled: true,
    catalogProvider: "fal",
    apiKey: "fal-key-1",
  });
  // A model the FAL declaration actually carries: the catalog settles a
  // slot's default only for a model it knows.
  await catalog.setDefault("videoGeneration", {
    connectionId: "fal",
    modelId: "alibaba/wan-3.0/text-to-video",
  });

  const recorded: { prompts: string[] } = { prompts: [] };
  const mediaJobs = new MediaJobs({
    artifactsDirectory: (conversationId) => join(directory, "artifacts", conversationId),
  });
  const deliveries: { conversationId: string; body: string }[] = [];
  const runtime = new StudioRuntime({
    database,
    credentials,
    mediaJobs,
    mediaAdapters: new Map([["fal", falAdapter(recorded)]]),
    deliverJobPing: async (conversationId, body) => {
      deliveries.push({ conversationId, body });
    },
  });
  // The row the announcement's guard reads, and the consent that lets the
  // tool's network effect pass without anybody answering a question.
  new ConversationStore(database).record({
    id: "cnv_ping",
    firstMessage: "First",
    permissionMode: "auto",
  });
  new WorkspaceTrustStore(database).set(conversationWorkspaceDirectory("cnv_ping"), true);

  return {
    runtime,
    deliveries,
    recorded,
    cleanup: async () => {
      process.env.PROJECT_STUDIO_HOME = previousHome;
      await runtime.stop();
      database.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** The conversation's own studio_video tool, through the real sandbox. */
async function videoToolOf(runtime: StudioRuntime): Promise<{
  execute(toolCallId: string, input: unknown): Promise<unknown>;
}> {
  const conversationId = "cnv_ping";
  const sandbox = runtime.createAgentSandbox({
    agentId: "studio",
    conversationId,
    projectRoot: conversationWorkspaceDirectory(conversationId),
  });
  const environment = await sandbox.createSandbox({ id: conversationId });
  const tools = (sandbox.tools?.(environment, { subagents: {} }) ?? []) as {
    name: string;
    execute(toolCallId: string, input: unknown): Promise<unknown>;
  }[];
  const tool = tools.find((candidate) => candidate.name === "studio_video");
  if (tool === undefined) throw new Error('The sandbox did not offer a "studio_video" tool.');
  return tool;
}

describe("a finished generation's announcement", () => {
  it(
    "reaches the conversation's deliver port, without anybody sending a message",
    async () => {
      const harness = await harnessWith();
      try {
        const video = await videoToolOf(harness.runtime);
        const answer = await video.execute("call-1", {
          prompt: "a shortened iceberg sailing past",
        });

        // The tool started the job and came back at once; the news of its
        // end belongs to the announcement, not to this call.
        expect(JSON.stringify(answer)).toContain("Started video job media_");
        expect(harness.recorded.prompts).toEqual(["a shortened iceberg sailing past"]);
        expect(harness.deliveries).toEqual([]);

        // The announcement. It carries what the model needs to act: which
        // job, what finished, where the file is, and that the harness, not
        // the user, is speaking.
        for (let attempt = 0; attempt < 200; attempt += 1) {
          if (harness.deliveries.length > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(harness.deliveries).toHaveLength(1);
        expect(harness.deliveries[0]?.conversationId).toBe("cnv_ping");
        const body = harness.deliveries[0]?.body ?? "";
        expect(body).toContain("Background work has finished:");
        expect(body).toContain("a shortened iceberg sailing past");
        expect(body).toMatch(
          /Artifact: \/api\/media\/artifacts\/cnv_ping\/media_\w+-1\.mp4 \(video\/mp4\)/,
        );
        expect(body).toContain("This message is the harness, not the user");

        // And the drain is the arbiter: the announcement took the ending, so
        // the next turn's block - the other delivery point - says nothing.
        expect(harness.runtime.conversationBackgroundJobs("cnv_ping")).toEqual([]);
      } finally {
        await harness.cleanup();
      }
    },
    60_000,
  );
});
