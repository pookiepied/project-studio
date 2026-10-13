import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { attachmentCopyNote, copyDeliveredAttachments } from "../../src/conversations/attachments.js";
import { conversationAttachmentsDirectory } from "../../src/platform/paths.js";

/**
 * A delivered picture becomes a readable copy in the conversation's own
 * `attachments/` directory, and the copy survives the renders that produce
 * it. These tests run under a throwaway `PROJECT_STUDIO_HOME` - never the
 * user's - and read the folder back the way the sandbox's read roots, the
 * model's `read`, and a second render all would.
 */

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.PROJECT_STUDIO_HOME;
  home = mkdtempSync(join(tmpdir(), "studio-attachment-copies-"));
  process.env.PROJECT_STUDIO_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
  else process.env.PROJECT_STUDIO_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

/** One delivered attachment, as the wire carries it: base64 beside a mime. */
function delivered(data: readonly number[], filename?: string, mimeType = "image/png") {
  return {
    data: Buffer.from(data).toString("base64"),
    mimeType,
    ...(filename === undefined ? {} : { filename }),
  };
}

function folderOf(conversationId: string): string {
  return conversationAttachmentsDirectory(conversationId);
}

function namesOf(conversationId: string): readonly string[] {
  return readdirSync(folderOf(conversationId)).sort();
}

describe("the copies a delivered message leaves", () => {
  it("maps a batch in delivery order to exact collision-resolved paths, including repeated bytes", () => {
    const pictures = [
      delivered([1], "same.png"),
      delivered([2, 3], "same.png"),
      delivered([1], "same.png"),
      delivered([4], undefined, "image/webp"),
    ];
    const copies = copyDeliveredAttachments("cnv_mapping", pictures);
    expect(copies.map((copy) => [copy.position, copy.total, copy.path, copy.byteLength])).toEqual([
      [1, 4, join(folderOf("cnv_mapping"), "same.png"), 1],
      [2, 4, join(folderOf("cnv_mapping"), "same-2.png"), 2],
      [3, 4, join(folderOf("cnv_mapping"), "same.png"), 1],
      [4, 4, join(folderOf("cnv_mapping"), "attachment-4.webp"), 1],
    ]);
    expect(copyDeliveredAttachments("cnv_mapping", pictures)).toEqual(copies);
    const note = attachmentCopyNote(copies);
    const rows = note.split("\n").slice(4).map((line) => JSON.parse(line) as unknown);
    expect(rows).toEqual(copies);
    expect(note).toContain("not filesystem paths");
    for (const [index, copy] of copies.entries()) {
      expect(readFileSync(copy.path).toString("base64")).toBe(pictures[index]?.data);
    }
  });

  it("writes a named picture under its own name, the bytes decoded, a data-URI prefix tolerated", () => {
    copyDeliveredAttachments("cnv_named", [
      {
        data: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x0d, 0x0a]).toString("base64")}`,
        mimeType: "image/png",
        filename: "photo.png",
      },
    ]);

    expect(readFileSync(join(folderOf("cnv_named"), "photo.png"))).toEqual(
      Buffer.from([0x89, 0x50, 0x0d, 0x0a]),
    );
  });

  it("keeps what it wrote: the same message copied twice leaves one file", () => {
    // The render runs again on a resumed submission and when a delivery
    // joins; the folder's state, not the call count, decides, so the second
    // pass is the first one's answer read back.
    const pictures = [delivered([1, 2, 3], "keep.png")];
    copyDeliveredAttachments("cnv_again", pictures);
    copyDeliveredAttachments("cnv_again", pictures);

    expect(namesOf("cnv_again")).toEqual(["keep.png"]);
  });

  it("gives a second, different picture of one name the next number, and keeps the first", () => {
    copyDeliveredAttachments("cnv_same_name", [
      delivered([1], "photo.png"),
      delivered([2, 2], "photo.png"),
    ]);
    // The resent second picture is still the second: the copied one holds
    // its bytes, so the comparison - not a fresh suffix - is what holds.
    copyDeliveredAttachments("cnv_same_name", [delivered([2, 2], "photo.png")]);

    expect(namesOf("cnv_same_name")).toEqual(["photo-2.png", "photo.png"]);
    expect(readFileSync(join(folderOf("cnv_same_name"), "photo.png"))).toEqual(Buffer.from([1]));
    expect(readFileSync(join(folderOf("cnv_same_name"), "photo-2.png"))).toEqual(
      Buffer.from([2, 2]),
    );
  });

  it("a picture with no name wears the mime's extension, counted from its place", () => {
    // The picker sniffs the mime from the bytes, so the extension it answers
    // for is the one the media tool's own table reads.
    copyDeliveredAttachments("cnv_unnamed", [
      delivered([1], undefined, "image/webp"),
      delivered([2], undefined, "image/gif"),
    ]);

    expect(namesOf("cnv_unnamed")).toEqual(["attachment-1.webp", "attachment-2.gif"]);
  });

  it("an extension the tools do not speak yields to the mime, and the name keeps its last segment", () => {
    copyDeliveredAttachments("cnv_odd", [
      delivered([1], "my.v2.photo", "image/jpeg"),
      delivered([2], "C:\\Users\\pooki\\Pictures\\IMG_0001.JPG"),
      delivered([3], "/home/pooki/next/rel.png"),
    ]);

    expect(namesOf("cnv_odd")).toEqual(["IMG_0001.jpg", "my.v2.photo.jpg", "rel.png"]);
  });

  it("a message that carries no pictures creates nothing", () => {
    // Directories exist when they are needed, the way `paths.ts` has it -
    // and the sandbox factory creates this one at every submission anyway.
    copyDeliveredAttachments("cnv_empty", []);

    expect(existsSync(folderOf("cnv_empty"))).toBe(false);
  });
});
