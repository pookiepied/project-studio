import { runClaudeJsonCommand } from "./command";

const CACHE_TTL_MS = 60_000;

interface ClaudeAuthStatusCliResponse {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
  subscriptionType?: string;
}

export interface ClaudeAccountStatus {
  available: boolean;
  loggedIn: boolean;
  checkedAt: number;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
  subscriptionType?: string;
  detail?: string;
}

let cachedStatus: ClaudeAccountStatus | null = null;
let inFlightStatus: Promise<ClaudeAccountStatus> | null = null;

function normalizeAccountStatus(payload: ClaudeAuthStatusCliResponse): ClaudeAccountStatus {
  return {
    available: true,
    loggedIn: Boolean(payload.loggedIn),
    checkedAt: Date.now(),
    authMethod: payload.authMethod,
    apiProvider: payload.apiProvider,
    email: payload.email,
    orgId: payload.orgId,
    orgName: payload.orgName,
    subscriptionType: payload.subscriptionType,
  };
}

export async function getClaudeAccountStatus(force = false): Promise<ClaudeAccountStatus> {
  if (!force && cachedStatus && Date.now() - cachedStatus.checkedAt < CACHE_TTL_MS) {
    return cachedStatus;
  }

  if (!force && inFlightStatus) return inFlightStatus;

  inFlightStatus = runClaudeJsonCommand<ClaudeAuthStatusCliResponse>(["auth", "status", "--json"])
    .then((payload) => normalizeAccountStatus(payload))
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        available: false,
        loggedIn: false,
        checkedAt: Date.now(),
        detail: detail || "Claude auth status is unavailable.",
      } satisfies ClaudeAccountStatus;
    })
    .finally(() => {
      inFlightStatus = null;
    });

  cachedStatus = await inFlightStatus;
  return cachedStatus;
}
