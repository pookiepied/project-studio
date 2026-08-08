import { ProviderConfigurationError } from "../../contracts/models.js";
import { StudioGatewayError } from "./errors.js";

/**
 * Supplies the Studio access token for an outbound gateway call.
 *
 * This is the injected authentication boundary for the adapter. In production
 * the public Project Studio application will supply the logged-in Studio
 * session token through this interface; the adapter never reads a credential
 * from a prompt, a model reference, or mutable global model state, so the token
 * can be rotated without touching the adapter and can never be reached by
 * model-selected arguments.
 */
export interface AccessTokenProvider {
  getAccessToken(signal?: AbortSignal): Promise<string>;
}

/** Printable ASCII excluding space: the characters a bearer token may use. */
const HEADER_UNSAFE = /[^\x21-\x7e]/;

/**
 * Header-safety check. A token containing whitespace or control characters
 * could split or forge headers; the offending value is never included in the
 * error text.
 */
export function assertHeaderSafeToken(token: string): string {
  if (token === "") {
    throw new StudioGatewayError("authentication", {
      message: "The Studio gateway access token is empty.",
    });
  }
  if (HEADER_UNSAFE.test(token)) {
    throw new StudioGatewayError("authentication", {
      message:
        "The Studio gateway access token contains characters that are not valid in an Authorization header.",
    });
  }
  return token;
}

export function createStaticAccessTokenProvider(
  token: string,
): AccessTokenProvider {
  const validated = assertHeaderSafeToken(token);
  return {
    getAccessToken: async () => validated,
  };
}

/**
 * Development-only bootstrap token provider.
 *
 * It reads a token from `PROJECT_STUDIO_GATEWAY_TOKEN` at call time so a
 * developer can point the harness at a gateway without wiring the application
 * session flow. This is NOT secure credential storage and NOT the BYOK
 * mechanism: it is a convenience for local development. Production must inject
 * an `AccessTokenProvider` backed by the authenticated application session;
 * that integration, and any secure credential storage BYOK requires, are
 * deferred to later phases.
 */
export function createEnvAccessTokenProvider(
  variableName = "PROJECT_STUDIO_GATEWAY_TOKEN",
): AccessTokenProvider {
  return {
    getAccessToken: async () => {
      const raw = process.env[variableName];
      if (raw === undefined || raw.trim() === "") {
        throw new StudioGatewayError("authentication", {
          message: `No Studio gateway access token is available. Set ${variableName}.`,
        });
      }
      return assertHeaderSafeToken(raw.trim());
    },
  };
}

/**
 * Whether a development bootstrap token is configured at all.
 *
 * Used to choose between the development token and the signed-in session. It
 * only reports presence and never returns or logs the value.
 */
export function hasEnvAccessToken(
  variableName = "PROJECT_STUDIO_GATEWAY_TOKEN",
): boolean {
  const raw = process.env[variableName];
  return raw !== undefined && raw.trim() !== "";
}

/**
 * Startup check for the development bootstrap token, so a missing or malformed
 * value fails before the harness starts rather than on the first model call.
 */
export function assertAccessTokenConfigured(
  variableName = "PROJECT_STUDIO_GATEWAY_TOKEN",
): void {
  const raw = process.env[variableName];
  if (raw === undefined || raw.trim() === "") {
    throw new ProviderConfigurationError(
      `Studio gateway access token is required. Set ${variableName} (development bootstrap), or inject an AccessTokenProvider.`,
    );
  }
  try {
    assertHeaderSafeToken(raw.trim());
  } catch {
    throw new ProviderConfigurationError(
      `Studio gateway access token in ${variableName} is not a valid Authorization header value.`,
    );
  }
}
