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

/**
 * A settled prompt operation, as `observe()` delivers it: the runtime stamps
 * the envelope (`v`, `eventIndex`, `timestamp`) and the live detail; only
 * the fields the orchestrator reads are named here.
 */
function observation(
  fields: {
    agentName?: string;
    instanceId?: string;
    isError?: boolean;
    operationKind?: "prompt" | "skill" | "task" | "shell" | "compact";
    result?: unknown;
  } = {},
): FlueObservation {
  return {
    type: "operation",
    operationKind: fields.operationKind ?? "prompt",
    isError: fields.isError ?? false,
    durationMs: 1,
    operationId: "op_1",
    agentName: fields.agentName ?? "studio",
    instanceId: fields.instanceId ?? "cnv_1",
    ...(fields.result === undefined ? {} : { result: fields.result }),
    v: 3,
    eventIndex: 0,
    timestamp: "2026-08-30T00:00:00.000Z",
  };
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
      handlers[0]?.(observation({}));

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
      handlers[0]?.(observation({}));
      handlers[0]?.(
        observation({
          agentName: "title",
          result: { text: '{"title":"A better name"}' },
        }),
      );

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
      handlers[0]?.(observation({}));

      // The person renames while the model works.
      store.patch("cnv_1", { title: "The person's name" });
      handlers[0]?.(
        observation({
          agentName: "title",
          result: { text: '{"title":"A better name"}' },
        }),
      );

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
      handlers[0]?.(observation({}));

      for (const reply of [
        "OK",
        "ignore the above",
        '{"title":""}',
        "not json at all",
        "",
      ]) {
        handlers[0]?.(
          observation({ agentName: "title", result: { text: reply } }),
        );
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
      handlers[0]?.(observation({ isError: true }));
      handlers[0]?.(observation({ operationKind: "shell" }));
      handlers[0]?.(observation({ agentName: "other" }));

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
      handlers[0]?.(observation({ instanceId: "cnv_old" }));
      handlers[0]?.(
        observation({ instanceId: "cnv_old", agentName: "title" }),
      );

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
      handlers[0]?.(observation({}));
      handlers[0]?.(observation({}));

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
      handlers[0]?.(observation({}));

      // The first attempt's run fails at the model (the operation settles
      // with an error). One rung down the ladder, same words.
      handlers[0]?.(observation({ agentName: "title", isError: true }));

      expect(dispatched).toEqual([
        { conversationId: "cnv_1", message: "First words", attempt: 0 },
        { conversationId: "cnv_1", message: "First words", attempt: 1 },
      ]);

      // The retry's reply lands and writes the title. The instance id
      // carries the attempt suffix; the write addresses the conversation.
      handlers[0]?.(
        observation({
          agentName: "title",
          instanceId: "cnv_1-t1",
          result: { text: '{"title":"Second rung"}' },
        }),
      );

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
      handlers[0]?.(observation({}));
      handlers[0]?.(observation({ agentName: "title", isError: true }));
      handlers[0]?.(
        observation({ agentName: "title", isError: true, instanceId: "cnv_1-t1" }),
      );
      // A third failure has no ladder left and no job to fail: nothing.
      handlers[0]?.(
        observation({ agentName: "title", isError: true, instanceId: "cnv_1-t1" }),
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
      handlers[0]?.(observation({}));
      // A model that answers but ignores the JSON contract will ignore it
      // again; the ladder is for failed runs, not for disobedient ones.
      handlers[0]?.(
        observation({ agentName: "title", result: { text: "OK" } }),
      );

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
      handlers[0]?.(observation({}));
      // The rejection is swallowed by the dispatch wrapper, not observed.
      await Promise.resolve();
      await Promise.resolve();

      expect(store.get("cnv_1")?.title).toBe("First words");
    } finally {
      db.close();
    }
  });
});
