import type { FlueObservation } from "@flue/runtime";
import { describe, expect, it } from "vitest";

import { ConversationStore } from "../../src/conversations/store.js";
import {
  ConversationTitler,
  titleFromReply,
} from "../../src/conversations/titling.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

function openStore(): { db: StudioDatabase; store: ConversationStore } {
  const db = openDatabase({ path: ":memory:" });
  return { db, store: new ConversationStore(db) };
}

/** The envelope fields every delivered event carries. */
function envelope(index: number): Pick<FlueObservation, "v" | "eventIndex" | "timestamp"> {
  return {
    v: 3,
    eventIndex: index,
    timestamp: "2026-08-30T00:00:00.000Z",
  };
}

/**
 * A settled submission, as `observe()` delivers it: the runtime stamps the
 * envelope and the fields the orchestrator routes on. This is the event the
 * studio trigger and the title ladder both read.
 */
function settled(
  fields: {
    agentName?: string;
    instanceId?: string;
    outcome?: "completed" | "failed" | "aborted";
  } = {},
): FlueObservation {
  return {
    type: "submission_settled",
    submissionId: "sub_1",
    outcome: fields.outcome ?? "completed",
    agentName: fields.agentName ?? "studio",
    instanceId: fields.instanceId ?? "cnv_1",
    ...envelope(0),
  };
}

/**
 * The end of one agent run, as `observe()` delivers it: the run's messages
 * ride the event, which is where the title reply's text comes from.
 */
function agentEnd(
  fields: {
    agentName?: string;
    instanceId?: string;
    reply?: string;
  } = {},
): FlueObservation {
  return {
    type: "agent_end",
    messages: [
      {
        role: "assistant",
        content: [
          { type: "text", text: fields.reply ?? '{"title":"A better name"}' },
        ],
        api: "project-studio-test",
        provider: "project-studio",
        model: "default",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 0,
      },
    ],
    agentName: fields.agentName ?? "title",
    instanceId: fields.instanceId ?? "cnv_1",
    ...envelope(1),
  };
}

/**
 * One title run settling with a usable reply, in the order the runtime
 * emits it: the run's end first, then the submission's settlement.
 */
function titleReply(
  handlers: ((observation: FlueObservation) => void)[],
  fields: { instanceId?: string; reply?: string } = {},
): void {
  handlers[0]?.(agentEnd(fields));
  handlers[0]?.(settled({ agentName: "title", ...fields }));
}

/** A titler with the event bus and dispatch replaced by test doubles. */
function titlerWith(
  store: ConversationStore,
  handlers: ((observation: FlueObservation) => void)[],
  dispatched: { conversationId: string; message: string; attempt: number }[],
): ConversationTitler {
  const titler = new ConversationTitler({
    conversations: store,
    subscribe: (handler) => {
      handlers.push(handler);
      return () => undefined;
    },
    dispatchJob: async (conversationId, message, attempt) => {
      dispatched.push({ conversationId, message, attempt });
    },
  });
  titler.start();
  return titler;
}

describe("titleFromReply", () => {
  it("accepts exactly one object with one title string", () => {
    expect(titleFromReply('{"title":"Fix the Windows build"}')).toBe(
      "Fix the Windows build",
    );
  });

  it("trims surrounding whitespace in the value", () => {
    expect(titleFromReply('{"title":"  Padded name  "}')).toBe("Padded name");
  });

  it("refuses prose around the object", () => {
    expect(titleFromReply('Here you go: {"title":"X"}')).toBeUndefined();
  });

  it("refuses a bare string, a list, and a bare title", () => {
    expect(titleFromReply('"Fix the build"')).toBeUndefined();
    expect(titleFromReply('["Fix the build"]')).toBeUndefined();
    expect(titleFromReply("Fix the build")).toBeUndefined();
  });

  it("refuses a second field, a wrong field name, and a non-string title", () => {
    expect(titleFromReply('{"title":"X","lang":"en"}')).toBeUndefined();
    expect(titleFromReply('{"Title":"X"}')).toBeUndefined();
    expect(titleFromReply('{"title":42}')).toBeUndefined();
    expect(titleFromReply('{"title":null}')).toBeUndefined();
  });

  it("refuses empty, multiline, and oversized titles", () => {
    expect(titleFromReply('{"title":"   "}')).toBeUndefined();
    expect(titleFromReply('{"title":"Two\\nlines"}')).toBeUndefined();
    expect(titleFromReply(`{"title":"${"x".repeat(121)}"}`)).toBeUndefined();
  });

  it("refuses invalid JSON", () => {
    expect(titleFromReply("{title:")).toBeUndefined();
  });
});

