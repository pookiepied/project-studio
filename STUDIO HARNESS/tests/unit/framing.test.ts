import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_MESSAGE_BYTES,
  encodeNdjson,
  NdjsonDecoder,
} from "../../src/extend/mcp/wire/framing.js";

describe("NDJSON framing", () => {
  describe("a chunk completes only the messages it terminates", () => {
    it("returns nothing when the chunk has no newline", () => {
      const decoder = new NdjsonDecoder();
      expect(decoder.feed('{"a":1')).toEqual([]);
    });

    it("withholds the remainder until the next chunk supplies the newline", () => {
      const decoder = new NdjsonDecoder();
      expect(decoder.feed('{"a":1')).toEqual([]);
      const out = decoder.feed("}\n");
      expect(out).toEqual([{ ok: true, value: { a: 1 } }]);
    });

    it("reassembles a message split across any number of chunks", () => {
      const decoder = new NdjsonDecoder();
      expect(decoder.feed('{"a":')).toEqual([]);
      expect(decoder.feed('"hel')).toEqual([]);
      expect(decoder.feed('lo"}\n')).toEqual([{ ok: true, value: { a: "hello" } }]);
    });
  });

  describe("several messages in one chunk", () => {
    it("emits them all in order", () => {
      const decoder = new NdjsonDecoder();
      const out = decoder.feed('{"a":1}\n{"b":2}\n{"c":3}\n');
      expect(out).toEqual([
        { ok: true, value: { a: 1 } },
        { ok: true, value: { b: 2 } },
        { ok: true, value: { c: 3 } },
      ]);
    });

    it("handles a chunk that ends mid-message and continues in the next", () => {
      const decoder = new NdjsonDecoder();
      const first = decoder.feed('{"a":1}\n{"b":');
      expect(first).toEqual([{ ok: true, value: { a: 1 } }]);
      const second = decoder.feed('2}\n');
      expect(second).toEqual([{ ok: true, value: { b: 2 } }]);
    });
  });

  describe("string and Buffer chunks", () => {
    it("accepts a string chunk", () => {
      const decoder = new NdjsonDecoder();
      expect(decoder.feed('{"a":1}\n')).toEqual([{ ok: true, value: { a: 1 } }]);
    });

    it("accepts a Buffer chunk", () => {
      const decoder = new NdjsonDecoder();
      expect(decoder.feed(Buffer.from('{"a":1}\n'))).toEqual([
        { ok: true, value: { a: 1 } },
      ]);
    });

    it("accepts a Uint8Array chunk", () => {
      const decoder = new NdjsonDecoder();
      const bytes = new TextEncoder().encode('{"a":1}\n');
      expect(decoder.feed(bytes)).toEqual([{ ok: true, value: { a: 1 } }]);
    });

    it("mixes string and Buffer chunks for one message", () => {
      const decoder = new NdjsonDecoder();
      expect(decoder.feed(Buffer.from('{"a":'))).toEqual([]);
      expect(decoder.feed('1}\n')).toEqual([{ ok: true, value: { a: 1 } }]);
    });
  });

  describe("multi-byte UTF-8 split across a chunk boundary", () => {
    it("does not corrupt a two-byte character", () => {
      const decoder = new NdjsonDecoder();
      // "é" is two bytes in UTF-8; cutting between them with per-chunk
      // toString would produce a replacement character.
      const line = JSON.stringify({ text: "é" }) + "\n";
      const bytes = new TextEncoder().encode(line);
      // "é" bytes are at the end of the JSON; find a split inside the
      // character rather than at a character boundary.
      const encodedE = new TextEncoder().encode("é");
      // The JSON string contains "é" — locate its bytes in the full line.
      const eIndex = bytes.indexOf(encodedE[0] ?? 0);
      const cut = eIndex + 1;
      const first = bytes.slice(0, cut);
      const second = bytes.slice(cut);
      expect(decoder.feed(first)).toEqual([]);
      const out = decoder.feed(second);
      expect(out).toEqual([{ ok: true, value: { text: "é" } }]);
    });

    it("does not corrupt a four-byte character", () => {
      const decoder = new NdjsonDecoder();
      const line = JSON.stringify({ emoji: "😀" }) + "\n";
      const bytes = new TextEncoder().encode(line);
      // Split in the middle of the four-byte sequence.
      const encoded = new TextEncoder().encode("😀");
      let cut = -1;
      for (let i = 0; i < bytes.length - 1; i += 1) {
        // Find the start of the emoji bytes.
        if (
          bytes[i] === encoded[0] &&
          bytes[i + 1] === encoded[1]
        ) {
          cut = i + 2;
          break;
        }
      }
      expect(cut).toBeGreaterThan(0);
      const first = bytes.slice(0, cut);
      const second = bytes.slice(cut);
      expect(decoder.feed(first)).toEqual([]);
      const out = decoder.feed(second);
      expect(out).toEqual([{ ok: true, value: { emoji: "😀" } }]);
    });

    it("handles a three-byte character split across three chunks", () => {
      const decoder = new NdjsonDecoder();
      // "€" is three bytes: 0xe2 0x82 0xac
      const line = JSON.stringify({ cur: "€" }) + "\n";
      const bytes = new TextEncoder().encode(line);
      const encoded = new TextEncoder().encode("€");
      let start = -1;
      for (let i = 0; i < bytes.length; i += 1) {
        if (bytes[i] === encoded[0]) {
          start = i;
          break;
        }
      }
      expect(start).toBeGreaterThan(-1);
      const a = bytes.slice(0, start + 1);
      const b = bytes.slice(start + 1, start + 2);
      const c = bytes.slice(start + 2);
      expect(decoder.feed(a)).toEqual([]);
      expect(decoder.feed(b)).toEqual([]);
      const out = decoder.feed(c);
      expect(out).toEqual([{ ok: true, value: { cur: "€" } }]);
    });
  });

  describe("empty lines", () => {
    it("skips empty lines", () => {
      const decoder = new NdjsonDecoder();
      expect(decoder.feed("\n\n")).toEqual([]);
    });

    it("skips empty lines between messages", () => {
      const decoder = new NdjsonDecoder();
      const out = decoder.feed('\n{"a":1}\n\n{"b":2}\n\n');
      expect(out).toEqual([
        { ok: true, value: { a: 1 } },
        { ok: true, value: { b: 2 } },
      ]);
    });

    it("skips empty lines that are \\r\\n", () => {
      const decoder = new NdjsonDecoder();
      const out = decoder.feed('\r\n{"a":1}\r\n\r\n');
      expect(out).toEqual([{ ok: true, value: { a: 1 } }]);
    });
  });

  describe("line endings", () => {
    it("terminates a line with \\n", () => {
      const decoder = new NdjsonDecoder();
      expect(decoder.feed('{"a":1}\n')).toEqual([{ ok: true, value: { a: 1 } }]);
    });

    it("terminates a line with \\r\\n and strips the \\r", () => {
      const decoder = new NdjsonDecoder();
      expect(decoder.feed('{"a":1}\r\n')).toEqual([{ ok: true, value: { a: 1 } }]);
    });

    it("handles mixed terminators in one chunk", () => {
      const decoder = new NdjsonDecoder();
      const out = decoder.feed('{"a":1}\n{"b":2}\r\n{"c":3}\n');
      expect(out).toEqual([
        { ok: true, value: { a: 1 } },
        { ok: true, value: { b: 2 } },
        { ok: true, value: { c: 3 } },
      ]);
    });

    it("handles \\r\\n split across chunks", () => {
      const decoder = new NdjsonDecoder();
      expect(decoder.feed('{"a":1}\r')).toEqual([]);
      const out = decoder.feed('\n{"b":2}\n');
      expect(out).toEqual([
        { ok: true, value: { a: 1 } },
        { ok: true, value: { b: 2 } },
      ]);
    });
  });

  describe("malformed JSON", () => {
    it("does not throw on a malformed line", () => {
      const decoder = new NdjsonDecoder();
      expect(() => decoder.feed("not json\n")).not.toThrow();
    });

    it("reports a malformed line and continues", () => {
      const decoder = new NdjsonDecoder();
      const out = decoder.feed('{"a":1}\nnot json\n{"b":2}\n');
      expect(out.length).toBe(3);
      expect(out[0]).toEqual({ ok: true, value: { a: 1 } });
      expect(out[1]?.ok).toBe(false);
      if (out[1]?.ok === false) {
        expect(out[1].raw).toBe("not json");
        expect(out[1].error).toBeInstanceOf(SyntaxError);
      }
      expect(out[2]).toEqual({ ok: true, value: { b: 2 } });
    });

    it("does not kill the stream after a malformed line split across chunks", () => {
      const decoder = new NdjsonDecoder();
      expect(decoder.feed("not ")).toEqual([]);
      const out = decoder.feed("json\n{\"a\":1}\n");
      expect(out.length).toBe(2);
      expect(out[0]?.ok).toBe(false);
      expect(out[1]).toEqual({ ok: true, value: { a: 1 } });
    });

    it("reports each malformed line separately", () => {
      const decoder = new NdjsonDecoder();
      const out = decoder.feed("bad1\nbad2\n");
      expect(out.length).toBe(2);
      expect(out[0]?.ok).toBe(false);
      expect(out[1]?.ok).toBe(false);
    });
  });

  describe("maximum message size", () => {
    it("has a sane default", () => {
      expect(DEFAULT_MAX_MESSAGE_BYTES).toBe(1_048_576);
    });

    it("reports a complete line that exceeds the limit rather than dropping it silently", () => {
      // The message is still discarded — that is what the limit is for. What
      // changed on review is that the caller is told. A vanished message is
      // indistinguishable from a server that said nothing, and the caller is
      // waiting on a request id that will now never be answered.
      const decoder = new NdjsonDecoder({ maxMessageBytes: 10 });
      const out = decoder.feed('{"a":"hello world"}\n');

      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ ok: false, reason: "oversize" });
    });

    it("keeps the report small, so it does not undo the limit", () => {
      const decoder = new NdjsonDecoder({ maxMessageBytes: 10 });
      const out = decoder.feed(`"${"x".repeat(5_000)}"\n`);

      expect(out).toHaveLength(1);
      const first = out[0];
      if (first?.ok === false) expect(first.raw.length).toBeLessThanOrEqual(200);
    });

    it("reports an oversize line and still delivers the next valid one in the same chunk", () => {
      const decoder = new NdjsonDecoder({ maxMessageBytes: 10 });
      const out = decoder.feed('{"a":"hello world"}\n{"b":1}\n');

      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({ ok: false, reason: "oversize" });
      expect(out[1]).toEqual({ ok: true, value: { b: 1 } });
    });

    it("drops an incomplete line that grows past the limit without a newline", () => {
      const decoder = new NdjsonDecoder({ maxMessageBytes: 10 });
      // No newline — the buffer grows past the limit, and the decoder says so
      // at the moment it gives up rather than at the terminator, which may
      // never come.
      const out = decoder.feed('{"a":"hello');
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ ok: false, reason: "oversize" });

      // Once abandoned, the rest of that line is consumed in silence rather
      // than reported again per chunk.
      expect(decoder.feed(" world")).toEqual([]);
      // The terminator of the discarded line is consumed, not reported twice.
      expect(decoder.feed('"\n')).toEqual([]);
      // The next valid message comes through.
      expect(decoder.feed('{"b":1}\n')).toEqual([{ ok: true, value: { b: 1 } }]);
    });

    it("prevents unbounded growth when a server never sends a newline", () => {
      const decoder = new NdjsonDecoder({ maxMessageBytes: 16 });
      // Feed many chunks without a newline. The buffer must not grow forever,
      // and the caller is told once when the line is abandoned rather than on
      // every chunk that follows.
      let reports = 0;
      for (let i = 0; i < 20; i += 1) {
        reports += decoder.feed("x".repeat(10)).length;
      }
      expect(reports).toBe(1);
      // Even after many chunks the decoder still recovers for a valid line
      // once a newline appears. The oversize content is dropped at its
      // terminator and the next message is not lost.
      expect(decoder.feed("\n")).toEqual([]);
      expect(decoder.feed('{"ok":1}\n')).toEqual([{ ok: true, value: { ok: 1 } }]);
    });

    it("drops an oversize line split across chunks", () => {
      const decoder = new NdjsonDecoder({ maxMessageBytes: 10 });
      expect(decoder.feed('{"a":"hel')).toEqual([]);
      // The chunk that pushes it past the limit is where it is abandoned, and
      // where the caller is told.
      const out = decoder.feed('lo world"}\n');
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ ok: false, reason: "oversize" });

      expect(decoder.feed('{"b":1}\n')).toEqual([{ ok: true, value: { b: 1 } }]);
    });

    it("measures the limit in UTF-8 bytes rather than characters", () => {
      // "é" is two bytes; a limit of 3 bytes allows {"a":1} (7 bytes) would
      // exceed, but a short line with a multi-byte char should be measured
      // correctly. Here the JSON is `{"t":"é"}` which is 10 bytes as UTF-8.
      const decoder = new NdjsonDecoder({ maxMessageBytes: 10 });
      // `{"t":"é"}` is 10 bytes, so at limit 10 it fits.
      expect(decoder.feed('{"t":"é"}\n')).toEqual([{ ok: true, value: { t: "é" } }]);
      // With limit 9 it is over, because the measurement is bytes and not the
      // nine characters it looks like.
      const small = new NdjsonDecoder({ maxMessageBytes: 9 });
      const out = small.feed('{"t":"é"}\n');
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ ok: false, reason: "oversize" });
    });
  });

  describe("encoder", () => {
    it("encodes one message to one line terminated by \\n", () => {
      expect(encodeNdjson({ a: 1 })).toBe('{"a":1}\n');
    });

    it("round-trips through the decoder", () => {
      const decoder = new NdjsonDecoder();
      const line = encodeNdjson({ hello: "world", n: 42 });
      expect(decoder.feed(line)).toEqual([{ ok: true, value: { hello: "world", n: 42 } }]);
    });

    it("encodes null and primitives", () => {
      expect(encodeNdjson(null)).toBe("null\n");
      expect(encodeNdjson(42)).toBe("42\n");
    });

    it("encodes a message that contains a newline in a string", () => {
      // JSON escapes the newline; it must not be treated as a separator.
      const decoder = new NdjsonDecoder();
      const line = encodeNdjson({ text: "a\nb" });
      // The line has exactly one terminating newline; the embedded newline is
      // escaped as \n inside the JSON string.
      expect(line).toBe('{"text":"a\\nb"}\n');
      expect(decoder.feed(line)).toEqual([{ ok: true, value: { text: "a\nb" } }]);
    });
  });
});
