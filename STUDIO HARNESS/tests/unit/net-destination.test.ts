import { describe, expect, it } from "vitest";

import {
  DestinationError,
  classifyHostPort,
  destinationResource,
  isPrivateHost,
  parseDestination,
  parseHostPort,
} from "../../src/net/destination.js";
import {
  isOwnPort,
  registerOwnPort,
  unregisterOwnPort,
} from "../../src/net/own-ports.js";

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

describe("classification names why a destination is refused", () => {
  it("classifies an ordinary internet host as public", () => {
    expect(classifyHostPort({ host: "example.com", port: 443 })).toBe("public");
  });

  it("classifies IPv4 loopback as loopback", () => {
    expect(classifyHostPort({ host: "127.0.0.1", port: 3000 })).toBe("loopback");
  });

  it("classifies the localhost name as loopback", () => {
    expect(classifyHostPort({ host: "localhost", port: 3000 })).toBe("loopback");
  });

  it("classifies IPv6 loopback as loopback", () => {
    expect(classifyHostPort({ host: "[::1]", port: 443 })).toBe("loopback");
    expect(classifyHostPort({ host: "::1", port: 443 })).toBe("loopback");
  });

  it("classifies both spellings of IPv4-mapped loopback the same", () => {
    // new URL rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1; both spellings must
    // classify the same, or the rewritten form lets loopback through.
    expect(classifyHostPort({ host: "[::ffff:127.0.0.1]", port: 443 })).toBe(
      "loopback",
    );
    expect(classifyHostPort({ host: "[::ffff:7f00:1]", port: 443 })).toBe(
      "loopback",
    );
  });

  it("classifies private IPv4 ranges as private", () => {
    for (const host of [
      "10.0.0.5",
      "192.168.1.1",
      "172.16.0.1",
      "172.31.255.255",
    ]) {
      expect(classifyHostPort({ host, port: 443 }), host).toBe("private");
    }
  });

  it("classifies the boundaries of 172.16/12 correctly", () => {
    // 172.15 and 172.32 sit either side of the private range; a classic
    // off-by-one lets one of them through.
    expect(classifyHostPort({ host: "172.15.0.1", port: 443 })).toBe("public");
    expect(classifyHostPort({ host: "172.32.0.1", port: 443 })).toBe("public");
  });

  it("classifies the cloud metadata address as private", () => {
    // 169.254.169.254 serves instance credentials to anything that asks. It is
    // the single most valuable address to be tricked into fetching.
    expect(classifyHostPort({ host: "169.254.169.254", port: 443 })).toBe(
      "private",
    );
  });

  it("classifies carrier-grade NAT as private", () => {
    expect(classifyHostPort({ host: "100.64.0.1", port: 443 })).toBe("private");
  });

  it("classifies multicast as private", () => {
    expect(classifyHostPort({ host: "224.0.0.1", port: 443 })).toBe("private");
  });

  it("classifies local-network suffixes as private", () => {
    for (const host of ["foo.local", "foo.internal", "foo.home.arpa"]) {
      expect(classifyHostPort({ host, port: 443 }), host).toBe("private");
    }
  });

  it("classifies the .localhost tree as loopback, not merely private", () => {
    // RFC 6761 reserves the whole tree for this machine. The distinction is
    // invisible today because both are refused, and it stops being invisible
    // the moment a loopback policy exists.
    expect(classifyHostPort({ host: "api.localhost", port: 3000 })).toBe(
      "loopback",
    );
  });

  it("classifies a trailing-dot host the same as the bare name", () => {
    expect(classifyHostPort({ host: "example.com.", port: 443 })).toBe("public");
    expect(classifyHostPort({ host: "example.com", port: 443 })).toBe("public");
  });

  it("classifies regardless of case", () => {
    expect(classifyHostPort({ host: "EXAMPLE.COM", port: 443 })).toBe("public");
    expect(classifyHostPort({ host: "example.com", port: 443 })).toBe("public");
  });
});

