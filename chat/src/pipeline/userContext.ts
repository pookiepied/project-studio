import { ChatPipelineContext } from "./types";
import { verifyBearerToken } from "../server/middleware/auth";
import { logger } from "../logger";
import { HARNESS_MARKER } from "../constants";

function detectPlatform(request: Request): string {
  const origin = request.headers.get("origin") ?? "";
  if (origin.includes("tauri") || origin.includes("localhost")) return "desktop";
  if (origin.includes("discord")) return "discord";
  if (origin.includes("pookiepied.dev") || origin.startsWith("https://")) return "web";
  return "api";
}

/**
 * Verifies the Bearer JWT (if configured), extracts the userId, and
 * builds the UserContext from Cloudflare geo headers.
 */
export async function extractUserContext(ctx: ChatPipelineContext): Promise<void> {
  // When JWT_SECRET is absent, authentication is disabled and all requests are
  // treated as anonymous (ctx.userId stays undefined). Set JWT_SECRET via
  // `wrangler secret put JWT_SECRET` before deploying to production.
  if (ctx.env.JWT_SECRET) {
    const payload = await verifyBearerToken(ctx.request, ctx.env.JWT_SECRET, ctx.env.REVOKED_KV);
    ctx.userId = payload?.sub;
  }

  // Fallback for the WebSocket / Durable Object path.
  //
  // The browser WebSocket API cannot set custom headers, so the Tauri client
  // cannot send "Authorization: Bearer <token>" on the WebSocket upgrade.
  // Instead, ChatAgent.handleChatStart forwards body.user_id as the
  // "x-user-id" header on the synthetic request it builds.
  //
  // Trust this header ONLY when the request hostname is "internal" — the hostname
  // Cloudflare assigns to every cross-worker service binding call. External callers
  // (including those hitting the workers.dev URL) have a different hostname and must
  // authenticate via JWT; they must never be able to supply an arbitrary x-user-id.
  const bindingHostname = new URL(ctx.request.url).hostname;
  if (!ctx.userId && bindingHostname === "internal") {
    ctx.userId = ctx.request.headers.get("x-user-id") ?? undefined;
    if (ctx.userId) {
      logger.info("userContext: userId resolved from x-user-id header (service binding path)");
    }
  }

  // When called via service binding the cf object is empty;
  // the API gateway forwards geo data as X-CF-* headers instead.
  const cf = (ctx.request as any).cf as Record<string, unknown> | undefined;

  ctx.userContext = {
    userId: ctx.userId,
    timezone: (cf?.timezone as string) ?? ctx.request.headers.get("X-CF-Timezone") ?? undefined,
    city: (cf?.city as string) ?? ctx.request.headers.get("X-CF-City") ?? undefined,
    country: (cf?.country as string) ?? ctx.request.headers.get("X-CF-Country") ?? undefined,
    platform: detectPlatform(ctx.request),
  };

  // Primary signal: explicit field in request body.
  // Fallback signal: Studio Harness sends a bare marker message when connected.
  // Sub-agents (LocalAgentLoop requests) never send this marker — they have
  // their own focused system prompts — so it reliably identifies the main chat.
  const hasHarnessMarker = (ctx.body.messages ?? []).some(
    (m) =>
      m.role === "system" &&
      typeof m.content === "string" &&
      m.content.trim() === HARNESS_MARKER
  );

  // Cloud conversations can never expose local machine tools — a hard scope
  // guard that overrides both the explicit flag and the harness marker.
  const isCloudScope = ctx.body.storage_scope === "cloud";

  ctx.localEngineConnected =
    !isCloudScope && (ctx.body.local_engine_connected ?? hasHarnessMarker);

  if (isCloudScope && (ctx.body.local_engine_connected || hasHarnessMarker)) {
    logger.info("userContext: local engine signals ignored — conversation is cloud-scoped");
  }

  if (ctx.localEngineConnected) {
    logger.info("userContext: Studio Harness connected", {
      source: ctx.body.local_engine_connected !== undefined ? "body_field" : "harness_marker",
    });
  }
}
