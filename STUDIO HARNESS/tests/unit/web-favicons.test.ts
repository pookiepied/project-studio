import { mkdtemp, readdir, rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FaviconStore, iconLinkIn, sniffImage } from "../../src/web/favicons.js";
import type { HttpBinaryResponse, HttpStream } from "../../src/net/http.js";

/**
 * A site's icon: `/favicon.ico` first, the page's own `<link rel="icon">`
 * second, judged by the bytes and never the header, kept on disk, and a
 * miss remembered for a day. Every request is scripted; nothing here
 * reaches the network.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10]);
const HTML = Buffer.from("<!doctype html><html><body>not an icon</body></html>");

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-favicons-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function binary(status: number, bytes: Buffer, url: string): HttpBinaryResponse {
  return { status, headers: {}, bytes, url };
}

function stream(status: number, body: string, url: string): HttpStream {
  const passage = new PassThrough();
  passage.end(body);
  return { status, headers: {}, url, body: passage as unknown as HttpStream["body"] };
}

describe("sniffing", () => {
  it("names the image kinds by their first bytes and refuses the rest", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(ICO)).toBe("image/x-icon");
    expect(sniffImage(Buffer.from("<?xml version=\"1.0\"?><svg xmlns=\"x\"></svg>"))).toBe("image/svg+xml");
    expect(sniffImage(HTML)).toBeNull();
    expect(sniffImage(Buffer.from([1, 2]))).toBeNull();
  });
});

describe("the icon link", () => {
  it("is the first rel=icon in the head, resolved against the page", () => {
    const html = `<head><link rel="stylesheet" href="/a.css"><link rel="shortcut icon" href="/static/fav.png?v=2"><link rel=icon href=other.ico></head>`;
    expect(iconLinkIn(html, "https://example.org/docs/intro")).toBe("https://example.org/static/fav.png?v=2");
  });

  it("is null when the head names none", () => {
    expect(iconLinkIn("<head><title>x</title></head>", "https://example.org/")).toBeNull();
  });
});

describe("the store", () => {
  it("answers from /favicon.ico when the site has one, and keeps it on disk", async () => {
    const requestBinary = vi.fn(async ({ url }: { url: string }) => binary(200, PNG, url));
    const requestStream = vi.fn();
    const store = new FaviconStore({ directory: root, requestBinary, requestStream });

    const icon = await store.lookup("Example.org");
    expect(icon?.mimeType).toBe("image/png");
    expect(requestBinary).toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.org/favicon.ico", author: "model" }));
    expect(requestStream).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual(["example.org.png"]);

    // A second store over the same directory answers without asking anyone.
    const again = new FaviconStore({ directory: root, requestBinary: vi.fn(), requestStream: vi.fn() });
    expect((await again.lookup("example.org"))?.bytes.equals(PNG)).toBe(true);
  });

  it("reads the page's head for a link when /favicon.ico is not an image", async () => {
    const requestBinary = vi.fn(async ({ url }: { url: string }) =>
      url.endsWith("/favicon.ico") ? binary(200, HTML, url) : binary(200, ICO, url),
    );
    const requestStream = vi.fn(async ({ url }: { url: string }) =>
      stream(200, `<html><head><link rel="icon" href="/i/mark.ico"></head><body>${"x".repeat(1000)}</body></html>`, url),
    );
    const store = new FaviconStore({ directory: root, requestBinary, requestStream });

    const icon = await store.lookup("example.org");
    expect(icon?.mimeType).toBe("image/x-icon");
    expect(requestBinary).toHaveBeenLastCalledWith(expect.objectContaining({ url: "https://example.org/i/mark.ico" }));
    expect(await readdir(root)).toEqual(["example.org.ico"]);
  });

  it("remembers a miss for a day and asks again after", async () => {
    // The miss file carries the real clock; the store's clock starts beside it.
    let now = Date.now();
    const requestBinary = vi.fn(async ({ url }: { url: string }) => binary(404, Buffer.alloc(0), url));
    const requestStream = vi.fn(async ({ url }: { url: string }) => stream(404, "", url));
    const store = new FaviconStore({ directory: root, requestBinary, requestStream, now: () => now });

    expect(await store.lookup("example.org")).toBeNull();
    expect(await readdir(root)).toEqual(["example.org.miss"]);

    const later = new FaviconStore({ directory: root, requestBinary, requestStream, now: () => now });
    expect(await later.lookup("example.org")).toBeNull();
    expect(requestBinary).toHaveBeenCalledTimes(1);

    now += 25 * 60 * 60 * 1_000;
    const nextDay = new FaviconStore({ directory: root, requestBinary, requestStream, now: () => now });
    expect(await nextDay.lookup("example.org")).toBeNull();
    expect(requestBinary).toHaveBeenCalledTimes(2);
  });

  it("refuses a private or malformed host before asking anything", async () => {
    const requestBinary = vi.fn();
    const store = new FaviconStore({ directory: root, requestBinary, requestStream: vi.fn() });
    expect(await store.lookup("localhost")).toBeNull();
    expect(await store.lookup("10.0.0.1")).toBeNull();
    expect(await store.lookup("not a host")).toBeNull();
    expect(await store.lookup("../etc")).toBeNull();
    expect(requestBinary).not.toHaveBeenCalled();
    expect(await readdir(root).catch(() => [])).toEqual([]);
  });
});
