/**
 * A text file's bytes as text, whichever of the encodings Windows writes.
 *
 * Notepad, PowerShell's `Out-File` and Excel's "Unicode text" export save
 * UTF-16 - every other byte of English is zero - and many editors put a BOM
 * in front of UTF-8. Decoded as UTF-8, the first is a string of NULs the read
 * tool refused as binary and an attachment inlined as noise, and the second
 * starts with an invisible character. A BOM decides when there is one; without
 * one, UTF-16 is recognised by its zeros, which plain text never has.
 *
 * Undefined means not text: NULs remain once decoded.
 */
export type TextEncodingName = "utf-8" | "utf-16le" | "utf-16be";

export interface DecodedText {
  readonly text: string;
  readonly encoding: TextEncodingName;
  /** The encoding came from a byte-order mark rather than from the zeros. */
  readonly marked: boolean;
}

/** How much of the start is examined for UTF-16's pattern of zeros. */
const SNIFF_BYTES = 4096;

export function decodeTextBytes(bytes: Uint8Array): DecodedText | undefined {
  const marked = byteOrderMark(bytes);
  const encoding = marked ?? unmarkedUtf16(bytes) ?? "utf-8";
  const skip = marked === undefined ? 0 : marked === "utf-8" ? 3 : 2;
  const body = bytes.subarray(skip);
  const text = encoding === "utf-16be" ? new TextDecoder("utf-16le").decode(swapped(body)) : new TextDecoder(encoding).decode(body);
  if (text.includes("\0")) return undefined;
  // Guessed from zeros alone, binary can pass for UTF-16; text it decodes to
  // is still mostly control characters, which written text never is.
  if (marked === undefined && encoding !== "utf-8" && controlShare(text) > 0.05) return undefined;
  return { text, encoding, marked: marked !== undefined };
}

/** The share of characters that are controls other than tab, line feed, form feed and return. */
function controlShare(text: string): number {
  if (text.length === 0) return 0;
  let controls = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0c && code !== 0x0d) || (code >= 0x7f && code < 0xa0)) controls += 1;
  }
  return controls / text.length;
}

function byteOrderMark(bytes: Uint8Array): TextEncodingName | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return undefined;
}

/**
 * UTF-16 without a BOM: zeros on one side of most byte pairs and almost none
 * on the other. Text in a script outside Latin-1 has fewer zeros, so it needs
 * a BOM to be recognised, which is what every Windows writer puts there.
 */
function unmarkedUtf16(bytes: Uint8Array): TextEncodingName | undefined {
  const length = Math.min(bytes.length, SNIFF_BYTES) & ~1;
  if (length < 4) return undefined;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let index = 0; index < length; index += 2) {
    if (bytes[index] === 0) evenZeros += 1;
    if (bytes[index + 1] === 0) oddZeros += 1;
  }
  const pairs = length / 2;
  if (oddZeros > pairs * 0.4 && evenZeros < pairs * 0.05) return "utf-16le";
  if (evenZeros > pairs * 0.4 && oddZeros < pairs * 0.05) return "utf-16be";
  return undefined;
}

function swapped(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length & ~1);
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    out[index] = bytes[index + 1] ?? 0;
    out[index + 1] = bytes[index] ?? 0;
  }
  return out;
}
