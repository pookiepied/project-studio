import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../../src/admission/context.js";
import { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import { StudioRuntime } from "../../src/application/studio-runtime.js";
import type { SecureCredentialStore } from "../../src/credentials/credential-store.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { PermissionError } from "../../src/permissions/errors.js";
import { PendingApprovalStore } from "../../src/permissions/pending-approvals.js";
import { WorkspaceTrustStore } from "../../src/permissions/trust.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * The mode a decision resolves under is the conversation's own.
 *
 * The posture's `mode()` used to be a process-wide callback nothing passed,
 * so every conversation ran Manual forever and nothing could widen it. Now
 * the conversation index stores the mode (migration 17, settled by the
 * turn-settings middleware) and `createAgentSandbox` - the one place a kernel
 * is built - closes over the conversation it was called for. These tests
 * drive the real gate, kernel, broker, and store, with no mock of any of
 * them, and read the answer off three observables: whether the approver was
 * asked, what the pending queue held, and whether the write ran.
 */

const credentials: SecureCredentialStore = {
  get: async () => null,
  set: async () => undefined,
  delete: async () => false,
};

/** What the broker's auth parameter needs; the broker reads none of it. */
const AUTH: AuthContext = {
  clientId: "test",
  clientType: "test",
  sessionId: "test",
  scopes: ["approval"],
};

type Mode = "ask" | "auto";

const temporaryDirectories: string[] = [];
let previousHome: string | undefined;

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
  else process.env.PROJECT_STUDIO_HOME = previousHome;
  previousHome = undefined;

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
});

interface Harness {
  readonly runtime: StudioRuntime;
  readonly database: StudioDatabase;
  readonly broker: PermissionApprovalBroker;
  readonly projectRoot: string;
}

async function harnessWith(
  conversations: readonly { readonly id: string; readonly permissionMode?: Mode }[],
): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-conversation-mode-"));
  temporaryDirectories.push(directory);
  const projectRoot = join(directory, "project");
  await mkdir(projectRoot, { recursive: true });
  previousHome = process.env.PROJECT_STUDIO_HOME;
  process.env.PROJECT_STUDIO_HOME = join(directory, "home");

  const database = openDatabase({ path: join(directory, "studio.db") });
  const index = new ConversationStore(database);
  for (const conversation of conversations) {
    index.record({
      id: conversation.id,
      firstMessage: "First",
      ...(conversation.permissionMode === undefined
        ? {}
        : { permissionMode: conversation.permissionMode }),
    });
  }

  const broker = new PermissionApprovalBroker({ store: new PendingApprovalStore(database) });
  const runtime = new StudioRuntime({
    database,
    projectRoot,
    credentials,
    approver: broker,
  });
  new WorkspaceTrustStore(database).set(projectRoot, true);

  return { runtime, database, broker, projectRoot };
}

interface SandboxTool {
  readonly name: string;
  execute(toolCallId: string, input: unknown): Promise<unknown>;
}

/**
 * The named tool of the named conversation's own sandbox.
 *
 * The sandbox is built the way the agent render builds it: per call, with
 * the conversation's own id as the scope's conversation id - under Flue 2.0
 * the instance id IS the conversation id, so the vocabulary is bare.
 */
async function toolOf(
  harness: Harness,
  conversationId: string,
  name: string,
): Promise<SandboxTool> {
  const sandbox = harness.runtime.createAgentSandbox({
    agentId: "studio",
    conversationId,
    projectRoot: harness.projectRoot,
  });
  const env = await sandbox.createSandbox({ id: conversationId });
  const tools: readonly SandboxTool[] = sandbox.tools?.(env, { subagents: {} }) ?? [];
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`The sandbox did not offer a "${name}" tool.`);
  return tool;
}

/** The refusal a deny or a cancel produces, narrowed without a cast. */
function refusalOf(value: unknown): PermissionError | undefined {
  return value instanceof PermissionError ? value : undefined;
}

