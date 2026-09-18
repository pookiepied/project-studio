import { TextDecoder, TextEncoder } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STREAM_HEARTBEAT_INTERVAL_MS,
  heartbeats,
} from "../../src/transport/http/sse-heartbeat.js";

/**
 * The beat, against an upstream that does not cooperate with it.
 *
 * Everything here is timed, because the whole point of this module is that a
 * silent upstream still produces bytes — so the suites run on fake timers and
 * advance the clock themselves. The upstream is a bare ReadableStream whose
 * controller each test holds, which makes "says nothing", "closes", "fails"
 * and "is cancelled" all one-line facts.
 */

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function silentUpstream(): {
  stream: ReadableStream<Uint8Array>;
  controller: ReadableStreamDefaultController<Uint8Array>;
  cancelled: () => boolean;
} {
  let cancelled = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(own) {
      controller = own;
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, controller: controller!, cancelled: () => cancelled };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the keep-alive a silent stream owes its reader", () => {
  it("passes the upstream's bytes through untouched, in order", async () => {
    vi.useFakeTimers();
    const upstream = silentUpstream();
    const wrapped = heartbeats(upstream.stream, STREAM_HEARTBEAT_INTERVAL_MS);
    const reader = wrapped.getReader();
    upstream.controller.enqueue(encoder.encode("event: control\n"));
    upstream.controller.enqueue(encoder.encode('data: {"upToDate":true}\n\n'));

    expect(decoder.decode((await reader.read()).value)).toBe("event: control\n");
    expect(decoder.decode((await reader.read()).value)).toBe(
      'data: {"upToDate":true}\n\n',
    );
    await reader.cancel();
  });

  it("leaves a comment when the upstream goes quiet, and another when it stays quiet", async () => {
    vi.useFakeTimers();
    const upstream = silentUpstream();
    const wrapped = heartbeats(upstream.stream, STREAM_HEARTBEAT_INTERVAL_MS);
    const reader = wrapped.getReader();
    const firstBeat = reader.read();
    const secondBeat = reader.read();

    await vi.advanceTimersByTimeAsync(STREAM_HEARTBEAT_INTERVAL_MS);
    expect(decoder.decode((await firstBeat).value)).toBe(": keep-alive\n\n");
    await vi.advanceTimersByTimeAsync(STREAM_HEARTBEAT_INTERVAL_MS);
    expect(decoder.decode((await secondBeat).value)).toBe(": keep-alive\n\n");

    await reader.cancel();
  });

  it("beats for exactly as long as the stream lives, and not past its end", async () => {
    vi.useFakeTimers();
    const upstream = silentUpstream();
    const wrapped = heartbeats(upstream.stream, STREAM_HEARTBEAT_INTERVAL_MS);
    const reader = wrapped.getReader();
    const beat = reader.read();
    await vi.advanceTimersByTimeAsync(STREAM_HEARTBEAT_INTERVAL_MS);
    expect((await beat).done).toBe(false);

    upstream.controller.close();
    expect((await reader.read()).done).toBe(true);
    // Past the end there is nothing: the interval retired with the stream,
    // and a reader that keeps reading only ever reads the end.
    await vi.advanceTimersByTimeAsync(STREAM_HEARTBEAT_INTERVAL_MS * 10);
    expect((await reader.read()).done).toBe(true);
  });

  it("ends the upstream when the consumer cancels, without failing anything", async () => {
    vi.useFakeTimers();
    const upstream = silentUpstream();
    const wrapped = heartbeats(upstream.stream, STREAM_HEARTBEAT_INTERVAL_MS);
    const reader = wrapped.getReader();
    const beat = reader.read();
    await vi.advanceTimersByTimeAsync(STREAM_HEARTBEAT_INTERVAL_MS);
    await beat;

    await reader.cancel();
    expect(upstream.cancelled()).toBe(true);
    // The retired interval must not rise again as an unhandled enqueue.
    await vi.advanceTimersByTimeAsync(STREAM_HEARTBEAT_INTERVAL_MS * 10);
  });

  it("carries the upstream's failure to the consumer and stops the beat", async () => {
    vi.useFakeTimers();
    const upstream = silentUpstream();
    const wrapped = heartbeats(upstream.stream, STREAM_HEARTBEAT_INTERVAL_MS);
    const reader = wrapped.getReader();
    const beat = reader.read();
    await vi.advanceTimersByTimeAsync(STREAM_HEARTBEAT_INTERVAL_MS);
    await beat;

    upstream.controller.error(new Error("the run's writer went away"));
    await expect(reader.read()).rejects.toThrow("the run's writer went away");
    await vi.advanceTimersByTimeAsync(STREAM_HEARTBEAT_INTERVAL_MS * 10);
  });
});
