import { PROVIDER_DOWNSCALE_SIDE_PX } from "../contracts/media-limits.js";

/**
 * A picture's width and height, read from its own header.
 *
 * The model is told how big an attached or read picture is so it knows what
 * it was shown: providers scale large pictures down before the model sees
 * them, and a model that thinks it has a 4000-pixel screenshot at full detail
 * reads small text it cannot actually make out. Only the header is parsed -
 * no decoder - for the four formats a turn may carry. Undefined means the
 * header did not say, never a guess.
 */
export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

export function imageDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  const sized = png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes);
  return sized !== undefined && sized.width > 0 && sized.height > 0 ? sized : undefined;
}

/** One line for the model: the size, and what that size means for detail. */
export function dimensionsPhrase(dimensions: ImageDimensions | undefined): string {
  if (dimensions === undefined) return "";
  const size = `${String(dimensions.width)}x${String(dimensions.height)} px`;
  return Math.max(dimensions.width, dimensions.height) > PROVIDER_DOWNSCALE_SIDE_PX
    ? `${size}; the provider scales pictures this large down, so fine detail may be lost and reading the file again shows no more`
    : size;
}

function u16be(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u16le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function u24le(bytes: Uint8Array, at: number): number {
  return u16le(bytes, at) | ((bytes[at + 2] ?? 0) << 16);
}

function u32be(bytes: Uint8Array, at: number): number {
  return ((u16be(bytes, at) << 16) >>> 0) + u16be(bytes, at + 2);
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function png(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 24 || bytes[0] !== 0x89 || ascii(bytes, 1, 3) !== "PNG" || ascii(bytes, 12, 4) !== "IHDR") return undefined;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function gif(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 10 || (ascii(bytes, 0, 6) !== "GIF87a" && ascii(bytes, 0, 6) !== "GIF89a")) return undefined;
  return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
}

function webp(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return undefined;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  if (chunk === "VP8 ") return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = (bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return undefined;
}

/** Walks the marker segments to the first start-of-frame, which holds the size. */
function jpeg(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) { at += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: u16be(bytes, at + 7), height: u16be(bytes, at + 5) };
    }
    if (marker === 0xd9 || marker === 0xda) return undefined;
    at += 2 + u16be(bytes, at + 2);
  }
  return undefined;
}