describe("the permission mode follows the conversation", () => {
  it(
    "in Ask a write parks on a real pending approval, and denying answers it as a refusal",
    async () => {
      const harness = await harnessWith([{ id: "cnv_ask", permissionMode: "ask" }]);
      try {
        const write = await toolOf(harness, "cnv_ask", "write");
        // Starting the call is synchronous up to the parking: the durable
        // row exists by the time this line returns.
        const settled = write.execute("call-1", { path: "note.txt", content: "a note" });

        // Exactly one question is queued, and it names the capability, the
        // resolved path, and the conversation whose kernel is deciding. That
        // last fact is the measurement: the scope on the request is the same
        // conversation this sandbox was built for, so the mode the kernel
        // resolves under can only be that one's.
        const pending = harness.broker.list(AUTH);
        expect(pending).toHaveLength(1);
        const question = pending[0];
        expect(question?.request.capability.id).toEqual({
          namespace: "native",
          name: "write",
        });
        expect(question?.request.resource).toBe(join(harness.projectRoot, "note.txt"));
        expect(question?.request.scope.conversationId).toBe("cnv_ask");

        // Denying settles the run's own promise, the queue empties, and the
        // write did not happen.
        expect(
          harness.broker.answer(
            question?.id ?? "",
            { verdict: "deny", duration: "once" },
            AUTH,
          ),
        ).toBe(true);
        const outcome = await settled.then(
          () => "completed",
          (error: unknown) => error,
        );
        const refusal = refusalOf(outcome);
        expect(refusal?.kind).toBe("denied");
        expect(refusal?.message).toBe("You declined this action.");
        expect(harness.broker.list(AUTH)).toEqual([]);
        expect(existsSync(join(harness.projectRoot, "note.txt"))).toBe(false);
      } finally {
        await harness.runtime.stop();
        harness.database.close();
      }
    },
    60_000,
  );

  it(
    "in Ask an allow lets the write complete",
    async () => {
      const harness = await harnessWith([{ id: "cnv_allow", permissionMode: "ask" }]);
      try {
        const write = await toolOf(harness, "cnv_allow", "write");
        const settled = write.execute("call-1", { path: "note.txt", content: "a note" });

        const pending = harness.broker.list(AUTH);
        expect(pending).toHaveLength(1);
        expect(
          harness.broker.answer(
            pending[0]?.id ?? "",
            { verdict: "allow", duration: "once" },
            AUTH,
          ),
        ).toBe(true);

        // The same promise the run was parked on resolves into the file.
        expect(await settled).toBeDefined();
        expect(existsSync(join(harness.projectRoot, "note.txt"))).toBe(true);
      } finally {
        await harness.runtime.stop();
        harness.database.close();
      }
    },
    60_000,
  );

  it(
    "builds two scopes for two conversations of one agent",
    async () => {
      // The #69 guard, positively: the scope is built from the instance id
      // (which under Flue 2.0 IS the conversation id) and the agent is named
      // separately, so two conversations of the same agent ask their
      // questions under two different scopes. A collapsed scope would let a
      // grant made in one conversation answer the other's asks.
      const harness = await harnessWith([
        { id: "cnv_scope_a", permissionMode: "ask" },
        { id: "cnv_scope_b", permissionMode: "ask" },
      ]);
      try {
        const scopes: string[] = [];
        for (const conversationId of ["cnv_scope_a", "cnv_scope_b"]) {
          const write = await toolOf(harness, conversationId, "write");
          const settled = write.execute("call", { path: "note.txt", content: "x" });
          const pending = harness.broker.list(AUTH);
          expect(pending).toHaveLength(1);
          const scope = pending[0]?.request.scope.conversationId;
          if (typeof scope === "string") scopes.push(scope);
          expect(
            harness.broker.answer(
              pending[0]?.id ?? "",
              { verdict: "deny", duration: "once" },
              AUTH,
            ),
          ).toBe(true);
          await settled.then(
            () => undefined,
            () => undefined,
          );
          expect(harness.broker.list(AUTH)).toEqual([]);
        }

        expect(scopes).toEqual(["cnv_scope_a", "cnv_scope_b"]);
      } finally {
        await harness.runtime.stop();
        harness.database.close();
      }
    },
    60_000,
  );

  it(
    "in Auto a write proceeds without a question",
    async () => {
      const harness = await harnessWith([{ id: "cnv_auto", permissionMode: "auto" }]);
      try {
        const write = await toolOf(harness, "cnv_auto", "write");
        const outcome = await write.execute("call-1", { path: "note.txt", content: "a note" });
        expect(outcome).toBeDefined();
        expect(existsSync(join(harness.projectRoot, "note.txt"))).toBe(true);
        // Not asked: the write's default ask was resolved by the mode.
        expect(harness.broker.list(AUTH)).toEqual([]);
      } finally {
        await harness.runtime.stop();
        harness.database.close();
      }
    },
    60_000,
  );

  it(
    "a question inherited from a dead process stays answerable and leaves the queue",
    async () => {
      // The broker writes the durable row before the caller parks, so the
      // queue the API reads survives the process. A second broker over the
      // same database - what a restarted harness is - lists the question and
      // can answer it even though nothing is parked on it any more.
      const directory = mkdtempSync(join(tmpdir(), "studio-conversation-mode-restart-"));
      temporaryDirectories.push(directory);
      previousHome = process.env.PROJECT_STUDIO_HOME;
      process.env.PROJECT_STUDIO_HOME = join(directory, "home");
      const database = openDatabase({ path: join(directory, "studio.db") });
      new ConversationStore(database).record({
        id: "cnv_restart",
        firstMessage: "First",
        permissionMode: "ask",
      });
      const projectRoot = join(directory, "project");
      await mkdir(projectRoot, { recursive: true });
      new WorkspaceTrustStore(database).set(projectRoot, true);
      const firstProcess = new PermissionApprovalBroker({
        store: new PendingApprovalStore(database),
      });
      const runtime = new StudioRuntime({
        database,
        projectRoot,
        credentials,
        approver: firstProcess,
      });

      try {
        const sandbox = runtime.createAgentSandbox({
          agentId: "studio",
          conversationId: "cnv_restart",
          projectRoot,
        });
        const env = await sandbox.createSandbox({ id: "cnv_restart" });
        const tools: readonly SandboxTool[] = sandbox.tools?.(env, { subagents: {} }) ?? [];
        const write = tools.find((candidate) => candidate.name === "write");
        if (write === undefined) throw new Error('The sandbox did not offer a "write" tool.');
        // Started, never settled: the parked promise dies with the process.
        void write.execute("call-1", { path: "note.txt", content: "a note" });

        const after = new PermissionApprovalBroker({
          store: new PendingApprovalStore(database),
        });
        const inherited = after.list(AUTH);
        expect(inherited).toHaveLength(1);

        // Answering the inherited question closes it: `true`, and it leaves
        // the queue, so a UI that actioned it does not keep showing it.
        expect(
          after.answer(
            inherited[0]?.id ?? "",
            { verdict: "deny", duration: "once" },
            AUTH,
          ),
        ).toBe(true);
        expect(after.list(AUTH)).toEqual([]);
      } finally {
        await runtime.stop();
        database.close();
      }
    },
    60_000,
  );
});
