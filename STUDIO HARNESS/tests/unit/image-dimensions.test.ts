import { describe, expect, it } from "vitest";

import { dimensionsPhrase, imageDimensions } from "../../src/documents/image-dimensions.js";

function png(width: number, height: number): Buffer {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "ascii");
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return head;
}

/** SOI, an APP0 segment to walk past, then a baseline frame header. */
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

function webp(chunk: "VP8X" | "VP8L" | "VP8 ", width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WEBP", 8, "ascii");
  bytes.write(chunk, 12, "ascii");
  if (chunk === "VP8X") {
    bytes.writeUIntLE(width - 1, 24, 3);
    bytes.writeUIntLE(height - 1, 27, 3);
  } else if (chunk === "VP8L") {
    bytes[20] = 0x2f;
    bytes.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 21);
  } else {
    bytes.writeUInt16LE(width, 26);
    bytes.writeUInt16LE(height, 28);
  }
  return bytes;
}

describe("a picture's size from its header", () => {
  it("reads PNG, GIF, JPEG and every WebP flavour", () => {
    expect(imageDimensions(png(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(imageDimensions(Buffer.from([...Buffer.from("GIF89a"), 0x40, 0x01, 0xf0, 0x00]))).toEqual({ width: 320, height: 240 });
    expect(imageDimensions(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024 });
    expect(imageDimensions(webp("VP8X", 3000, 2000))).toEqual({ width: 3000, height: 2000 });
    expect(imageDimensions(webp("VP8L", 640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageDimensions(webp("VP8 ", 800, 600))).toEqual({ width: 800, height: 600 });
  });

  it("says nothing rather than guess when the header does not say", () => {
    expect(imageDimensions(Buffer.from("not a picture at all, just words"))).toBeUndefined();
    expect(imageDimensions(png(0, 10))).toBeUndefined();
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeUndefined();
  });

  it("warns that a picture past the provider's downscale side loses detail", () => {
    expect(dimensionsPhrase({ width: 800, height: 600 })).toBe("800x600 px");
    expect(dimensionsPhrase({ width: 4032, height: 3024 })).toMatch(/^4032x3024 px; the provider scales/);
    expect(dimensionsPhrase(undefined)).toBe("");
  });
});
