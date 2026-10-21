import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExecutionScope } from "../../../src/contracts/capabilities.js";
import { conversationTrashDirectory } from "../../../src/platform/paths.js";
import { PermissionGrantStore } from "../../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../../src/permissions/kernel.js";
import { SandboxError } from "../../../src/sandbox/errors.js";
import { LocalSandbox } from "../../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy, type SandboxPolicy } from "../../../src/sandbox/policy.js";
import { SnapshotStore } from "../../../src/snapshots/store.js";
import { TurnSnapshots, type SnapshotHook } from "../../../src/snapshots/turn.js";
import { openDatabase, type StudioDatabase } from "../../../src/storage/database.js";
import { ToolError } from "../../../src/tools/errors.js";
import { CallGate } from "../../../src/tools/gate.js";
import {
  FileAccessLog,
  formatNumbered,
  registerFilesystemTools,
} from "../../../src/tools/filesystem/index.js";

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

const OTHER_CONVERSATION: ExecutionScope = { ...SCOPE, conversationId: "conv-2" };

let db: StudioDatabase;
let workspace: string;
let gate: CallGate;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  workspace = mkdtempSync(join(tmpdir(), "studio-fs-"));
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src", "app.ts"), "const a = 1;\nconst b = 2;\n");

  const kernel = new PermissionKernel({
    grants: new PermissionGrantStore(db),
    // Writing asks by default; an always-approving user keeps these tests about
    // the tools rather than about the prompt.
    approver: { request: async () => ({ verdict: "allow", duration: "always" }) },
  });
  gate = new CallGate({
    kernel,
    sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })),
  });
  registerFilesystemTools(gate);
});

afterEach(() => {
  db.close();
  rmSync(workspace, { recursive: true, force: true });
});

const read = (input: unknown, scope = SCOPE) =>
  gate.call({ name: "native/read", input, scope }) as Promise<string>;
const write = (input: unknown, scope = SCOPE) =>
  gate.call({ name: "native/write", input, scope }) as Promise<string>;
const edit = (input: unknown, scope = SCOPE) =>
  gate.call({ name: "native/edit", input, scope }) as Promise<string>;

describe("read", () => {
  it("returns numbered lines", async () => {
    // Line numbers are how the model refers to a location afterwards, and how a
    // person checks that an edit points where it claims.
    const output = await read({ path: "src/app.ts" });

    expect(output).toContain("     1\tconst a = 1;");
    expect(output).toContain("     2\tconst b = 2;");
  });

  it("pages with offset and limit", async () => {
    writeFileSync(join(workspace, "long.txt"), "a\nb\nc\nd\ne\n");

    const output = await read({ path: "long.txt", offset: 2, limit: 2 });

    expect(output).toContain("     2\tb");
    expect(output).toContain("     3\tc");
    expect(output).not.toContain("     4\td");
  });

  it("says when it returned only part of a file", async () => {
    // A model that does not know it saw a fragment answers as though it saw
    // the whole file.
    writeFileSync(join(workspace, "long.txt"), "a\nb\nc\nd\ne\n");

    expect(await read({ path: "long.txt", limit: 2 })).toMatch(/showing lines 1-2 of 5/);
  });

  it("truncates a line too long to be worth reasoning about", () => {
    const output = formatNumbered("x".repeat(5_000), 1, 10);

    expect(output).toContain("[line truncated]");
    expect(output.length).toBeLessThan(3_000);
  });

  it("reports an empty file as empty rather than as nothing", () => {
    expect(formatNumbered("", 1, 10)).toBe("(this file is empty)");
  });

  it("refuses a directory", async () => {
    await expect(read({ path: "src" })).rejects.toThrow(/directory/i);
  });

  it("refuses a file that is not text", async () => {
    // Returned as text, binary becomes plausible-looking nonsense the model
    // reasons about as if it were real. Not a .png - a picture is no longer
    // "not text", it is an attachment.
    writeFileSync(join(workspace, "data.bin"), Buffer.from([0x89, 0x50, 0x00, 0x01]));

    await expect(read({ path: "data.bin" })).rejects.toThrow(/not text/i);
  });

  it("suggests near misses when a path does not exist", async () => {
    // A missing file is the most common failure a read has, and the name
    // usually differs by a typo, a case, or an extension.
    await expect(read({ path: "src/ap.ts" })).rejects.toThrow(/Did you mean[\s\S]*app\.ts/);
    await expect(read({ path: "src/app.tsx" })).rejects.toThrow(/Did you mean[\s\S]*app\.ts/);
  });

  it("says there is no file when there is nothing to suggest", async () => {
    // No parent directory to look in, so no near miss either.
    await expect(read({ path: "nowhere/thing.ts" })).rejects.toThrow(
      /There is no file at nowhere\/thing\.ts/,
    );
  });

  it("does not suggest an unrelated name just because a dotfile stems to empty", async () => {
    // `.env` stems to "", and includes("") matched everything once. The plain
    // refusal, anchored exactly, proves no suggestion block was appended.
    writeFileSync(join(workspace, ".env"), "X=1\n");

    await expect(read({ path: "unrelated-thing.bin" })).rejects.toThrow(
      /^There is no file at unrelated-thing\.bin\.$/,
    );
  });

  it("refuses a file too large to read at once", async () => {
    writeFileSync(join(workspace, "big.txt"), "x".repeat(2 * 1024 * 1024));

    await expect(read({ path: "big.txt" })).rejects.toThrow(/too large/i);
  });

  it("does not measure a picture by the rule written for source files", async () => {
    // The size limit is about the context window, and a photograph does not
    // spend the context window the way a megabyte of source does - a provider
    // resizes it before tokenising, so its weight and its cost are unrelated.
    // Measured by the text rule, an ordinary phone screenshot was refused, and
    // refused with advice ("search it instead") that cannot be carried out on
    // a PNG.
    writeFileSync(join(workspace, "photo.png"), Buffer.alloc(2 * 1024 * 1024));

    await expect(read({ path: "photo.png" })).resolves.toBeDefined();
  });

  it("still holds a picture to the weight a provider will accept", async () => {
    // Held for a different reason than the text limit, and so it says a
    // different thing: this is the request being rejected on the wire, not a
    // file better answered by a search.
    writeFileSync(join(workspace, "huge.png"), Buffer.alloc(6 * 1024 * 1024));

    await expect(read({ path: "huge.png" })).rejects.toThrow(/limit for one picture/i);
    await expect(read({ path: "huge.png" })).rejects.not.toThrow(/search it instead/i);
  });

  it("refuses a PDF by name only with the reader's own sentence, not a blank page", async () => {
    // A file that is a PDF by name only cannot be opened: the answer says
    // so, rather than a blank numbered page or a guess about scans. What a
    // real PDF reads as, page by page with its coverage, is the documents
    // suite's subject.
    writeFileSync(join(workspace, "blank.pdf"), Buffer.alloc(2 * 1024 * 1024));

    await expect(read({ path: "blank.pdf" })).rejects.toThrow(/could not be opened/i);
  });

  it("refuses a path outside the workspace", async () => {
    await expect(read({ path: "../escape.txt" })).rejects.toThrow(SandboxError);
  });

  it("requires a path", async () => {
    await expect(read({})).rejects.toThrow(/path is required/i);
  });
});

