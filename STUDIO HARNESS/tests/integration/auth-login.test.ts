import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StudioAuthClient } from "../../src/auth/auth-client.js";
import type { StudioAuthConfig } from "../../src/auth/config.js";
import { StudioAuthError } from "../../src/auth/errors.js";
import { signIn, isSignedIn, signOut } from "../../src/auth/login.js";
import { SessionAccessTokenProvider } from "../../src/auth/session-token-provider.js";
import { SessionStore } from "../../src/auth/session.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";

/**
 * Drives the real sign-in flow end to end against a local mock Google and a
 * local mock auth service. No Google account, no OAuth client, and no network
 * are involved: the flow's own loopback server, PKCE proof, state check, and
 * token exchange all run for real.
 */

/** Builds a JWT-shaped token. Only the exp claim is ever read by the harness. */
function jwt(expiresInSeconds: number, marker = "access"): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "user-1",
      email: "user@example.com",
      marker,
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    }),
  ).toString("base64url");
  return `${header}.${payload}.signature-not-verified-by-harness`;
}

interface MockServices {
  server: Server;
  origin: string;
  /** Every code exchange Google saw, so PKCE can be asserted. */
  exchanges: Array<Record<string, string>>;
  refreshCalls: string[];
  issuedRefreshTokens: string[];
  setRefreshStatus: (status: number) => void;
  authorizeRequests: string[];
}

async function startMockServices(): Promise<MockServices> {
  const exchanges: Array<Record<string, string>> = [];
  const refreshCalls: string[] = [];
  const issuedRefreshTokens: string[] = [];
  const authorizeRequests: string[] = [];
  let refreshStatus = 200;
  let refreshCounter = 0;

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");

      // Google's token endpoint.
      if (url.pathname === "/google/token") {
        exchanges.push(Object.fromEntries(new URLSearchParams(raw)));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id_token: "google-id-token", token_type: "Bearer" }));
        return;
      }

      // Studio auth service: ID token -> Studio session.
      if (url.pathname === "/google") {
        const body = JSON.parse(raw) as { idToken?: string };
        if (body.idToken !== "google-id-token") {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "Invalid ID token" }));
          return;
        }
        const refreshToken = jwt(604_800, "refresh-0");
        issuedRefreshTokens.push(refreshToken);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            accessToken: jwt(3600),
            refreshToken,
            expiresIn: 3600,
            user: { id: "user-1", email: "user@example.com", name: "Test User", role: "user" },
          }),
        );
        return;
      }

      if (url.pathname === "/refresh") {
        const body = JSON.parse(raw) as { refreshToken?: string };
        refreshCalls.push(body.refreshToken ?? "");
        if (refreshStatus !== 200) {
          response.writeHead(refreshStatus, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "Invalid refresh token" }));
          return;
        }
        refreshCounter += 1;
        const rotated = jwt(604_800, `refresh-${refreshCounter}`);
        issuedRefreshTokens.push(rotated);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            accessToken: jwt(3600, `access-${refreshCounter}`),
            refreshToken: rotated,
            expiresIn: 3600,
          }),
        );
        return;
      }

      response.writeHead(404).end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no mock port");

  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    exchanges,
    refreshCalls,
    issuedRefreshTokens,
    authorizeRequests,
    setRefreshStatus: (status: number) => {
      refreshStatus = status;
    },
  };
}

let mock: MockServices;
let credentials: InMemoryCredentialStore;
let config: StudioAuthConfig;

beforeEach(async () => {
  mock = await startMockServices();
  credentials = new InMemoryCredentialStore();
  config = {
    authBaseUrl: mock.origin,
    googleClientId: "desktop-client-id.apps.googleusercontent.com",
    googleAuthorizeUrl: `${mock.origin}/google/authorize`,
    googleTokenUrl: `${mock.origin}/google/token`,
    requestTimeoutMs: 5_000,
  };
});

afterEach(async () => {
  await new Promise<void>((resolve) => mock.server.close(() => resolve()));
});

/**
 * Stands in for the browser: reads the authorize URL the flow produced and
 * calls the loopback redirect the way Google would.
 */
function browserThatApproves(onUrl?: (url: URL) => void): (url: string) => Promise<void> {
  return async (raw: string) => {
    const url = new URL(raw);
    mock.authorizeRequests.push(raw);
    onUrl?.(url);

    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    await fetch(`${redirectUri}?code=auth-code-123&state=${encodeURIComponent(state ?? "")}`);
  };
}