describe("the port is defaulted from the scheme", () => {
  it("fills 80 for http", () => {
    expect(parseHostPort("http://example.com/x").port).toBe(80);
  });

  it("fills 443 for https", () => {
    expect(parseHostPort("https://example.com/x").port).toBe(443);
  });

  it("keeps an explicit port", () => {
    expect(parseHostPort("http://example.com:8080/x").port).toBe(8080);
    expect(parseHostPort("https://example.com:8443/x").port).toBe(8443);
  });
});

describe("own ports are never reachable", () => {
  it("classifies a registered loopback port as own-port", () => {
    registerOwnPort(7331);
    try {
      expect(classifyHostPort({ host: "127.0.0.1", port: 7331 })).toBe(
        "own-port",
      );
      expect(classifyHostPort({ host: "localhost", port: 7331 })).toBe(
        "own-port",
      );
    } finally {
      unregisterOwnPort(7331);
    }
  });

  it("does not treat the same port number on a public host as own-port", () => {
    registerOwnPort(7331);
    try {
      expect(classifyHostPort({ host: "example.com", port: 7331 })).toBe(
        "public",
      );
    } finally {
      unregisterOwnPort(7331);
    }
  });

  it("classifies as loopback again after unregistering", () => {
    registerOwnPort(7332);
    unregisterOwnPort(7332);
    expect(classifyHostPort({ host: "127.0.0.1", port: 7332 })).toBe("loopback");
    // Cleanup is already done; verify the registry is empty for this port.
    expect(isOwnPort(7332)).toBe(false);
  });

  it("registering the same port twice is not an error", () => {
    registerOwnPort(7333);
    try {
      registerOwnPort(7333);
      expect(classifyHostPort({ host: "127.0.0.1", port: 7333 })).toBe(
        "own-port",
      );
    } finally {
      unregisterOwnPort(7333);
    }
  });
});

describe("the permission resource is host and sometimes port", () => {
  it("has no port for a public host", () => {
    expect(destinationResource({ host: "example.com", port: 443 })).toBe(
      "example.com",
    );
    expect(destinationResource({ host: "Docs.Example.COM", port: 443 })).toBe(
      "docs.example.com",
    );
  });

  it("includes the port for a loopback host", () => {
    expect(destinationResource({ host: "localhost", port: 3000 })).toBe(
      "localhost:3000",
    );
  });

  it("keeps an IPv6 literal in brackets so the port cannot be misread", () => {
    // `::1:443` is also a valid spelling of a different address, so an
    // unbracketed resource is a grant that can match what it never named.
    expect(destinationResource({ host: "::1", port: 443 })).toBe("[::1]:443");
    expect(destinationResource({ host: "[::1]", port: 443 })).toBe("[::1]:443");
  });

  it("produces different resources for different loopback ports", () => {
    const a = destinationResource({ host: "localhost", port: 3000 });
    const b = destinationResource({ host: "localhost", port: 9999 });
    expect(a).not.toBe(b);
    expect(a).toBe("localhost:3000");
    expect(b).toBe("localhost:9999");
  });
});

describe("no behaviour is changed that anyone can observe", () => {
  it("refuses loopback, private, and own-port all with kind private", () => {
    registerOwnPort(7334);
    try {
      for (const url of [
        "https://127.0.0.1/x",
        "https://10.0.0.5/x",
        "https://169.254.169.254/x",
        "https://127.0.0.1:7334/x",
        "https://localhost/x",
        "https://[::1]/x",
      ]) {
        let thrown: unknown;
        try {
          parseDestination(url);
        } catch (error) {
          thrown = error;
        }
        expect(thrown, url).toBeInstanceOf(DestinationError);
        if (thrown instanceof DestinationError) {
          expect(thrown.kind, url).toBe("private");
          expect(thrown.message, url).toBe(
            "That address is on this machine or this private network, so it cannot be fetched.",
          );
        }
      }
    } finally {
      unregisterOwnPort(7334);
    }
  });
});