describe("read sees pictures", () => {
  // A 1x1 PNG. The bytes are decoded and re-encoded by the tool, so asserting
  // the base64 round-trips proves the file reached the model intact.
  const TINY_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  function pictureGate(acceptsImages: (conversationId: string) => boolean | undefined): CallGate {
    const instance = new CallGate({
      kernel: new PermissionKernel({
        grants: new PermissionGrantStore(db),
        approver: { request: async () => ({ verdict: "allow", duration: "always" }) },
      }),
      sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })),
    });
    registerFilesystemTools(instance, new FileAccessLog(), { acceptsImages });
    return instance;
  }

  function contentBlocksOf(value: unknown): readonly unknown[] | undefined {
    if (typeof value !== "object" || value === null || !("content" in value)) return undefined;
    const content = value.content;
    return Array.isArray(content) ? content : undefined;
  }

  function isImageBlock(
    block: unknown,
  ): block is { type: "image"; data: string; mimeType: string } {
    return (
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      block.type === "image" &&
      "data" in block &&
      "mimeType" in block
    );
  }

  beforeEach(() => {
    writeFileSync(join(workspace, "logo.png"), Buffer.from(TINY_PNG, "base64"));
  });

  it("returns an image as an attachment when the model can see it", async () => {
    const result = await pictureGate(() => true).call({
      name: "native/read",
      input: { path: "logo.png" },
      scope: SCOPE,
    });

    const blocks = contentBlocksOf(result);
    expect(blocks).toHaveLength(2);
    const image = blocks?.find(isImageBlock);
    expect(image?.mimeType).toBe("image/png");
    expect(image?.data).toBe(TINY_PNG);
    const note = blocks?.find((block) => typeof block === "object" && block !== null && "text" in block) as { text: string } | undefined;
    expect(note?.text).toMatch(/^Attached: logo\.png \(image\/png, 1x1 px\)\./);
  });

  it("returns the attachment when acceptance is merely unknown", async () => {
    // The catalog not describing a model is not evidence that the model is
    // blind; only an explicit "unsupported" refuses.
    const result = await pictureGate(() => undefined).call({
      name: "native/read",
      input: { path: "logo.png" },
      scope: SCOPE,
    });

    expect(contentBlocksOf(result)).toHaveLength(2);
  });

  it("refuses with a sentence rather than a wall of base64 for a text-only model", async () => {
    await expect(
      pictureGate(() => false).call({
        name: "native/read",
        input: { path: "logo.png" },
        scope: SCOPE,
      }),
    ).rejects.toThrow(/does not accept image input/);
  });

  it("refuses a PDF, which nothing downstream can carry yet", async () => {
    writeFileSync(join(workspace, "doc.pdf"), Buffer.from("%PDF-1.4\n"));

    await expect(read({ path: "doc.pdf" })).rejects.toThrow(/PDF/);
  });

  it("keeps the read recorded, so the access log stays the one answer", async () => {
    const log = new FileAccessLog();
    const instance = new CallGate({
      kernel: new PermissionKernel({
        grants: new PermissionGrantStore(db),
        approver: { request: async () => ({ verdict: "allow", duration: "always" }) },
      }),
      sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })),
    });
    registerFilesystemTools(instance, log, { acceptsImages: () => true });

    await instance.call({ name: "native/read", input: { path: "logo.png" }, scope: SCOPE });

    expect(log.get(SCOPE, join(workspace, "logo.png"))).toBeDefined();
  });

  describe("a picture the model cannot be shown", () => {
    // The two files that started this: a BMP fell to the text path, and
    // depending on its weight either hit the 1 MB text limit - "search it
    // instead", advice no bitmap can follow, about a limit that was never
    // reasoning about pictures - or was refused as binary, which is true but
    // teaches nothing. Refused by kind instead, ahead of the size check, with
    // the formats that would have worked named.
    const BMP = Buffer.concat([Buffer.from("BM"), Buffer.alloc(64)]);
    const TIFF = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x00]);

    it("refuses a large BMP by kind, ahead of the size check", async () => {
      writeFileSync(
        join(workspace, "screenshot.bmp"),
        Buffer.concat([Buffer.from("BM"), Buffer.alloc(2 * 1024 * 1024)]),
      );

      await expect(read({ path: "screenshot.bmp" })).rejects.toThrow(/BMP/);
      await expect(read({ path: "screenshot.bmp" })).rejects.toThrow(
        /PNG, JPEG, GIF and WebP/,
      );
      // The old answer, twice wrong: the text limit's number and advice a
      // bitmap cannot follow.
      await expect(read({ path: "screenshot.bmp" })).rejects.not.toThrow(/too large/i);
      await expect(read({ path: "screenshot.bmp" })).rejects.not.toThrow(/search it/i);
    });

    it("refuses a small BMP by kind rather than as binary", async () => {
      // Under the text limit it used to reach the NUL-byte guard and be told
      // "not text" - no name, no remedy.
      writeFileSync(join(workspace, "icon.bmp"), BMP);

      await expect(read({ path: "icon.bmp" })).rejects.toThrow(/BMP/);
      await expect(read({ path: "icon.bmp" })).rejects.not.toThrow(/not text/i);
    });

    it("names TIFF for both of its extensions", async () => {
      writeFileSync(join(workspace, "scan.tiff"), TIFF);
      writeFileSync(join(workspace, "scan.tif"), TIFF);

      await expect(read({ path: "scan.tiff" })).rejects.toThrow(/TIFF/);
      await expect(read({ path: "scan.tif" })).rejects.toThrow(/TIFF/);
    });

    it("refuses the container formats a person plausibly hands it", async () => {
      // HEIC and AVIF ride an ISO base media file container, identified by the
      // brand at byte 8; ICO is four bytes.
      const isobmff = (brand: string) =>
        Buffer.concat([
          Buffer.from([0x00, 0x00, 0x00, 0x18]),
          Buffer.from(`ftyp${brand}`),
          Buffer.alloc(8),
        ]);
      writeFileSync(join(workspace, "photo.heic"), isobmff("heic"));
      writeFileSync(join(workspace, "portrait.heif"), isobmff("mif1"));
      writeFileSync(join(workspace, "modern.avif"), isobmff("avif"));
      writeFileSync(join(workspace, "favicon.ico"), Buffer.from([0x00, 0x00, 0x01, 0x00]));

      await expect(read({ path: "photo.heic" })).rejects.toThrow(/HEIC/);
      await expect(read({ path: "portrait.heif" })).rejects.toThrow(/HEIF/);
      await expect(read({ path: "modern.avif" })).rejects.toThrow(/AVIF/);
      await expect(read({ path: "favicon.ico" })).rejects.toThrow(/ICO/);
    });
  });

  describe("the kind is decided by the bytes, not the name", () => {
    it("shows a real PNG that carries a .txt name", async () => {
      // Read as text, this was refused as binary - truthful, and useless.
      writeFileSync(join(workspace, "image.txt"), Buffer.from(TINY_PNG, "base64"));

      const result = await pictureGate(() => true).call({
        name: "native/read",
        input: { path: "image.txt" },
        scope: SCOPE,
      });

      const image = contentBlocksOf(result)?.find(isImageBlock);
      expect(image?.mimeType).toBe("image/png");
      expect(image?.data).toBe(TINY_PNG);
    });

    it("labels a mislabelled picture by its bytes", async () => {
      // 12-mislabelled.jpg holds PNG bytes under a jpg name, and only ever
      // worked because the provider was tolerant of what the name claimed.
      writeFileSync(join(workspace, "12-mislabelled.jpg"), Buffer.from(TINY_PNG, "base64"));

      const result = await pictureGate(() => true).call({
        name: "native/read",
        input: { path: "12-mislabelled.jpg" },
        scope: SCOPE,
      });

      expect(contentBlocksOf(result)?.find(isImageBlock)?.mimeType).toBe("image/png");
    });

    it("refuses BMP bytes however showable the name claims to be", async () => {
      // Sent on as a "PNG", these bytes are a provider 400. Refused by kind,
      // they are a sentence the model can act on.
      writeFileSync(
        join(workspace, "fakery.png"),
        Buffer.concat([Buffer.from("BM"), Buffer.alloc(64)]),
      );

      await expect(read({ path: "fakery.png" })).rejects.toThrow(/BMP/);
    });

    it("keeps text that merely begins like a signature as text", async () => {
      // "BM" is two ASCII letters that begin ordinary words, so a bare one is
      // believed only when the name already claims a picture.
      writeFileSync(join(workspace, "fleet.txt"), "BMW sales by quarter, and up.\n");

      expect(await read({ path: "fleet.txt" })).toContain("BMW sales");
    });

    it("leaves SVG a text file, because that is what it is", async () => {
      // Deliberately outside both maps: reading it as text is right, and a
      // large one is a large text file - the text limit and its advice apply.
      writeFileSync(
        join(workspace, "logo.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>\n',
      );

      expect(await read({ path: "logo.svg" })).toContain("<svg");

      writeFileSync(join(workspace, "huge.svg"), "<svg>".padEnd(2 * 1024 * 1024, "x"));
      await expect(read({ path: "huge.svg" })).rejects.toThrow(/too large/i);
    });
  });
});

