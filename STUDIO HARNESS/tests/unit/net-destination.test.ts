import { describe, expect, it } from "vitest";

import {
  DestinationError,
  isPrivateHost,
  parseDestination,
} from "../../src/net/destination.js";

/**
 * ADR 0022, first half. These are the addresses that are never offered and can
 * never be granted, so the test is about refusal, not about permission.
 */

describe("a destination is checked before it is a resource", () => {
  it("returns the host as the permission resource", () => {
    expect(parseDestination("https://Docs.Example.com/a/b?q=1").host).toBe(
      "docs.example.com",
    );
  });

  it("refuses anything that is not http or https", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "data:text/html,<script>",
      "javascript:alert(1)",
    ]) {
      expect(() => parseDestination(url), url).toThrow(DestinationError);
    }
  });

  it("refuses loopback, private ranges, and the cloud metadata address", () => {
    // 169.254.169.254 serves instance credentials to anything that asks. It is
    // the single most valuable address to be tricked into fetching.
    for (const host of [
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "localhost",
      "anything.localhost",
      "printer.local",
      "db.internal",
    ]) {
      expect(isPrivateHost(host), host).toBe(true);
      expect(() => parseDestination(`https://${host}/x`), host).toThrow(
        DestinationError,
      );
    }
  });

  it("refuses IPv6 loopback and its IPv4-mapped spelling", () => {
    // ::ffff:127.0.0.1 is the standard way to write a blocked IPv4 address in a
    // form an IPv4-only check misses.
    for (const host of ["[::1]", "[::]", "[fc00::1]", "[fe80::1]", "[::ffff:127.0.0.1]"]) {
      expect(() => parseDestination(`https://${host}/x`), host).toThrow(
        DestinationError,
      );
    }
  });

  it("allows public addresses that merely look close to a private one", () => {
    for (const host of [
      "172.32.0.1",
      "172.15.0.1",
      "192.169.1.1",
      "11.0.0.1",
      "example.com",
      "local.example.com",
      "internal.example.com",
    ]) {
      expect(isPrivateHost(host), host).toBe(false);
    }
  });

  it("drops credentials written into the URL", () => {
    // They would travel into a log line and into the provider's request. The
    // address is still fetchable, so they are removed rather than refused.
    const destination = parseDestination("https://user:secret@example.com/x");

    expect(destination.url).not.toContain("secret");
    expect(destination.url).not.toContain("user");
    expect(destination.host).toBe("example.com");
  });

  it("refuses a trailing-dot spelling of a blocked name", () => {
    expect(isPrivateHost("localhost.")).toBe(true);
  });
});
