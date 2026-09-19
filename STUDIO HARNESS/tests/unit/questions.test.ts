import { afterEach, describe, expect, it, vi } from "vitest";

import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import { QuestionBroker } from "../../src/application/question-broker.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { PendingApprovalStore } from "../../src/permissions/pending-approvals.js";
import { PermissionKernel } from "../../src/permissions/kernel.js";
import type { PermissionDecision, PermissionRequest } from "../../src/permissions/policy.js";
import { PendingQuestionStore } from "../../src/questions/pending-questions.js";
import type { QuestionPayload } from "../../src/questions/question.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { ClosingTurns } from "../../src/execution/closing-turns.js";
import {
  ASK_USER_QUESTION_DESCRIPTOR,
  clampTimeout,
  createAskUserQuestionTool,
  shortenHeader,
} from "../../src/tools/ask/questions.js";
import { CallGate } from "../../src/tools/gate.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

const AUTH_CONTEXT = {
  clientId: "test-client",
  clientType: "test",
  sessionId: "test-session",
  scopes: ALL_ADMISSION_SCOPES,
} as const;

const CONVERSATION = "cnv_test";

function payload(overrides: Partial<QuestionPayload> = {}): QuestionPayload {
  return {
    question: "Which database should this use?",
    header: "Storage",
    options: [
      {
        id: "sqlite",
        label: "SQLite (Recommended)",
        description: "One file, no setup, the default for this workspace.",
      },
      {
        id: "postgres",
        label: "Postgres",
        description: "A server to run and configure, for concurrent writes.",
      },
    ],
    multiSelect: false,
    recommendedOptionId: "sqlite",
    ...overrides,
  };
}

const VALID_INPUT = {
  questions: [
    {
      question: "Which database?",
      header: "Storage",
      options: [
        { id: "a", label: "A", description: "Option A." },
        { id: "b", label: "B", description: "Option B." },
      ],
      multiSelect: false,
    },
  ],
} as const;

const REQUEST = {
  capability: {
    id: { namespace: "mcp:example", name: "search" },
    title: "search",
    description: "Search documents",
    effects: ["network"],
    provenance: { origin: "mcp", sourceId: "example", author: "third-party" },
    idempotent: false,
  },
  scope: { agentId: "agent", conversationId: "conversation", projectId: "project" },
  resource: undefined,
  scopes: [{ id: "this-capability", label: "This tool", detail: "Every use", pattern: undefined }],
} satisfies PermissionRequest;

const DECISION = {
  verdict: "ask",
  source: "policy",
  reason: "Review it.",
  grantId: undefined,
} satisfies PermissionDecision;

const opened: StudioDatabase[] = [];

function open(): StudioDatabase {
  const db = openDatabase({ path: ":memory:" });
  opened.push(db);
  return db;
}

function parkedRace(pending: Promise<unknown>): Promise<"parked" | "settled"> {
  return Promise.race([
    pending.then(() => "settled" as const),
    new Promise<"parked">((resolve) => setTimeout(() => resolve("parked"), 20)),
  ]);
}

afterEach(() => {
  while (opened.length > 0) {
    opened.pop()?.close();
  }
  vi.useRealTimers();
});