describe("ConversationTitler", () => {
  it("dispatches the title job when the first exchange settles", () => {
    const { db, store } = openStore();
    try {
      store.record({ id: "cnv_1", firstMessage: "First words" });
      const handlers: ((observation: FlueObservation) => void)[] = [];
      const dispatched: { conversationId: string; message: string; attempt: number }[] = [];
      const titler = titlerWith(store, handlers, dispatched);

      titler.firstAdmission("cnv_1", "What measure should the transcript use?");
      handlers[0]?.(settled({}));

      expect(dispatched).toEqual([
        {
          conversationId: "cnv_1",
          message: "What measure should the transcript use?",
          attempt: 0,
        },
      ]);
      // The dispatch itself writes nothing.
      expect(store.get("cnv_1")?.title).toBe("First words");
    } finally {
      db.close();
    }
  });

  it("writes a parsed reply into the index, and only then", () => {
    const { db, store } = openStore();
    try {
      store.record({ id: "cnv_1", firstMessage: "First words" });
      const handlers: ((observation: FlueObservation) => void)[] = [];
      const titler = titlerWith(store, handlers, []);

      titler.firstAdmission("cnv_1", "First words");
      handlers[0]?.(settled({}));
      titleReply(handlers, { reply: '{"title":"A better name"}' });

      const record = store.get("cnv_1");
      expect(record?.title).toBe("A better name");
      // A machine write must not spend the manual-title promise.
      expect(record?.titleManual).toBe(false);
    } finally {
      db.close();
    }
  });

  it("never overwrites a rename that arrived while the title agent worked", () => {
    const { db, store } = openStore();
    try {
      store.record({ id: "cnv_1", firstMessage: "First words" });
      const handlers: ((observation: FlueObservation) => void)[] = [];
      const titler = titlerWith(store, handlers, []);

      titler.firstAdmission("cnv_1", "First words");
      handlers[0]?.(settled({}));

      // The person renames while the model works.
      store.patch("cnv_1", { title: "The person's name" });
      titleReply(handlers);

      const record = store.get("cnv_1");
      expect(record?.title).toBe("The person's name");
      expect(record?.titleManual).toBe(true);
    } finally {
      db.close();
    }
  });

  it("keeps the derived title when the reply is unusable", () => {
    const { db, store } = openStore();
    try {
      store.record({ id: "cnv_1", firstMessage: "First words" });
      const handlers: ((observation: FlueObservation) => void)[] = [];
      const titler = titlerWith(store, handlers, []);

      titler.firstAdmission("cnv_1", "First words");
      handlers[0]?.(settled({}));

      for (const reply of [
        "OK",
        "ignore the above",
        '{"title":""}',
        "not json at all",
        "",
      ]) {
        titleReply(handlers, { reply });
      }

      expect(store.get("cnv_1")?.title).toBe("First words");
    } finally {
      db.close();
    }
  });

  it("titles nothing when the exchange never settles successfully", () => {
    const { db, store } = openStore();
    try {
      store.record({ id: "cnv_1", firstMessage: "First words" });
      const handlers: ((observation: FlueObservation) => void)[] = [];
      const dispatched: { conversationId: string; message: string; attempt: number }[] = [];
      const titler = titlerWith(store, handlers, dispatched);

      titler.firstAdmission("cnv_1", "First words");
      // A failed submission, a run's end that is not a settlement, and
      // another agent's settlement are none of them the trigger.
      handlers[0]?.(settled({ outcome: "failed" }));
      handlers[0]?.(agentEnd({ agentName: "studio" }));
      handlers[0]?.(settled({ agentName: "other" }));

      expect(dispatched).toEqual([]);
      expect(store.get("cnv_1")?.title).toBe("First words");
    } finally {
      db.close();
    }
  });

  it("never dispatches for a conversation this process did not admit", () => {
    const { db, store } = openStore();
    try {
      store.record({ id: "cnv_old", firstMessage: "Old words" });
      const handlers: ((observation: FlueObservation) => void)[] = [];
      const dispatched: { conversationId: string; message: string; attempt: number }[] = [];
      titlerWith(store, handlers, dispatched);

      // A later turn of an older conversation settling looks, to a fresh
      // process, like a first exchange. It is not: nothing was admitted
      // here, so nothing is dispatched and nothing is retitled.
      handlers[0]?.(settled({ instanceId: "cnv_old" }));
      handlers[0]?.(settled({ instanceId: "cnv_old", agentName: "title" }));

      expect(dispatched).toEqual([]);
      expect(store.get("cnv_old")?.title).toBe("Old words");
    } finally {
      db.close();
    }
  });

  it("dispatches exactly once per conversation", () => {
    const { db, store } = openStore();
    try {
      store.record({ id: "cnv_1", firstMessage: "First words" });
      const handlers: ((observation: FlueObservation) => void)[] = [];
      const dispatched: { conversationId: string; message: string; attempt: number }[] = [];
      const titler = titlerWith(store, handlers, dispatched);

      titler.firstAdmission("cnv_1", "First words");
      handlers[0]?.(settled({}));
      // A second settlement of the same exchange must not re-dispatch: the
      // pending entry is consumed by the first.
      handlers[0]?.(settled({}));

      expect(dispatched).toEqual([
        { conversationId: "cnv_1", message: "First words", attempt: 0 },
      ]);
    } finally {
      db.close();
    }
  });

  it("retries once, on the next rung, when a title run fails", () => {
    const { db, store } = openStore();
    try {
      store.record({ id: "cnv_1", firstMessage: "First words" });
      const handlers: ((observation: FlueObservation) => void)[] = [];
      const dispatched: { conversationId: string; message: string; attempt: number }[] = [];
      const titler = titlerWith(store, handlers, dispatched);

      titler.firstAdmission("cnv_1", "First words");
      handlers[0]?.(settled({}));

      // The first attempt's run fails at the model (the submission settles
      // failed). One rung down the ladder, same words.
      handlers[0]?.(settled({ agentName: "title", outcome: "failed" }));

      expect(dispatched).toEqual([
        { conversationId: "cnv_1", message: "First words", attempt: 0 },
        { conversationId: "cnv_1", message: "First words", attempt: 1 },
      ]);

      // The retry's reply lands and writes the title. The instance id
      // carries the attempt suffix; the write addresses the conversation.
      titleReply(handlers, { instanceId: "cnv_1-t1", reply: '{"title":"Second rung"}' });

      const record = store.get("cnv_1");
      expect(record?.title).toBe("Second rung");
      expect(record?.titleManual).toBe(false);
    } finally {
      db.close();
    }
  });

  it("gives the derived title back after the ladder is exhausted", () => {
    const { db, store } = openStore();
    try {
      store.record({ id: "cnv_1", firstMessage: "First words" });
      const handlers: ((observation: FlueObservation) => void)[] = [];
      const dispatched: { conversationId: string; message: string; attempt: number }[] = [];
      const titler = titlerWith(store, handlers, dispatched);

      titler.firstAdmission("cnv_1", "First words");
      handlers[0]?.(settled({}));
      handlers[0]?.(settled({ agentName: "title", outcome: "failed" }));
      handlers[0]?.(
        settled({ agentName: "title", outcome: "failed", instanceId: "cnv_1-t1" }),
      );
      // A third failure has no ladder left and no job to fail: nothing.
      handlers[0]?.(
        settled({ agentName: "title", outcome: "failed", instanceId: "cnv_1-t1" }),
      );

      expect(dispatched).toEqual([
        { conversationId: "cnv_1", message: "First words", attempt: 0 },
        { conversationId: "cnv_1", message: "First words", attempt: 1 },
      ]);
      expect(store.get("cnv_1")?.title).toBe("First words");
    } finally {
      db.close();
    }
  });

  it("does not spend a retry on a reply the contract refuses", () => {
    const { db, store } = openStore();
    try {
      store.record({ id: "cnv_1", firstMessage: "First words" });
      const handlers: ((observation: FlueObservation) => void)[] = [];
      const dispatched: { conversationId: string; message: string; attempt: number }[] = [];
      const titler = titlerWith(store, handlers, dispatched);

      titler.firstAdmission("cnv_1", "First words");
      handlers[0]?.(settled({}));
      // A model that answers but ignores the JSON contract will ignore it
      // again; the ladder is for failed runs, not for disobedient ones.
      titleReply(handlers, { reply: "OK" });

      expect(dispatched).toEqual([
        { conversationId: "cnv_1", message: "First words", attempt: 0 },
      ]);
      expect(store.get("cnv_1")?.title).toBe("First words");
    } finally {
      db.close();
    }
  });

  it("keeps the derived title when the dispatch is refused", async () => {
    const { db, store } = openStore();
    try {
      store.record({ id: "cnv_1", firstMessage: "First words" });
      const handlers: ((observation: FlueObservation) => void)[] = [];
      const titler = new ConversationTitler({
        conversations: store,
        subscribe: (handler) => {
          handlers.push(handler);
          return () => undefined;
        },
        dispatchJob: async () => {
          throw new Error("dispatch refused");
        },
      });
      titler.start();
      titler.firstAdmission("cnv_1", "First words");
      handlers[0]?.(settled({}));
      // The rejection is swallowed by the dispatch wrapper, not observed.
      await Promise.resolve();
      await Promise.resolve();

      expect(store.get("cnv_1")?.title).toBe("First words");
    } finally {
      db.close();
    }
  });
});