describe("sign-in", () => {
  it("completes the PKCE loopback flow and stores a session", async () => {
    let authorizeUrl: URL | undefined;
    const user = await signIn({
      config,
      credentials,
      openBrowser: browserThatApproves((url) => {
        authorizeUrl = url;
      }),
    });

    expect(user.email).toBe("user@example.com");
    expect(await isSignedIn(credentials)).toBe(true);

    // The authorize request is a proper PKCE request for a public client.
    expect(authorizeUrl?.searchParams.get("response_type")).toBe("code");
    expect(authorizeUrl?.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl?.searchParams.get("client_id")).toBe(config.googleClientId);
    expect(authorizeUrl?.searchParams.get("redirect_uri")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );

    // The verifier actually matches the challenge that was sent.
    const exchange = mock.exchanges[0];
    const verifier = exchange?.code_verifier ?? "";
    const derived = createHash("sha256").update(verifier).digest("base64url");
    expect(derived).toBe(authorizeUrl?.searchParams.get("code_challenge"));

    // A public client sends no secret.
    expect(exchange).not.toHaveProperty("client_secret");
    expect(exchange?.grant_type).toBe("authorization_code");
  });

  it("stores access and refresh tokens as separate credential entries", async () => {
    await signIn({ config, credentials, openBrowser: browserThatApproves() });

    expect(await credentials.get({ scope: "session", id: "studio-access" })).toBeTruthy();
    expect(await credentials.get({ scope: "session", id: "studio-refresh" })).toBeTruthy();
    expect(credentials.size).toBe(2);
  });

  it("does not persist any Google credential", async () => {
    await signIn({ config, credentials, openBrowser: browserThatApproves() });

    const stored = [
      await credentials.get({ scope: "session", id: "studio-access" }),
      await credentials.get({ scope: "session", id: "studio-refresh" }),
    ].join(" ");
    expect(stored).not.toContain("google-id-token");
    expect(stored).not.toContain("auth-code-123");
  });

  it("rejects a redirect whose state does not match", async () => {
    const forgedBrowser = async (raw: string) => {
      const url = new URL(raw);
      const redirectUri = url.searchParams.get("redirect_uri");
      await fetch(`${redirectUri}?code=attacker-code&state=wrong-state`);
    };

    await expect(
      signIn({ config, credentials, openBrowser: forgedBrowser }),
    ).rejects.toMatchObject({ kind: "protocol" });
    expect(await isSignedIn(credentials)).toBe(false);
  });

  it("treats a denied consent screen as cancellation", async () => {
    const denyingBrowser = async (raw: string) => {
      const url = new URL(raw);
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      await fetch(
        `${redirectUri}?error=access_denied&state=${encodeURIComponent(state ?? "")}`,
      );
    };

    await expect(
      signIn({ config, credentials, openBrowser: denyingBrowser }),
    ).rejects.toMatchObject({ kind: "aborted" });
  });

  it("signs out by removing the stored session", async () => {
    await signIn({ config, credentials, openBrowser: browserThatApproves() });
    await signOut(credentials);

    expect(await isSignedIn(credentials)).toBe(false);
    expect(credentials.size).toBe(0);
  });
});

describe("session access token provider", () => {
  async function providerWithSession() {
    await signIn({ config, credentials, openBrowser: browserThatApproves() });
    const sessions = new SessionStore(credentials);
    return {
      sessions,
      provider: new SessionAccessTokenProvider({
        sessions,
        client: new StudioAuthClient(config),
      }),
    };
  }

  it("returns the stored token while it is still valid", async () => {
    const { provider } = await providerWithSession();

    await provider.getAccessToken();
    expect(mock.refreshCalls).toHaveLength(0);
  });

  it("refuses to produce a token when signed out", async () => {
    const provider = new SessionAccessTokenProvider({
      sessions: new SessionStore(credentials),
      client: new StudioAuthClient(config),
    });

    await expect(provider.getAccessToken()).rejects.toMatchObject({
      kind: "signed_out",
    });
  });

  it("renews an expiring token and stores the rotated refresh token", async () => {
    const { sessions, provider } = await providerWithSession();
    // A token already past its expiry, as if the harness had been idle.
    await sessions.save({ accessToken: jwt(-10), refreshToken: jwt(604_800, "refresh-0") });

    const token = await provider.getAccessToken();

    expect(mock.refreshCalls).toHaveLength(1);
    const stored = await sessions.load();
    expect(stored?.accessToken).toBe(token);
    // The rotated refresh token replaced the one that was just spent.
    expect(stored?.refreshToken).toBe(mock.issuedRefreshTokens.at(-1));
  });

  /**
   * The service rotates refresh tokens, so a second concurrent refresh would be
   * redeeming a token the first had already invalidated.
   */
  it("performs only one refresh for concurrent callers", async () => {
    const { sessions, provider } = await providerWithSession();
    await sessions.save({ accessToken: jwt(-10), refreshToken: jwt(604_800, "refresh-0") });

    const tokens = await Promise.all([
      provider.getAccessToken(),
      provider.getAccessToken(),
      provider.getAccessToken(),
    ]);

    expect(mock.refreshCalls).toHaveLength(1);
    expect(new Set(tokens).size).toBe(1);
  });

  it("clears the session when the refresh token is rejected", async () => {
    const { sessions, provider } = await providerWithSession();
    await sessions.save({ accessToken: jwt(-10), refreshToken: jwt(604_800, "refresh-0") });
    mock.setRefreshStatus(401);

    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(StudioAuthError);

    // Signed out rather than stuck retrying a token the service will not accept.
    expect(await sessions.load()).toBeNull();
  });

  it("keeps the session when a refresh fails for a transient reason", async () => {
    const { sessions, provider } = await providerWithSession();
    await sessions.save({ accessToken: jwt(-10), refreshToken: jwt(604_800, "refresh-0") });
    mock.setRefreshStatus(503);

    await expect(provider.getAccessToken()).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(await sessions.load()).not.toBeNull();
  });
});