describe("the ask-a-question channel", () => {
  it("parks until the person answers, and returns the choice", async () => {
    const broker = new QuestionBroker();
    const pending = broker.ask(CONVERSATION, [payload()], undefined);

    const [row] = broker.list(AUTH_CONTEXT);
    expect(row?.payload.header).toBe("Storage");
    expect(
      broker.answer(row?.id ?? "missing", { optionIds: ["postgres"], deferred: false }, AUTH_CONTEXT),
    ).toBe(true);

    await expect(pending).resolves.toEqual([
      {
        header: "Storage",
        question: "Which database should this use?",
        outcome: "answered",
        optionIds: ["postgres"],
        labels: ["Postgres"],
      },
    ]);
    expect(broker.list(AUTH_CONTEXT)).toEqual([]);
  });

  it("accepts free text, which the model never declared", async () => {
    const broker = new QuestionBroker();
    const pending = broker.ask(CONVERSATION, [payload()], undefined);

    const [row] = broker.list(AUTH_CONTEXT);
    broker.answer(row?.id ?? "", { text: "Bun with SQLite baked in.", deferred: false }, AUTH_CONTEXT);

    await expect(pending).resolves.toEqual([
      {
        header: "Storage",
        question: "Which database should this use?",
        outcome: "answered",
        text: "Bun with SQLite baked in.",
      },
    ]);
  });

  it("records a deferral as its own outcome, not a missing answer", async () => {
    const broker = new QuestionBroker();
    const pending = broker.ask(CONVERSATION, [payload()], undefined);

    const [row] = broker.list(AUTH_CONTEXT);
    broker.answer(row?.id ?? "", { deferred: true }, AUTH_CONTEXT);

    await expect(pending).resolves.toEqual([
      {
        header: "Storage",
        question: "Which database should this use?",
        outcome: "deferred",
      },
    ]);
  });

  it("refuses an answer naming an option the question never offered", async () => {
    const broker = new QuestionBroker();
    const pending = broker.ask(CONVERSATION, [payload()], undefined);

    const [row] = broker.list(AUTH_CONTEXT);
    expect(
      broker.answer(row?.id ?? "", { optionIds: ["mongodb"], deferred: false }, AUTH_CONTEXT),
    ).toBe(false);
    expect(broker.list(AUTH_CONTEXT)).toHaveLength(1);
    expect(await parkedRace(pending)).toBe("parked");

    broker.cancel(row?.id ?? "", AUTH_CONTEXT);
  });

  it("refuses two options on a question that allows one", async () => {
    const broker = new QuestionBroker();
    const pending = broker.ask(CONVERSATION, [payload()], undefined);

    const [row] = broker.list(AUTH_CONTEXT);
    expect(
      broker.answer(row?.id ?? "", { optionIds: ["sqlite", "postgres"], deferred: false }, AUTH_CONTEXT),
    ).toBe(false);
    expect(await parkedRace(pending)).toBe("parked");

    broker.cancel(row?.id ?? "", AUTH_CONTEXT);
  });

  it("takes several questions one at a time, and resolves when the last settles", async () => {
    const broker = new QuestionBroker();
    const pending = broker.ask(
      CONVERSATION,
      [payload(), payload({ header: "Style", question: "Tabs or spaces?" })],
      undefined,
    );

    const rows = broker.list(AUTH_CONTEXT);
    expect(rows).toHaveLength(2);

    // The first answer settles one question; the call is still parked.
    broker.answer(rows[0]?.id ?? "", { optionIds: ["sqlite"], deferred: false }, AUTH_CONTEXT);
    expect(await parkedRace(pending)).toBe("parked");

    broker.answer(rows[1]?.id ?? "", { deferred: true }, AUTH_CONTEXT);
    await expect(pending).resolves.toEqual([
      {
        header: "Storage",
        question: "Which database should this use?",
        outcome: "answered",
        optionIds: ["sqlite"],
        labels: ["SQLite (Recommended)"],
      },
      {
        header: "Style",
        question: "Tabs or spaces?",
        outcome: "deferred",
      },
    ]);
  });

  it("settles a deadline that passes while the asker waits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));

    const broker = new QuestionBroker();
    const pending = broker.ask(CONVERSATION, [payload()], 60_000);
    const [row] = broker.list(AUTH_CONTEXT);
    expect(row?.expiresAt).not.toBeNull();

    // Before the deadline nothing moves.
    expect(broker.list(AUTH_CONTEXT)).toHaveLength(1);

    vi.setSystemTime(new Date("2026-09-05T12:02:00Z"));
    // The next read honours the stored deadline; no timer resolved this.
    expect(broker.list(AUTH_CONTEXT)).toHaveLength(0);
    await expect(pending).resolves.toEqual([
      {
        header: "Storage",
        question: "Which database should this use?",
        outcome: "timed_out",
        optionIds: ["sqlite"],
        labels: ["SQLite (Recommended)"],
      },
    ]);
  });
});

