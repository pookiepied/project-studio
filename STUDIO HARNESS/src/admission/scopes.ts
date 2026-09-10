import type { AuthContext, ClientType } from "./context.js";

export const ADMISSION_SCOPES = {
  AGENT_RUN: "agent:run",
  EXTENSION_MANAGEMENT: "extension-management",
  APPROVAL: "approval",
  PROJECT: "project",
  DIAGNOSTIC: "diagnostic",
  PROVIDER_MANAGEMENT: "provider-management",
} as const;

export type AdmissionScope =
  (typeof ADMISSION_SCOPES)[keyof typeof ADMISSION_SCOPES];

/**
 * `diagnostic` guards no route today and stays anyway: ADR 0028 §7 says
 * "diagnostics require diagnostic scope", so the scope exists for a surface
 * the ADR already reserves. What a session gets by default is decided below,
 * and that is where its absence is felt first.
 */
export const ALL_ADMISSION_SCOPES: readonly AdmissionScope[] = Object.freeze([
  ADMISSION_SCOPES.AGENT_RUN,
  ADMISSION_SCOPES.EXTENSION_MANAGEMENT,
  ADMISSION_SCOPES.APPROVAL,
  ADMISSION_SCOPES.PROJECT,
  ADMISSION_SCOPES.DIAGNOSTIC,
  ADMISSION_SCOPES.PROVIDER_MANAGEMENT,
]);

/**
 * Every scope a route can require today, minus `diagnostic` — the one scope
 * whose withholding changes nothing now and everything the day a diagnostics
 * route appears: then the trusted owner reaches it by default and every other
 * client has to ask.
 */
const OPERATIONAL_ADMISSION_SCOPES: readonly AdmissionScope[] = Object.freeze([
  ADMISSION_SCOPES.AGENT_RUN,
  ADMISSION_SCOPES.EXTENSION_MANAGEMENT,
  ADMISSION_SCOPES.APPROVAL,
  ADMISSION_SCOPES.PROJECT,
  ADMISSION_SCOPES.PROVIDER_MANAGEMENT,
]);

/**
 * What a session may do when its creator does not say. Keyed by client type
 * so that adding a client type is a compile error until someone chooses its
 * scopes — the one decision this table exists to force. Before it, every
 * session received every scope and possession of the credential was the only
 * real check (audit F-10).
 */
export const DEFAULT_SCOPES_BY_CLIENT_TYPE: Readonly<
  Record<ClientType, readonly AdmissionScope[]>
> = Object.freeze({
  // The desktop app owns this process: it starts it, holds the per-launch
  // credential, and is the one place every surface is managed from. Every
  // scope, so this table never narrows the shipped app.
  "studio-host": ALL_ADMISSION_SCOPES,
  // The desktop UI consumes the product: it runs the agent and answers the
  // approvals those runs raise. Managing extensions, providers, and projects
  // is the host's job, so a host/client split starts narrow rather than wide.
  "studio-client": Object.freeze([
    ADMISSION_SCOPES.AGENT_RUN,
    ADMISSION_SCOPES.APPROVAL,
  ]),
  // Standalone is the same process launched by hand for headless and
  // development use (ADR 0028 §2) — same machine, same person, so the whole
  // operational surface. `diagnostic` stays out for the reason above.
  standalone: OPERATIONAL_ADMISSION_SCOPES,
  // The harness's own suites speak the full operational surface and get it
  // without per-test ceremony.
  test: OPERATIONAL_ADMISSION_SCOPES,
  // A paired browser on another device (ADR 0050 §3.5): the same person, the
  // same work, from a phone or a laptop, so the same operational surface as
  // standalone. The boundary is which devices are paired, not what a paired
  // device may do. No session of this type is minted yet — the desktop's
  // listener forwards remote requests under the host's credential — but the
  // entry is here now so that a future view-only or approve-only device plugs
  // into this table instead of redesigning it, and so a session minted as
  // `remote` cannot exist without someone having chosen its scopes.
  remote: OPERATIONAL_ADMISSION_SCOPES,
});

export function hasAdmissionScope(
  context: AuthContext,
  scope: AdmissionScope,
): boolean {
  return context.scopes.includes(scope);
}
