import type { AdmissionScope } from "./scopes.js";

export const CLIENT_TYPES = [
  "studio-client",
  "studio-host",
  "standalone",
  "test",
] as const;

export type ClientType = (typeof CLIENT_TYPES)[number];

/** Identity and operation permissions attached to one admitted request. */
export interface AuthContext {
  readonly clientId: string;
  readonly clientType: ClientType;
  readonly sessionId: string;
  readonly scopes: readonly AdmissionScope[];
}