describe("write", () => {
  it("creates a file that does not exist, with no prior read", async () => {
    // Requiring a read of a missing file would make creating one impossible.
    expect(await write({ path: "notes/new.md", content: "hello" })).toMatch(/created/i);
    expect(await read({ path: "notes/new.md" })).toContain("hello");
  });

  it("refuses to replace a file this conversation has not read", async () => {
    // A model that has not read a file does not know what it is discarding.
    await expect(
      write({ path: "src/app.ts", content: "wiped" }),
    ).rejects.toThrow(/has not been read/i);

    expect(await read({ path: "src/app.ts" })).toContain("const a = 1;");
  });

  it("replaces it once the file has been read", async () => {
    await read({ path: "src/app.ts" });

    expect(await write({ path: "src/app.ts", content: "replaced" })).toMatch(/replaced/i);
  });

  it("does not accept a read from a different conversation", async () => {
    // "I have seen this file" is knowledge held by one agent in one
    // conversation; inheriting it would let another edit blind.
    await read({ path: "src/app.ts" }, OTHER_CONVERSATION);

    await expect(write({ path: "src/app.ts", content: "wiped" })).rejects.toThrow(
      /has not been read/i,
    );
  });

  it("refuses when the file changed after it was read", async () => {
    // Editing against a stale copy silently discards whatever happened in
    // between — a formatter run, another tool, the user typing.
    await read({ path: "src/app.ts" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    writeFileSync(join(workspace, "src", "app.ts"), "changed by someone else");

    await expect(write({ path: "src/app.ts", content: "mine" })).rejects.toThrow(
      /changed after it was read/i,
    );
  });

  it("refuses a path outside the workspace", async () => {
    await expect(write({ path: "../planted.txt", content: "x" })).rejects.toThrow(
      SandboxError,
    );
  });

  it("requires text content", async () => {
    await expect(write({ path: "a.txt", content: 42 })).rejects.toThrow(/must be text/i);
  });
});

describe("edit", () => {
  beforeEach(async () => {
    await read({ path: "src/app.ts" });
  });

  it("replaces an exact string", async () => {
    await edit({ path: "src/app.ts", oldString: "const a = 1;", newString: "const a = 9;" });

    expect(await read({ path: "src/app.ts" })).toContain("const a = 9;");
  });

  it("refuses text that is not in the file", async () => {
    await expect(
      edit({ path: "src/app.ts", oldString: "missing", newString: "x" }),
    ).rejects.toThrow(/was not found/i);
  });

  it("refuses an ambiguous match rather than guessing", async () => {
    // Three occurrences means the model has not said which one it meant, and
    // picking the first is a guess with a one-in-three chance.
    writeFileSync(join(workspace, "dup.ts"), "x = 1\nx = 1\nx = 1\n");
    await read({ path: "dup.ts" });

    await expect(
      edit({ path: "dup.ts", oldString: "x = 1", newString: "x = 2" }),
    ).rejects.toThrow(/appears 3 times/i);
  });

  it("changes every occurrence when told to", async () => {
    writeFileSync(join(workspace, "dup.ts"), "x = 1\nx = 1\n");
    await read({ path: "dup.ts" });

    expect(
      await edit({ path: "dup.ts", oldString: "x = 1", newString: "x = 2", replaceAll: true }),
    ).toMatch(/2 occurrences/);
  });

  it("refuses an edit that changes nothing", async () => {
    await expect(
      edit({ path: "src/app.ts", oldString: "const a = 1;", newString: "const a = 1;" }),
    ).rejects.toThrow(/identical/i);
  });

  it("refuses an empty oldString", async () => {
    await expect(
      edit({ path: "src/app.ts", oldString: "", newString: "x" }),
    ).rejects.toThrow(/cannot be empty/i);
  });

  it("refuses a file that does not exist", async () => {
    await expect(
      edit({ path: "nope.ts", oldString: "a", newString: "b" }),
    ).rejects.toThrow(/does not exist/i);
  });

  it("refuses a file this conversation has not read", async () => {
    writeFileSync(join(workspace, "unread.ts"), "value");

    await expect(
      edit({ path: "unread.ts", oldString: "value", newString: "other" }),
    ).rejects.toThrow(/has not been read/i);
  });

  // `String.replace` treats the replacement as a pattern even when the search
  // value is a plain string, so these all used to write something other than
  // what was asked for and report success. `$` is ordinary content in a file.
  describe("writes the replacement exactly as given", () => {
    const cases: readonly (readonly [name: string, newString: string])[] = [
      ["$& (the whole match)", "cost + $&"],
      ["$` (everything before)", "cost + $`"],
      ["$' (everything after)", "cost + $'"],
      ["$$ (an escaped dollar)", "cost + $$"],
      // These two are already inert, because a string search value has no
      // capture groups for them to refer to. Kept anyway: they become live the
      // moment anyone reaches for a RegExp here, and this is where that shows
      // up as a failure rather than as a corrupted file.
      ["$1 (a capture group)", "cost + $1"],
      ["$<name> (a named group)", "cost + $<total>"],
    ];

    for (const [name, newString] of cases) {
      it(`does not interpret ${name}`, async () => {
        writeFileSync(join(workspace, "money.ts"), "const price = 10;\n");
        await read({ path: "money.ts" });

        await edit({ path: "money.ts", oldString: "10", newString });

        expect(await read({ path: "money.ts" })).toContain(`const price = ${newString};`);
      });

      it(`does not interpret ${name} under replaceAll`, async () => {
        writeFileSync(join(workspace, "money.ts"), "a = 10;\nb = 10;\n");
        await read({ path: "money.ts" });

        await edit({ path: "money.ts", oldString: "10", newString, replaceAll: true });

        const after = await read({ path: "money.ts" });
        expect(after).toContain(`a = ${newString};`);
        expect(after).toContain(`b = ${newString};`);
      });
    }

    it("keeps a shell variable in a script intact", async () => {
      // The realistic version: nothing here looks like a regular expression to
      // a person, and two of these tokens are substitution patterns.
      writeFileSync(join(workspace, "run.sh"), "echo old\n");
      await read({ path: "run.sh" });

      await edit({
        path: "run.sh",
        oldString: "echo old",
        newString: 'echo "$@ ${HOME} $$ $1"',
      });

      expect(await read({ path: "run.sh" })).toContain('echo "$@ ${HOME} $$ $1"');
    });
  });
});

describe("an edit shows what it produced", () => {
  beforeEach(async () => {
    writeFileSync(
      join(workspace, "long.ts"),
      Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n") + "\n",
    );
    await read({ path: "long.ts" });
  });

  it("returns the changed region with its line numbers, so no re-read is needed", async () => {
    const result = await edit({
      path: "long.ts",
      oldString: "line 15",
      newString: "line fifteen",
    });

    expect(result).toContain("Edited long.ts");
    expect(result).toContain("line fifteen");
    // Three lines of context on each side, numbered as the file numbers them.
    expect(result).toMatch(/\s12\tline 12/);
    expect(result).toMatch(/\s18\tline 18/);
    // And not the whole file.
    expect(result).not.toContain("line 5");
    expect(result).not.toContain("line 25");
  });

  it("does not invite a page-through of a file it only excerpted", async () => {
    const result = await edit({
      path: "long.ts",
      oldString: "line 15",
      newString: "line fifteen",
    });

    // The read tool's footer belongs to a read. Here it would describe a
    // deliberately bounded excerpt as a truncated file.
    expect(result).not.toContain("read again with offset");
  });

  it("merges regions whose context windows touch, rather than printing lines twice", async () => {
    writeFileSync(join(workspace, "near.ts"), "a\nx\nb\nc\nx\nd\n");
    await read({ path: "near.ts" });

    const result = await edit({
      path: "near.ts",
      oldString: "x",
      newString: "y",
      replaceAll: true,
    });

    // Both changes sit inside one window, so line 3 is printed once.
    expect(result.match(/\s3\tb/g)).toHaveLength(1);
  });

  it("counts the rest rather than printing a wall of separate regions", async () => {
    // Twelve lines apart, so the context windows do not touch and each change
    // is its own region.
    const spaced = Array.from(
      { length: 10 },
      (_, index) => `x\n${Array.from({ length: 11 }, (_, pad) => `pad ${index}.${pad}`).join("\n")}`,
    );
    writeFileSync(join(workspace, "wide.ts"), spaced.join("\n") + "\n");
    await read({ path: "wide.ts" });

    const result = await edit({
      path: "wide.ts",
      oldString: "x",
      newString: "y",
      replaceAll: true,
    });

    expect(result).toMatch(/7 more changed regions not shown/);
  });

  it("gives a count rather than a dump when merged regions cover the file", async () => {
    // Seven lines apart: each window touches the next, so they merge into one
    // region that is under the region cap and still the whole file.
    const dense = Array.from(
      { length: 30 },
      (_, index) => `x\n${Array.from({ length: 6 }, (_, pad) => `pad ${index}.${pad}`).join("\n")}`,
    );
    writeFileSync(join(workspace, "dense.ts"), dense.join("\n") + "\n");
    await read({ path: "dense.ts" });

    const result = await edit({
      path: "dense.ts",
      oldString: "x",
      newString: "y",
      replaceAll: true,
    });

    expect(result).toContain("Edited dense.ts (30 occurrences)");
    expect(result).toMatch(/span more than 40 lines; read the file/);
    expect(result).not.toContain("pad 20.");
  });
});

describe("a write says which directories it brought into existence", () => {
  it("names a parent directory that did not exist", async () => {
    const result = await write({ path: "fresh/deep/file.ts", content: "x\n" });

    expect(result).toContain("Created fresh/deep/file.ts");
    // The typo case this exists for: `src/componets/Button.tsx` reported as a
    // plain success is a mistake nothing downstream contradicts.
    expect(result).toMatch(/directories .*fresh/);
    expect(result).toContain("deep");
  });

  it("says nothing extra when every parent was already there", async () => {
    const result = await write({ path: "src/other.ts", content: "x\n" });

    expect(result).toBe("Created src/other.ts");
  });

  it("says nothing extra for a file at the workspace root", async () => {
    const result = await write({ path: "root.ts", content: "x\n" });

    expect(result).toBe("Created root.ts");
  });
});

describe("read states its own limits", () => {
  it("names the line window, the line length, and the file size in its description", () => {
    const descriptor = gate
      .list()
      .find((candidate) => candidate.id.name === "read");

    expect(descriptor?.description).toContain("2000 lines");
    expect(descriptor?.description).toContain("2000 characters");
    expect(descriptor?.description).toContain("1 MB");
  });
});

describe("the three tools share one record of what was read", () => {
  it("lets an edit follow a write with no re-read", async () => {
    // A file the model just wrote is a file it knows the contents of.
    await write({ path: "fresh.ts", content: "start" });

    expect(
      await edit({ path: "fresh.ts", oldString: "start", newString: "finished" }),
    ).toMatch(/edited/i);
  });

  it("lets an edit follow an edit with no re-read", async () => {
    await read({ path: "src/app.ts" });
    await edit({ path: "src/app.ts", oldString: "const a = 1;", newString: "const a = 2;" });

    expect(
      await edit({ path: "src/app.ts", oldString: "const a = 2;", newString: "const a = 3;" }),
    ).toMatch(/edited/i);
  });

  it("forgets a conversation when it ends", () => {
    const standalone = new FileAccessLog();
    standalone.record(SCOPE, "C:/x/a.ts", { modifiedAt: 1, size: 1 });
    standalone.forget(SCOPE.conversationId);

    expect(standalone.get(SCOPE, "C:/x/a.ts")).toBeUndefined();
  });

  it("does not confuse two conversations whose ids and paths overlap", () => {
    // With a space between the two halves, conversation "a" with path "b c"
    // and conversation "a b" with path "c" were one key — and keeping one
    // conversation's reads away from another's is the whole job.
    const standalone = new FileAccessLog();
    const first = { ...SCOPE, conversationId: "a" };
    const second = { ...SCOPE, conversationId: "a b" };

    standalone.record(first, "b c", { modifiedAt: 1, size: 1 });

    expect(standalone.get(first, "b c")?.modifiedAt).toBe(1);
    expect(standalone.get(second, "c")).toBeUndefined();
  });

  it("forgets only the conversation it was asked about", () => {
    const standalone = new FileAccessLog();
    const first = { ...SCOPE, conversationId: "a" };
    const second = { ...SCOPE, conversationId: "a b" };

    standalone.record(first, "x.ts", { modifiedAt: 1, size: 1 });
    standalone.record(second, "x.ts", { modifiedAt: 2, size: 2 });
    standalone.forget("a");

    expect(standalone.get(first, "x.ts")).toBeUndefined();
    // A space-prefixed match would have swept this away too.
    expect(standalone.get(second, "x.ts")?.modifiedAt).toBe(2);
  });
});

describe("a window past the end of the file says so", () => {
  it("names the offset and the length rather than returning nothing", () => {
    // The empty string was indistinguishable from an empty file and from a
    // failed read, so the model answered as though the file held nothing.
    const output = formatNumbered("one\ntwo\n", 50, 100);

    expect(output).toContain("offset 50");
    expect(output).toContain("2 lines");
  });

  it("counts one line in the singular", () => {
    expect(formatNumbered("only\n", 9, 10)).toContain("1 line)");
  });
});

describe("a file's own line endings survive an edit", () => {
  it("matches text copied out of a read against a CRLF file", async () => {
    // `read` shows lines without their carriage returns, so a model copying
    // two of them back sends "\n" where the file holds "\r\n". Before this,
    // every multi-line edit of a Windows file failed to match.
    writeFileSync(join(workspace, "crlf.ts"), "const a = 1;\r\nconst b = 2;\r\n");
    await read({ path: "crlf.ts" });

    await edit({
      path: "crlf.ts",
      oldString: "const a = 1;\nconst b = 2;",
      newString: "const a = 9;\nconst b = 8;",
    });

    const after = readFileSync(join(workspace, "crlf.ts"), "utf8");
    expect(after).toBe("const a = 9;\r\nconst b = 8;\r\n");
  });

  it("leaves an LF file alone", async () => {
    await read({ path: "src/app.ts" });
    await edit({
      path: "src/app.ts",
      oldString: "const a = 1;\nconst b = 2;",
      newString: "const a = 9;",
    });

    expect(readFileSync(join(workspace, "src", "app.ts"), "utf8")).toBe("const a = 9;\n");
  });
});

describe("two writers to one file", () => {
  it("does not lose one of two edits issued together", async () => {
    // Each edit is a read, a computation, and a write across several awaits.
    // Interleaved, both read the same content and the second overwrote the
    // first - while both reported success. Serialized per path, the second
    // reads what the first wrote.
    await read({ path: "src/app.ts" });

    await Promise.all([
      edit({ path: "src/app.ts", oldString: "const a = 1;", newString: "const a = 9;" }),
      edit({ path: "src/app.ts", oldString: "const b = 2;", newString: "const b = 8;" }),
    ]);

    const after = readFileSync(join(workspace, "src", "app.ts"), "utf8");
    expect(after).toContain("const a = 9;");
    expect(after).toContain("const b = 8;");
  });
});

describe("what counts as the file having changed", () => {
  it("catches a rewrite that kept the modification time", () => {
    // FAT, exFAT and network shares keep timestamps to a second or two, and
    // some writers restore them outright. A different size is proof of a
    // different file and costs nothing - the stat was already taken.
    const log = new FileAccessLog();
    log.record(SCOPE, "C:/x/a.ts", { modifiedAt: 10, size: 100 });

    expect(() =>
      log.assertSafeToModify(SCOPE, "C:/x/a.ts", {
        exists: true,
        modifiedAt: 10,
        size: 120,
      }),
    ).toThrow(ToolError);
  });

  it("believes the content over the timestamp when both are known", () => {
    const log = new FileAccessLog();
    log.record(SCOPE, "C:/x/a.ts", { modifiedAt: 10, size: 100, contentHash: "abc" });

    // Same bytes, later timestamp: a formatter that rewrote the file
    // identically has changed nothing the model needs to re-read.
    expect(() =>
      log.assertSafeToModify(SCOPE, "C:/x/a.ts", {
        exists: true,
        modifiedAt: 99,
        size: 100,
        contentHash: "abc",
      }),
    ).not.toThrow();

    // Different bytes, unchanged timestamp: changed, whatever the clock says.
    expect(() =>
      log.assertSafeToModify(SCOPE, "C:/x/a.ts", {
        exists: true,
        modifiedAt: 10,
        size: 100,
        contentHash: "def",
      }),
    ).toThrow(ToolError);
  });
});

describe("every tool goes through the gate", () => {
  it("registers exactly the five filesystem capabilities", () => {
    // No `list` tool: glob covers it, and two ways to enumerate a directory is
    // one more permission surface than the capability needs. No `mkdir` tool
    // either: `write` creates every missing parent already, so the only thing
    // one would buy is an empty directory.
    expect(gate.list().map((tool) => tool.id.name).sort()).toEqual([
      "delete",
      "edit",
      "move",
      "read",
      "write",
    ]);
  });

  it("declares reading as read-only and the others as writing", () => {
    const byName = new Map(gate.list().map((tool) => [tool.id.name, tool.effects]));

    expect(byName.get("read")).toEqual(["read"]);
    expect(byName.get("write")).toEqual(["write"]);
    expect(byName.get("edit")).toEqual(["write"]);
    expect(byName.get("delete")).toEqual(["write"]);
    expect(byName.get("move")).toEqual(["write"]);
  });

  it("marks the calls whose retry meets a changed file as not idempotent", () => {
    // Editing twice: the old string is gone the second time. Deleting twice:
    // the second call finds the path already gone. Moving twice: the source
    // is already where it was going. Each is a correct refusal, not a safe
    // retry - which matters when a call fails with an unknown outcome. A
    // repeated write, by contrast, lands the same file.
    const byName = new Map(gate.list().map((tool) => [tool.id.name, tool.idempotent]));

    expect(byName.get("write")).toBe(true);
    expect(byName.get("edit")).toBe(false);
    expect(byName.get("delete")).toBe(false);
    expect(byName.get("move")).toBe(false);
  });

  it("surfaces a bad argument as a tool error, not a crash", async () => {
    await expect(read({ path: "src/app.ts", offset: 0 })).rejects.toThrow(ToolError);
  });
});

/**
 * What a batch of tool calls does to one file.
 *
 * A model returns several tool calls in one assistant message and they are
 * dispatched together, so two of them can be inside `edit` on the same file at
 * the same instant. Edit is read-modify-write, which is the classic shape of a
 * lost update: both read the original, both write, and the second overwrites
 * the first while the model is told that both succeeded.
 *
 * `PathLocks` is the answer and has its own tests in `path-locks.test.ts`.
 * These are the tools using it - the property stated where a person would look
 * for it, through the gate, on a real file.
 */
describe("tool calls arriving together", () => {
  it("keeps both edits to one file, rather than losing the first", async () => {
    // Edit refuses a file this conversation has not read - the guard in
    // `FileAccessLog` - so the read that a model would have made first is
    // made here too.
    await read({ path: "src/app.ts" });

    // Started together, never awaited in turn: this is a batch, not a
    // sequence. Both calls see `src/app.ts` as it was.
    const [first, second] = await Promise.all([
      edit({ path: "src/app.ts", oldString: "const a = 1;", newString: "const a = 11;", replaceAll: false }),
      edit({ path: "src/app.ts", oldString: "const b = 2;", newString: "const b = 22;", replaceAll: false }),
    ]);

    expect(first).toBeTypeOf("string");
    expect(second).toBeTypeOf("string");

    // Both landed. Without the per-path lock the second edit would have been
    // applied to the content the first had already replaced, and one of these
    // two lines would still hold its original value.
    const content = readFileSync(join(workspace, "src", "app.ts"), "utf8");
    expect(content).toContain("const a = 11;");
    expect(content).toContain("const b = 22;");
  });

  it("refuses the second edit when the first removed what it was looking for", async () => {
    await read({ path: "src/app.ts" });

    // The honest failure, and the reason serializing is not the same as
    // pretending there was no conflict: the second call is measured against
    // the file as the first one left it, so a genuine conflict is a refusal
    // the model can react to rather than a silently discarded write.
    const results = await Promise.allSettled([
      edit({ path: "src/app.ts", oldString: "const a = 1;", newString: "gone", replaceAll: false }),
      edit({ path: "src/app.ts", oldString: "const a = 1;", newString: "also gone", replaceAll: false }),
    ]);

    const kinds = results.map((result) => result.status).sort();
    expect(kinds).toEqual(["fulfilled", "rejected"]);

    const content = readFileSync(join(workspace, "src", "app.ts"), "utf8");
    expect(content).toContain("gone");
    expect(content).not.toContain("also gone");
  });

  it("writes different files at the same time without interfering", async () => {
    await Promise.all([
      write({ path: "one.txt", content: "first" }),
      write({ path: "two.txt", content: "second" }),
    ]);

    expect(readFileSync(join(workspace, "one.txt"), "utf8")).toBe("first");
    expect(readFileSync(join(workspace, "two.txt"), "utf8")).toBe("second");
  });
});

/**
 * A private gate, for the tests that need more than the shared one: a log
 * whose records they can read, a second writable root, or the undo history
 * behind the gate. The shared `gate` answers to nobody's assertions.
 *
 * Each call needs its own `PermissionKernel`, because registration refuses a
 * duplicate rather than updating in place - the same refusal the gate itself
 * gives, at the door below it.
 */
function privateGate(options: {
  log?: FileAccessLog;
  policy?: SandboxPolicy;
  snapshots?: SnapshotHook;
}): CallGate {
  const kernel = new PermissionKernel({
    grants: new PermissionGrantStore(db),
    // Writing asks by default; an always-approving user keeps these tests
    // about the tools, exactly as the shared gate's kernel does.
    approver: { request: async () => ({ verdict: "allow", duration: "always" }) },
  });
  const instance = new CallGate({
    kernel,
    sandbox: new LocalSandbox(options.policy ?? createSandboxPolicy({ workspaceRoot: workspace })),
    ...(options.snapshots === undefined ? {} : { snapshots: options.snapshots }),
  });
  registerFilesystemTools(instance, options.log ?? new FileAccessLog());
  return instance;
}

const SCOPE_CALLS = (gate: CallGate) => (name: string, input: unknown, scope = SCOPE) =>
  gate.call({ name, input, scope });

describe("delete", () => {
  const call = (input: unknown) =>
    gate.call({ name: "native/delete", input, scope: SCOPE }) as Promise<string>;

  it("removes a file the conversation has read, and says how the deletion is undone", async () => {
    await read({ path: "src/app.ts" });

    const note = await call({ path: "src/app.ts" });

    expect(note).toContain("Deleted src/app.ts.");
    // Inside the workspace root, the honest answer: the shadow repository,
    // not this conversation, holds what is needed to put it back.
    expect(note).toContain("snapshot history");
    expect(existsSync(join(workspace, "src", "app.ts"))).toBe(false);
  });

  it("does not demand a read of a file this conversation wrote", async () => {
    // The write is a read as far as the log is concerned - the tool knows
    // what it just put there, and `write` records it. Editing without
    // re-reading has worked this way since the rule shipped; deleting is
    // the same bargain, or the rule would charge a second look for a file
    // whose contents are already known.
    await write({ path: "mine.txt", content: "ours" });

    await call({ path: "mine.txt" });

    expect(existsSync(join(workspace, "mine.txt"))).toBe(false);
  });

  it("refuses a file the conversation has never seen", async () => {
    writeFileSync(join(workspace, "unread.txt"), "not yours yet");

    await expect(call({ path: "unread.txt" })).rejects.toThrow(/has not been read yet/);
    expect(existsSync(join(workspace, "unread.txt"))).toBe(true);
  });

  it("refuses a path that is not there", async () => {
    await expect(call({ path: "missing.txt" })).rejects.toThrow(/does not exist/);
  });

  it("refuses a directory until recursive is passed, then takes everything under it", async () => {
    // Deliberately unread files inside: a directory cannot be read (`read`
    // refuses one), so the read-first rule cannot reach in here, and the
    // explicit `recursive` is the acknowledgment instead.
    mkdirSync(join(workspace, "tree", "deep"), { recursive: true });
    writeFileSync(join(workspace, "tree", "a.txt"), "a");
    writeFileSync(join(workspace, "tree", "deep", "b.txt"), "b");

    await expect(call({ path: "tree" })).rejects.toThrow(/recursive: true/);
    expect(existsSync(join(workspace, "tree"))).toBe(true);

    await call({ path: "tree", recursive: true });

    expect(existsSync(join(workspace, "tree"))).toBe(false);
  });

  it("refuses the workspace root, which the agent itself stands in", async () => {
    // Everything below it is a legitimate delete; the root is the one path
    // whose removal ends the conversation's ability to work at all.
    await expect(call({ path: ".", recursive: true })).rejects.toThrow(/workspace root/);
    expect(existsSync(join(workspace, "src", "app.ts"))).toBe(true);
  });
});

describe("a delete outside the workspace root", () => {
  let log: FileAccessLog;
  let other: string;
  let home: string;
  let previousHome: string | undefined;
  let outsideGate: CallGate;
  const call = (name: string, input: unknown, scope = SCOPE) =>
    outsideGate.call({ name, input, scope });

  beforeEach(() => {
    other = mkdtempSync(join(tmpdir(), "studio-fs-other-"));
    home = mkdtempSync(join(tmpdir(), "studio-fs-home-"));
    // `studioHome()` reads this per call, so setting it here directs the
    // trash - and nothing else in this suite, which uses no other part of
    // the Studio home.
    previousHome = process.env.PROJECT_STUDIO_HOME;
    process.env.PROJECT_STUDIO_HOME = home;
    log = new FileAccessLog();
    outsideGate = privateGate({
      log,
      policy: createSandboxPolicy({
        workspaceRoot: workspace,
        readRoots: [other],
        writeRoots: [workspace, other],
      }),
    });
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
    else process.env.PROJECT_STUDIO_HOME = previousHome;
    rmSync(other, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it("moves the deleted path into the conversation's trash, rather than destroying it", async () => {
    // A granted folder is outside the shadow repository's work tree: no
    // capture of this conversation ever contained this file, so the delete
    // would be permanent if the tool did not provide the recovery itself.
    const note = join(other, "notes.txt");
    await call("native/write", { path: note, content: "travels" });

    const result = (await call("native/delete", { path: note })) as string;

    expect(result).toContain("trash at");
    expect(existsSync(note)).toBe(false);

    const trashRoot = conversationTrashDirectory(SCOPE.conversationId);
    expect(trashRoot.startsWith(join(home, "data", "conversations"))).toBe(true);
    const [entry] = readdirSync(trashRoot);
    expect(entry).toBeDefined();

    expect(readFileSync(join(trashRoot, entry!, "content"), "utf8")).toBe("travels");

    const origin = JSON.parse(readFileSync(join(trashRoot, entry!, "origin.json"), "utf8")) as {
      originalPath: string;
      originalName: string;
      conversationId: string;
    };
    expect(origin.originalPath).toBe(note);
    expect(origin.originalName).toBe("notes.txt");
    expect(origin.conversationId).toBe(SCOPE.conversationId);

    // And the access log closes the circle: the deletion recorded against
    // the resolved path, the same record every other modification leaves.
    expect(log.get(SCOPE, note)).toEqual({ modifiedAt: 0, size: 0 });
  });

  it("moves between the roots, and says so when the history cannot help", async () => {
    const from = join(workspace, "brief.txt");
    await call("native/write", { path: from, content: "crossing" });
    const to = join(other, "brief.txt");

    const result = (await call("native/move", { from, to, overwrite: false })) as string;

    // Neither endpoint is inside the workspace root's history, so the honest
    // note is the cheaper one: the bytes moved, nothing was lost, and the
    // move back is the undo.
    expect(result).toContain("moving it back undoes this");
    expect(existsSync(from)).toBe(false);
    expect(readFileSync(to, "utf8")).toBe("crossing");
  });
});

describe("a delete inside the project, undone", () => {
  it("brings the deleted file back from the point taken before the delete", async () => {
    // Real git, through the real gate: the same shadow repository the
    // runtime keeps, pointed at this test's workspace. A mocked capture
    // would prove only that the code believes in its own contract.
    const snapshotRoot = mkdtempSync(join(tmpdir(), "studio-fs-snapshots-"));
    try {
      const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
      const snapshots = new TurnSnapshots({ store });
      const call = SCOPE_CALLS(privateGate({ snapshots }));

      // prepareModelTurn opens a turn before any tool of it runs, so the
      // conversation's first write is already the second turn's candidate:
      // the runtime's own sequence, not an extra courtesy.
      snapshots.beginTurn();

      // The conversation's first write opens the turn's undo point.
      await call("native/write", {
        path: "src/kept.txt",
        content: "the conversation's version",
      });
      snapshots.beginTurn();

      // The delete is the turn's first write, so its undo point is taken
      // now - a capture that must already contain the file it is about to
      // lose. This is the gate's ordering, not the test's.
      const note = (await call("native/delete", { path: "src/kept.txt" })) as string;
      expect(note).toContain("snapshot history");
      expect(existsSync(join(workspace, "src", "kept.txt"))).toBe(false);

      const [latest, prior] = await store.list();
      expect(latest?.label).toBe("turn 2");
      expect(prior?.label).toBe("turn 1");

      await store.restore(latest!.id);

      expect(readFileSync(join(workspace, "src", "kept.txt"), "utf8")).toBe(
        "the conversation's version",
      );
    } finally {
      rmSync(snapshotRoot, { recursive: true, force: true });
    }
  });
});

describe("move", () => {
  const move = (input: unknown) =>
    gate.call({ name: "native/move", input, scope: SCOPE }) as Promise<string>;

  it("renames, and the contents arrive unchanged", async () => {
    await write({ path: "before.txt", content: "the contents" });

    const note = await move({ from: "before.txt", to: "after.txt" });

    expect(note).toContain("Moved before.txt to after.txt.");
    expect(existsSync(join(workspace, "before.txt"))).toBe(false);
    expect(readFileSync(join(workspace, "after.txt"), "utf8")).toBe("the contents");
    // Both endpoints answered to the workspace, so the history holds both.
    expect(note).toContain("snapshot history");
  });

  it("moves a directory, its files, and its subtrees", async () => {
    mkdirSync(join(workspace, "folder", "deeper"), { recursive: true });
    writeFileSync(join(workspace, "folder", "in.txt"), "inside");
    writeFileSync(join(workspace, "folder", "deeper", "down.txt"), "down");

    await move({ from: "folder", to: "relocated" });

    expect(readFileSync(join(workspace, "relocated", "in.txt"), "utf8")).toBe("inside");
    expect(readFileSync(join(workspace, "relocated", "deeper", "down.txt"), "utf8")).toBe("down");
    expect(existsSync(join(workspace, "folder"))).toBe(false);
  });

  it("refuses to land on a taken path, unless the takeover is asked for", async () => {
    await write({ path: "one.txt", content: "one" });
    await write({ path: "two.txt", content: "two" });

    await expect(move({ from: "one.txt", to: "two.txt" })).rejects.toThrow(
      /already exists. Add overwrite/,
    );
    expect(readFileSync(join(workspace, "two.txt"), "utf8")).toBe("two");

    // The casualty was written by this conversation, so the read-first rule
    // is already satisfied by the write, as it is for `edit`.
    await move({ from: "one.txt", to: "two.txt", overwrite: true });

    expect(readFileSync(join(workspace, "two.txt"), "utf8")).toBe("one");
    expect(existsSync(join(workspace, "one.txt"))).toBe(false);
  });

  it("refuses to overwrite a destination the conversation has not read", async () => {
    // Neither path was written through the tool, so neither observation
    // exists: overwriting would be the blind replacement the read-first
    // rule exists to prevent.
    writeFileSync(join(workspace, "one.txt"), "one");
    writeFileSync(join(workspace, "two.txt"), "two");

    await expect(move({ from: "one.txt", to: "two.txt", overwrite: true })).rejects.toThrow(
      /has not been read yet/,
    );
    expect(readFileSync(join(workspace, "two.txt"), "utf8")).toBe("two");
  });

  it("refuses to replace a directory wholesale, which is delete's work", async () => {
    mkdirSync(join(workspace, "occupied", "inner"), { recursive: true });
    writeFileSync(join(workspace, "occupied", "inner", "f.txt"), "f");
    writeFileSync(join(workspace, "wanderer.txt"), "x");

    await expect(move({ from: "wanderer.txt", to: "occupied", overwrite: true })).rejects.toThrow(
      /is a directory/,
    );
    expect(existsSync(join(workspace, "occupied", "inner", "f.txt"))).toBe(true);
    expect(existsSync(join(workspace, "wanderer.txt"))).toBe(true);
  });

  it("refuses a source that is not there", async () => {
    await expect(move({ from: "nowhere.txt", to: "x.txt" })).rejects.toThrow(/does not exist/);
  });

  it("refuses the move that moves nothing", async () => {
    await write({ path: "still.txt", content: "one" });

    await expect(move({ from: "still.txt", to: "./still.txt" })).rejects.toThrow(/same path/);
  });

  it("refuses a directory moved into itself, which loses the inner copy's source", async () => {
    mkdirSync(join(workspace, "outer", "inside"), { recursive: true });
    writeFileSync(join(workspace, "outer", "in.txt"), "x");

    await expect(move({ from: "outer", to: "outer/inside" })).rejects.toThrow(/inside itself/);
  });

  it("creates the destination's missing parents, and says it did", async () => {
    await write({ path: "traveller.txt", content: "x" });

    const note = await move({ from: "traveller.txt", to: "a/b/c.txt" });

    // The same report `write` gives, for the same silent creation - and the
    // same reason: a mistyped destination reads as success until something
    // names where the file actually went.
    expect(note).toContain("Created directories a, a/b, which did not exist.");
    expect(readFileSync(join(workspace, "a", "b", "c.txt"), "utf8")).toBe("x");
  });

  it("refuses the workspace root as either end, through the sandbox", async () => {
    // The tool's own checks answer most shapes; the primitive's guard is
    // what a direct caller meets, and what keeps the two stories the same.
    const sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace }));

    await expect(sandbox.rename(".", "elsewhere")).rejects.toThrow(/workspace root/);
    await expect(sandbox.rename("src", ".")).rejects.toThrow(/workspace root/);
    expect(existsSync(join(workspace, "src", "app.ts"))).toBe(true);
  });
});

describe("delete and move leave their records", () => {
  it("records the deleted path as absent, and the moved source likewise but the destination never", async () => {
    const log = new FileAccessLog();
    const ownGate = privateGate({ log });
    const call = (name: string, input: unknown) =>
      ownGate.call({ name, input, scope: SCOPE });

    await call("native/write", { path: "gone.txt", content: "first" });
    await call("native/delete", { path: "gone.txt" });

    expect(log.get(SCOPE, join(workspace, "gone.txt"))).toEqual({ modifiedAt: 0, size: 0 });

    await call("native/write", { path: "src/thing.ts", content: "contents" });
    await call("native/move", { from: "src/thing.ts", to: "renamed.ts" });

    // The old path: absent, exactly as a deletion reads.
    expect(log.get(SCOPE, join(workspace, "src", "thing.ts"))).toEqual({
      modifiedAt: 0,
      size: 0,
    });
    // The destination: deliberately nothing. This conversation has moved the
    // file but never seen what it contains, and the log only speaks for what
    // was seen - so the next edit reads first, which is the rule.
    expect(log.get(SCOPE, join(workspace, "renamed.ts"))).toBeUndefined();
  });

  it("asks for a fresh read of a file that reappeared at a deleted path", async () => {
    const log = new FileAccessLog();
    const ownGate = privateGate({ log });
    const call = (name: string, input: unknown) =>
      ownGate.call({ name, input, scope: SCOPE });

    await call("native/read", { path: "src/app.ts" });
    await call("native/delete", { path: "src/app.ts" });
    writeFileSync(join(workspace, "src", "app.ts"), "someone else recreated it\n");

    // The log's last word on this path was the deletion; a new occupant is
    // not the file that was read, and the next modification says so rather
    // than editing against the memory of the departed one.
    await expect(
      call("native/edit", {
        path: "src/app.ts",
        oldString: "someone else recreated it",
        newString: "x",
      }),
    ).rejects.toThrow(/changed after it was read/);
  });
});
