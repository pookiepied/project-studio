import { describe, expect, it } from "vitest";

import {
  parseSseBlock,
  parseSseFrames,
  type SseFrame,
} from "../../src/models/studio-cloud/sse-parser.js";

/**
 * Builds a stream that delivers exactly the given chunks, so a frame can be cut
 * at a chosen byte. Network chunk boundaries are arbitrary, and the bugs live
 * at the boundaries rather than in the parsing.
 */
function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: readonly string[]): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  for await (const frame of parseSseFrames(streamOf(chunks))) frames.push(frame);
  return frames;
}

describe("reading a block", () => {
  it("keeps the event name with its data", async () => {
    expect(parseSseBlock("event: message\ndata: hello")).toEqual({
      event: "message",
      data: "hello",
    });
  });

  it("joins multi-line data with newlines, as the spec requires", () => {
    expect(parseSseBlock("data: one\ndata: two")?.data).toBe("one\ntwo");
  });

  it("ignores comment lines", () => {
    expect(parseSseBlock(": keep-alive\ndata: hello")?.data).toBe("hello");
  });

  it("drops a block with no data, which is what a keep-alive is", () => {
    expect(parseSseBlock(": keep-alive")).toBeUndefined();
    expect(parseSseBlock("event: ping")).toBeUndefined();
  });
});

describe("chunk boundaries", () => {
  it("reads whole frames", async () => {
    const frames = await collect(["event: a\ndata: 1\n\nevent: b\ndata: 2\n\n"]);

    expect(frames).toEqual([
      { event: "a", data: "1" },
      { event: "b", data: "2" },
    ]);
  });

  it("joins a frame split anywhere in the middle", async () => {
    const frames = await collect(["event: a\nda", "ta: 1\n\n"]);

    expect(frames).toEqual([{ event: "a", data: "1" }]);
  });

  it("keeps a CRLF frame whole when the chunk ends on the carriage return", async () => {
    // The failure this exists for: a lone trailing `\r` used to be rewritten to
    // `\n` before its `\n` arrived, so one line break became two. The frame
    // split, and the first half had no `data:` line — so it was dropped, taking
    // the `event:` name with it.
    const frames = await collect(["event: a\r\ndata: 1\r", "\n\r\n"]);

    expect(frames).toEqual([{ event: "a", data: "1" }]);
  });

  it("survives a CRLF cut at every position in the stream", async () => {
    // One cut position is a guess about where the network splits. Every
    // position is not.
    const payload = "event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2\r\n\r\n";

    for (let cut = 1; cut < payload.length; cut += 1) {
      const frames = await collect([payload.slice(0, cut), payload.slice(cut)]);
      expect(frames, `cut at ${cut}`).toEqual([
        { event: "a", data: "1" },
        { event: "b", data: "2" },
      ]);
    }
  });

  it("reads a stream that uses lone carriage returns as line breaks", async () => {
    expect(await collect(["event: a\rdata: 1\r\r"])).toEqual([
      { event: "a", data: "1" },
    ]);
  });

  it("discards a truncated trailing frame rather than emitting half of it", async () => {
    expect(await collect(["event: a\ndata: 1\n\nevent: b\ndata: par"])).toEqual([
      { event: "a", data: "1" },
    ]);
  });

  it("handles a multi-byte character split across chunks", async () => {
    // TextDecoder is in streaming mode for this reason; a half-decoded
    // character would corrupt the data silently.
    const encoder = new TextEncoder();
    const bytes = encoder.encode("data: é\n\n");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 7));
        controller.enqueue(bytes.slice(7));
        controller.close();
      },
    });

    const frames: SseFrame[] = [];
    for await (const frame of parseSseFrames(stream)) frames.push(frame);

    expect(frames).toEqual([{ event: undefined, data: "é" }]);
  });
});