describe("question durability (ADR 0036)", () => {
  it("survives a restart: a question asked by a dead process is still queued", () => {
    const database = open();

    // The process that asked. It parks a caller on a promise and exits.
    const before = new QuestionBroker({ store: new PendingQuestionStore(database) });
    void before.ask(CONVERSATION, [payload()], undefined);

    // A new process over the same database - nothing in memory carries over.
    const after = new QuestionBroker({ store: new PendingQuestionStore(database) });
    const rows = after.list(AUTH_CONTEXT);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload.question).toBe("Which database should this use?");
  });

  it("records an inherited answer against the row, with no waiter to wake", () => {
    const database = open();
    const before = new QuestionBroker({ store: new PendingQuestionStore(database) });
    void before.ask(CONVERSATION, [payload()], undefined);

    const after = new QuestionBroker({ store: new PendingQuestionStore(database) });
    const id = after.list(AUTH_CONTEXT)[0]?.id ?? "";

    expect(after.answer(id, { optionIds: ["sqlite"], deferred: false }, AUTH_CONTEXT)).toBe(true);
    // The settled row is the record of the decision; the queue is empty.
    expect(after.list(AUTH_CONTEXT)).toEqual([]);
    const settled = new PendingQuestionStore(database).get(id);
    expect(settled?.outcome).toBe("answered");
    expect(settled?.answer?.optionIds).toEqual(["sqlite"]);
  });

  it("honours an expired deadline after a restart, by reading the stored row", () => {
    const database = open();
    const store = new PendingQuestionStore(database);

    // Written the way a crashed process would have left it: a row whose
    // deadline has already passed, with a recommendation to fall back to.
    const id = "question-expired-with-recommendation";
    store.add({
      id,
      conversationId: CONVERSATION,
      payload: payload(),
      askedAt: 1_000,
      expiresAt: 2_000,
      outcome: undefined,
      answer: undefined,
    });

    // A new process, well past the deadline. Nothing brought the row in but
    // the store; nothing resolved it but the stored deadline.
    const after = new QuestionBroker({ store: new PendingQuestionStore(database) });
    expect(after.list(AUTH_CONTEXT)).toEqual([]);

    const settled = store.get(id);
    expect(settled?.outcome).toBe("timed_out");
    expect(settled?.answer?.optionIds).toEqual(["sqlite"]);
  });

  it("does not resolve an expired question that has no recommendation", () => {
    const database = open();
    const store = new PendingQuestionStore(database);

    const id = "question-expired-without-recommendation";
    const withoutRecommendation = payload();
    store.add({
      id,
      conversationId: CONVERSATION,
      payload: {
        question: withoutRecommendation.question,
        header: withoutRecommendation.header,
        options: withoutRecommendation.options,
        multiSelect: withoutRecommendation.multiSelect,
      },
      askedAt: 1_000,
      expiresAt: 2_000,
      outcome: undefined,
      answer: undefined,
    });

    const after = new QuestionBroker({ store: new PendingQuestionStore(database) });
    // It does not resolve, and it does not disappear: without a
    // recommendation there is nothing honest to answer with.
    expect(after.list(AUTH_CONTEXT)).toHaveLength(1);
    expect(store.get(id)?.outcome).toBeUndefined();
  });

  it("leaves the queue empty once the live call is answered", async () => {
    const database = open();
    const store = new PendingQuestionStore(database);
    const broker = new QuestionBroker({ store });

    const pending = broker.ask(CONVERSATION, [payload()], undefined);
    const id = broker.list(AUTH_CONTEXT)[0]?.id ?? "";

    broker.answer(id, { optionIds: ["postgres"], deferred: false }, AUTH_CONTEXT);
    await expect(pending).resolves.toMatchObject([{ outcome: "answered" }]);
    expect(store.list()).toEqual([]);
  });
});

