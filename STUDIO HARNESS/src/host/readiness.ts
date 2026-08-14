const READINESS_TYPE = "project-studio.harness.ready" as const;
const READINESS_VERSION = 1 as const;

export interface HarnessReadiness {
  readonly type: typeof READINESS_TYPE;
  readonly version: typeof READINESS_VERSION;
  readonly pid: number;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly clientId: string;
  readonly sessionId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Parses only the private readiness frame emitted by the patched Flue Node
 * entrypoint. Human logs and malformed child output are never treated as
 * endpoint discovery.
 */
export function parseHarnessReadiness(line: string): HarnessReadiness | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (!isRecord(value)) return undefined;
  if (value.type !== READINESS_TYPE || value.version !== READINESS_VERSION) {
    return undefined;
  }
  if (
    !Number.isInteger(value.pid) ||
    (value.pid as number) <= 0 ||
    value.host !== "127.0.0.1" ||
    !Number.isInteger(value.port) ||
    (value.port as number) < 1 ||
    (value.port as number) > 65_535 ||
    !nonEmptyString(value.clientId) ||
    !nonEmptyString(value.sessionId)
  ) {
    return undefined;
  }

  return {
    type: READINESS_TYPE,
    version: READINESS_VERSION,
    pid: value.pid as number,
    host: "127.0.0.1",
    port: value.port as number,
    clientId: value.clientId,
    sessionId: value.sessionId,
  };
}
