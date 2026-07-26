import { StudioAuthError } from "./errors.js";

export interface StudioAuthConfig {
  /** Project Studio auth worker root, without a trailing slash. */
  readonly authBaseUrl: string;
  /**
   * Google OAuth client id for the desktop harness. This must be a *public*
   * client (Google's "Desktop app" type): it lives on the user's machine, so it
   * has no client secret and signs in with PKCE instead.
   */
  readonly googleClientId: string;
  /** Overridable so tests can point the flow at a local mock Google. */
  readonly googleAuthorizeUrl: string;
  readonly googleTokenUrl: string;
  readonly requestTimeoutMs: number;
}

export interface StudioAuthConfigInput {
  readonly authBaseUrl?: string | undefined;
  readonly googleClientId?: string | undefined;
  readonly googleAuthorizeUrl?: string | undefined;
  readonly googleTokenUrl?: string | undefined;
  readonly requestTimeoutMs?: number | undefined;
}

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Same rule as the gateway base URL: a bearer token or an authorization code
 * must never travel over plain HTTP, except to a loopback address, which is
 * what the local mock servers in tests use.
 */
function validateUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StudioAuthError("configuration", {
      message: `${label} is not a valid absolute URL.`,
    });
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new StudioAuthError("configuration", {
      message: `${label} must use https. Plain http is allowed only for loopback hosts.`,
    });
  }
  if (url.username !== "" || url.password !== "") {
    throw new StudioAuthError("configuration", {
      message: `${label} must not embed credentials.`,
    });
  }
  return url;
}

function validateTimeout(raw: string | number | undefined): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new StudioAuthError("configuration", {
      message: "Sign-in request timeout must be an integer number of milliseconds.",
    });
  }
  if (value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new StudioAuthError("configuration", {
      message: `Sign-in request timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms.`,
    });
  }
  return value;
}

export function resolveStudioAuthConfig(
  input: StudioAuthConfigInput = {},
): StudioAuthConfig {
  const rawAuthBaseUrl = input.authBaseUrl ?? readEnv("PROJECT_STUDIO_AUTH_URL");
  if (rawAuthBaseUrl === undefined) {
    throw new StudioAuthError("configuration", {
      message:
        "Project Studio auth URL is required. Set PROJECT_STUDIO_AUTH_URL to the auth service root.",
    });
  }
  const authUrl = validateUrl(rawAuthBaseUrl, "Project Studio auth URL");

  const googleClientId =
    input.googleClientId ?? readEnv("PROJECT_STUDIO_GOOGLE_CLIENT_ID");
  if (googleClientId === undefined) {
    throw new StudioAuthError("configuration", {
      message:
        "Google desktop client id is required. Set PROJECT_STUDIO_GOOGLE_CLIENT_ID to the public (PKCE) OAuth client id.",
    });
  }

  const googleAuthorizeUrl = validateUrl(
    input.googleAuthorizeUrl ??
      readEnv("PROJECT_STUDIO_GOOGLE_AUTHORIZE_URL") ??
      GOOGLE_AUTHORIZE_URL,
    "Google authorize URL",
  );
  const googleTokenUrl = validateUrl(
    input.googleTokenUrl ??
      readEnv("PROJECT_STUDIO_GOOGLE_TOKEN_URL") ??
      GOOGLE_TOKEN_URL,
    "Google token URL",
  );

  return {
    authBaseUrl: `${authUrl.origin}${authUrl.pathname.replace(/\/+$/, "")}`,
    googleClientId,
    googleAuthorizeUrl: googleAuthorizeUrl.toString(),
    googleTokenUrl: googleTokenUrl.toString(),
    requestTimeoutMs: validateTimeout(
      input.requestTimeoutMs ?? readEnv("PROJECT_STUDIO_AUTH_TIMEOUT_MS"),
    ),
  };
}