describe("stopping a run's questions", () => {
  it("settles every question of the conversation as stopped, and the call with them", async () => {
    const broker = new QuestionBroker();
    const pending = broker.ask(
      CONVERSATION,
      [payload(), payload({ header: "Style", question: "Tabs or spaces?" })],
      undefined,
    );

    expect(broker.stop(CONVERSATION, AUTH_CONTEXT)).toBe(2);
    await expect(pending).resolves.toEqual([
      {
        header: "Storage",
        question: "Which database should this use?",
        outcome: "stopped",
      },
      {
        header: "Style",
        question: "Tabs or spaces?",
        outcome: "stopped",
      },
    ]);
    expect(broker.list(AUTH_CONTEXT)).toEqual([]);
  });

  it("leaves another conversation's questions alone", () => {
    const broker = new QuestionBroker();
    void broker.ask(CONVERSATION, [payload()], undefined);
    void broker.ask("cnv_other", [payload()], undefined);

    expect(broker.stop(CONVERSATION, AUTH_CONTEXT)).toBe(1);
    expect(broker.list(AUTH_CONTEXT)).toHaveLength(1);
    broker.stop("cnv_other", AUTH_CONTEXT);
  });

  it("withdraws one question without an outcome", async () => {
    const broker = new QuestionBroker();
    const pending = broker.ask(CONVERSATION, [payload()], undefined);

    const [row] = broker.list(AUTH_CONTEXT);
    expect(broker.cancel(row?.id ?? "", AUTH_CONTEXT)).toBe(true);
    expect(broker.cancel("missing", AUTH_CONTEXT)).toBe(false);
    expect(broker.list(AUTH_CONTEXT)).toEqual([]);
    await expect(pending).resolves.toEqual([
      {
        header: "Storage",
        question: "Which database should this use?",
        outcome: "stopped",
      },
    ]);
  });
});

describe("the ask tool's inputs", () => {
  const closing = new ClosingTurns();
  const definition = createAskUserQuestionTool({
    ask: () => Promise.resolve([]),
    closing,
  });

  it("accepts a question with options, a header, and no recommendation", () => {
    const parsed = definition.parse(VALID_INPUT);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0]?.multiSelect).toBe(false);
  });

  it("refuses more than four questions in one call", () => {
    const five = [1, 2, 3, 4, 5].map(() => ({
      question: "Which database?",
      header: "Storage",
      options: [
        { id: "a", label: "A", description: "Option A." },
        { id: "b", label: "B", description: "Option B." },
      ],
    }));
    expect(() => definition.parse({ questions: five })).toThrow(/At most 4 questions/);
  });

  it("refuses fewer than two options", () => {
    expect(() =>
      definition.parse({
        questions: [
          {
            question: "Which?",
            header: "Pick",
            options: [{ id: "a", label: "A", description: "Only A." }],
          },
        ],
      }),
    ).toThrow(/between 2 and 4 options/);
  });

  it("keeps a header of a few words as written", () => {
    // "File or folder?" used to be refused at twelve characters, and the
    // refusal cost two round trips. A short header is one the chip can show.
    const parsed = definition.parse({
      questions: [
        { question: "Which?", header: "File or folder?", options: VALID_INPUT.questions[0]?.options },
      ],
    });
    expect(parsed.questions[0]?.header).toBe("File or folder?");
  });

  it("shortens a long header instead of refusing it", () => {
    const parsed = definition.parse({
      questions: [
        {
          question: "Which?",
          header: "Which database engine should the service use",
          options: VALID_INPUT.questions[0]?.options,
        },
      ],
    });
    const header = parsed.questions[0]?.header ?? "";
    expect(header.length).toBeLessThanOrEqual(24);
    expect(header).toBe("Which database engine…");
    // One long word is cut inside the word rather than dropped whole.
    expect(shortenHeader("Supercalifragilisticexpialidocious")).toBe("Supercalifragilisticexp…");
  });

  it("refuses a recommendation that names no offered option", () => {
    expect(() =>
      definition.parse({
        questions: [
          {
            ...VALID_INPUT.questions[0],
            recommendedOptionId: "not-offered",
          },
        ],
      }),
    ).toThrow(/not one of the options/);
  });

  it("refuses options without a description, so a choice is never a guess", () => {
    expect(() =>
      definition.parse({
        questions: [
          {
            question: "Which?",
            header: "Pick",
            options: [
              { id: "a", label: "A", description: "Option A." },
              { id: "b", label: "B" },
            ],
          },
        ],
      }),
    ).toThrow(/description/);
  });

  it("refuses a question whose options are not an array", () => {
    expect(() =>
      definition.parse({
        questions: [{ question: "Which?", header: "Pick", options: "two" }],
      }),
    ).toThrow();
  });

  it("clamps the timeout to a floor a person can read, and a ceiling a run can live", () => {
    expect(clampTimeout(50)).toBe(10_000);
    expect(clampTimeout(60_000)).toBe(60_000);
    expect(clampTimeout(4 * 3_600_000)).toBe(3_600_000);
  });
});

