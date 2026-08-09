import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessageEvent,
  type Model,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { StudioPiEventMapper } from "../../src/models/studio-cloud/event-mapper.js";

/**
 * The event protocol is a set of promises: every `start` is followed by an
 * `end`, and the turn settles exactly once. These test the promises the
 * consumer relies on, not the mapper's internals.
 */

const MODEL = { id: "test-model" } as Model<Api>;

/** A real stream, with every event it is given kept for inspection. */
function mapper(): { mapper: StudioPiEventMapper; seen: AssistantMessageEvent[] } {
  const events = createAssistantMessageEventStream();
  const seen: AssistantMessageEvent[] = [];
  const push = events.push.bind(events);
  events.push = (event: AssistantMessageEvent) => {
    seen.push(event);
    push(event);
  };

  return {
    mapper: new StudioPiEventMapper({
      events,
      model: MODEL,
      api: "test-api",
      provider: "studio",
    }),
    seen,
  };
}

const types = (seen: AssistantMessageEvent[]): string[] => seen.map((event) => event.type);

describe("the stream event mapper closes what it opens", () => {
  it("closes an open text block when the stream fails", () => {
    // A UI opens a bubble on `text_start` and closes it on `text_end`. Without
    // the end it streams forever, next to an error the user has already read.
    const { mapper: map, seen } = mapper();

    map.handle({ type: "content", chunk: "half a sen" });
    map.fail(new Error("connection lost"));

    expect(types(seen)).toEqual(["start", "text_start", "text_delta", "text_end", "error"]);
  });

  it("closes an open thinking block when the stream is aborted", () => {
    const { mapper: map, seen } = mapper();

    map.handle({ type: "reasoning", chunk: "considering" });
    map.fail(new Error("cancelled"), "aborted");

    expect(types(seen)).toEqual([
      "start",
      "thinking_start",
      "thinking_delta",
      "thinking_end",
      "error",
    ]);
  });

  it("keeps the partial text in the message it failed with", () => {
    const { mapper: map, seen } = mapper();

    map.handle({ type: "content", chunk: "half a sen" });
    map.fail(new Error("connection lost"));

    const failure = seen.at(-1);
    expect(failure?.type).toBe("error");
    if (failure?.type === "error") {
      expect(failure.error.content).toEqual([{ type: "text", text: "half a sen" }]);
    }
  });

  it("does not close a block twice when a completed turn reports an error", () => {
    // `complete()` closes the block and then delegates to `fail()`. The second
    // close must be a no-op, or the consumer sees two ends for one start.
    const { mapper: map, seen } = mapper();

    map.handle({ type: "content", chunk: "done" });
    map.handle({ type: "model.completed", finishReason: "error" });
    map.complete();

    expect(types(seen)).toEqual(["start", "text_start", "text_delta", "text_end", "error"]);
  });

  it("emits nothing more after it has settled", () => {
    const { mapper: map, seen } = mapper();

    map.handle({ type: "content", chunk: "hello" });
    map.complete();
    const after = seen.length;

    map.handle({ type: "content", chunk: "ignored" });
    map.fail(new Error("too late"));

    expect(seen.length).toBe(after);
  });
});
