import { describe, expect, it } from "vitest";

import { decodeTextBytes } from "../../src/documents/text-encoding.js";

function utf16be(text: string): Buffer {
  const little = Buffer.from(text, "utf16le");
  const big = Buffer.alloc(little.length);
  for (let index = 0; index + 1 < little.length; index += 2) {
    big[index] = little[index + 1] ?? 0;
    big[index + 1] = little[index] ?? 0;
  }
  return big;
}

describe("a text file's bytes as text", () => {
  it("reads plain UTF-8 as it is", () => {
    expect(decodeTextBytes(Buffer.from("plain café"))).toEqual({ text: "plain café", encoding: "utf-8", marked: false });
  });

  it("drops a UTF-8 byte-order mark instead of starting with an invisible character", () => {
    expect(decodeTextBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Hello")]))).toEqual({ text: "Hello", encoding: "utf-8", marked: true });
  });

  it("reads UTF-16 by its mark, in either byte order", () => {
    expect(decodeTextBytes(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Notepad Unicode", "utf16le")]))?.text).toBe("Notepad Unicode");
    expect(decodeTextBytes(Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be("Big end")]))?.text).toBe("Big end");
  });

  it("recognises unmarked UTF-16 by its zeros", () => {
    expect(decodeTextBytes(Buffer.from("No mark, still text", "utf16le"))).toMatchObject({ text: "No mark, still text", encoding: "utf-16le", marked: false });
    expect(decodeTextBytes(utf16be("Big, unmarked"))).toMatchObject({ text: "Big, unmarked", encoding: "utf-16be" });
  });

  it("calls bytes that still hold NULs once decoded not text", () => {
    expect(decodeTextBytes(Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0x00, 0x13, 0x37, 0x00, 0x00]))).toBeUndefined();
    expect(decodeTextBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00]))).toBeUndefined();
  });
});