describe("the ask tool's permissions", () => {
  it("declares read and nothing else, and the kernel admits exactly that", () => {
    expect(ASK_USER_QUESTION_DESCRIPTOR.effects).toEqual(["read"]);
    const database = open();
    const kernel = new PermissionKernel({ grants: new PermissionGrantStore(database) });
    expect(() => kernel.register(ASK_USER_QUESTION_DESCRIPTOR)).not.toThrow();
  });

  it("is auto-allowed without raising an approval, and holds a human-sized deadline", () => {
    const database = open();
    const kernel = new PermissionKernel({ grants: new PermissionGrantStore(database) });

    const sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot: process.cwd() }));
    const gate = new CallGate({ kernel, sandbox });
    gate.register(
      createAskUserQuestionTool({ ask: () => Promise.resolve([]), closing: new ClosingTurns() }),
    );

    const decision = kernel.evaluate(ASK_USER_QUESTION_DESCRIPTOR.id, {
      agentId: "studio",
      conversationId: CONVERSATION,
      projectId: undefined,
    });
    expect(decision.verdict).toBe("allow");
    // The shared two-minute default would abandon every question as its
    // first act, the way it once abandoned every long shell call.
    expect(gate.deadlineFor(ASK_USER_QUESTION_DESCRIPTOR)).toBe(3_600_000);
  });
});

describe("the closing turn", () => {
  const scope = {
    agentId: "studio",
    conversationId: CONVERSATION,
    projectId: undefined,
  };
  const sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot: process.cwd() }));

  async function runWith(outcome: "answered" | "stopped", closing: ClosingTurns): Promise<unknown> {
    const tool = createAskUserQuestionTool({
      ask: () =>
        Promise.resolve([
          {
            header: "Storage",
            question: "Which database should this use?",
            outcome,
          },
        ]),
      closing,
    });
    return tool.execute(
      { questions: VALID_INPUT.questions },
      { scope, sandbox, signal: undefined },
    );
  }

  it("is armed when a question settles as stopped, and not otherwise", async () => {
    const closing = new ClosingTurns();

    await runWith("answered", closing);
    expect(closing.isArmed(CONVERSATION)).toBe(false);

    await runWith("stopped", closing);
    expect(closing.isArmed(CONVERSATION)).toBe(true);
    // Armed per run: a fresh run is a fresh state, and the stop does not
    // outlive the run it stopped.
    expect(new ClosingTurns().isArmed(CONVERSATION)).toBe(false);
  });

  it("tells the model the run was stopped and what the one turn is for", async () => {
    const closing = new ClosingTurns();
    const result = (await runWith("stopped", closing)) as { closing?: string };

    expect(result.closing).toMatch(/stopped this run/);
    expect(result.closing).toMatch(/one turn/);
  });
});

