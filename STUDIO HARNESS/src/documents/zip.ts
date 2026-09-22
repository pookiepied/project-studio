import { inflateRawSync } from "node:zlib";

import { DocumentError } from "./errors.js";

/**
 * Enough of the ZIP format to open an Office file.
 *
 * A `.docx`, `.pptx` or `.xlsx` is a ZIP of XML parts, and reading one
 * needs exactly two things: the list of entries, and the bytes of a named
 * entry. Node ships the inflater and nothing above it, and the house rule
 * adds no dependency, so this is the reader: the end-of-central-directory
 * record, walked back from the tail; the central directory it points at,
 * one fixed header per entry; and the local header each entry names, whose
 * own variable fields are skipped to reach the data. Stored and deflated
 * entries are the two methods Office writes; anything else is refused by
 * name. No encryption, no ZIP64 - an Office file past 4 GB is not a
 * document anyone reads in a chat.
 */

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
/** The record is 22 bytes, plus a comment of up to 65,535. */
const MAX_TAIL_SCAN = 22 + 0xffff;
const STORED = 0;
const DEFLATED = 8;

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly localHeaderOffset: number;
}

export class ZipArchive {
  readonly #bytes: Buffer;
  readonly #entries: ReadonlyMap<string, ZipEntry>;

  constructor(bytes: Uint8Array) {
    this.#bytes = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#entries = readCentralDirectory(this.#bytes);
  }

  /** Every entry's name, in the order the archive lists them. */
  names(): readonly string[] {
    return [...this.#entries.keys()];
  }

  has(name: string): boolean {
    return this.#entries.has(name);
  }

  /** The entry's bytes, inflated; undefined for a name the archive lacks. */
  read(name: string): Buffer | undefined {
    const entry = this.#entries.get(name);
    if (entry === undefined) return undefined;
    const header = entry.localHeaderOffset;
    if (this.#bytes.readUInt32LE(header) !== LOCAL_FILE_HEADER) {
      throw new DocumentError("malformed", "The file's ZIP structure is damaged.");
    }
    const nameLength = this.#bytes.readUInt16LE(header + 26);
    const extraLength = this.#bytes.readUInt16LE(header + 28);
    const start = header + 30 + nameLength + extraLength;
    const data = this.#bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === STORED) return Buffer.from(data);
    if (entry.method === DEFLATED) return inflateRawSync(data);
    throw new DocumentError(
      "malformed",
      `The file compresses "${name}" with a method this reader does not know.`,
    );
  }

  /** The entry as UTF-8 text; undefined for a name the archive lacks. */
  text(name: string): string | undefined {
    return this.read(name)?.toString("utf8");
  }
}

function readCentralDirectory(bytes: Buffer): ReadonlyMap<string, ZipEntry> {
  const stop = Math.max(0, bytes.length - MAX_TAIL_SCAN);
  let end = -1;
  for (let at = bytes.length - 22; at >= stop; at -= 1) {
    if (bytes.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) {
    throw new DocumentError("malformed", "The file is not a ZIP archive, so it is not the Office document its name claims.");
  }
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new DocumentError("malformed", "The file's ZIP directory is damaged.");
    }
    const method = bytes.readUInt16LE(at + 10);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localHeaderOffset = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    entries.set(name, { name, method, compressedSize, localHeaderOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