describe("the separation this task is built on", () => {
  it("a permission question still cannot time out and still has no default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));

    const database = open();
    const approvals = new PermissionApprovalBroker({ store: new PendingApprovalStore(database) });
    void approvals.request(REQUEST, DECISION);
    expect(approvals.list(AUTH_CONTEXT)).toHaveLength(1);

    // A year later, the ask channel would have resolved to its
    // recommendation twice over. The permission queue does not know what a
    // deadline is: the row is still there, still unanswered, nothing has
    // answered on the person's behalf, and no default verdict appeared.
    vi.setSystemTime(new Date("2027-09-05T12:00:00Z"));
    const stillWaiting = approvals.list(AUTH_CONTEXT);
    expect(stillWaiting).toHaveLength(1);
    expect(stillWaiting[0]?.decision.reason).toBe(DECISION.reason);
  });
});

describe("a question settles once", () => {
  it("refuses a second answer to a question already answered", () => {
    // The store reads by id and returns settled rows, because a settled row
    // is the record of a decision. Two windows racing on the same question
    // must not both be told theirs was the answer taken.
    const database = open();
    const broker = new QuestionBroker({ store: new PendingQuestionStore(database) });
    void broker.ask(CONVERSATION, [payload()], undefined);
    const id = broker.list(AUTH_CONTEXT)[0]?.id ?? "";

    expect(broker.answer(id, { optionIds: ["sqlite"], deferred: false }, AUTH_CONTEXT)).toBe(true);
    expect(broker.answer(id, { optionIds: ["postgres"], deferred: false }, AUTH_CONTEXT)).toBe(
      false,
    );

    // And the first answer is the one that stands.
    expect(new PendingQuestionStore(database).get(id)?.answer?.optionIds).toEqual(["sqlite"]);
  });

  it("refuses an answer to a question that has already timed out", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));

    const database = open();
    const broker = new QuestionBroker({ store: new PendingQuestionStore(database) });
    void broker.ask(CONVERSATION, [payload({ recommendedOptionId: "sqlite" })], 60_000);
    const id = broker.list(AUTH_CONTEXT)[0]?.id ?? "";

    // The deadline passes. The recommendation is what the model was given,
    // so a choice arriving afterwards cannot be recorded as the answer.
    vi.setSystemTime(new Date("2026-09-05T12:05:00Z"));
    expect(broker.answer(id, { optionIds: ["postgres"], deferred: false }, AUTH_CONTEXT)).toBe(
      false,
    );

    const settled = new PendingQuestionStore(database).get(id);
    expect(settled?.outcome).toBe("timed_out");
    expect(settled?.answer?.optionIds).toEqual(["sqlite"]);
  });

  it("will not withdraw a question that was already answered", () => {
    // A cancel is what an aborted run does to its own open questions. Aimed
    // at a settled row it would delete the record of a decision the person
    // actually made, which is the one thing this table must never lose.
    const database = open();
    const broker = new QuestionBroker({ store: new PendingQuestionStore(database) });
    void broker.ask(CONVERSATION, [payload()], undefined);
    const id = broker.list(AUTH_CONTEXT)[0]?.id ?? "";

    expect(broker.answer(id, { optionIds: ["sqlite"], deferred: false }, AUTH_CONTEXT)).toBe(true);
    expect(broker.cancel(id, AUTH_CONTEXT)).toBe(false);
    expect(new PendingQuestionStore(database).get(id)?.outcome).toBe("answered");
  });
});
