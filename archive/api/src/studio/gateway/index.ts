import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAdmin } from '../../identity/requireAdmin';
import { requireUser } from '../../identity/requireUser';
import { mirrorResponse } from '../../proxy/forward';
import type { Env, Variables } from '../../server/types';

export const gatewayRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

type GatewayContext = Context<{ Bindings: Env; Variables: Variables }>;

/**
 * User-facing model access.
 *
 * Studio Gateway is private: it has no workers.dev subdomain and no public
 * route, so this proxy is the only way a client reaches it. The API verifies the
 * caller's Studio token here and forwards the request over the service binding
 * with the caller's identity attached as a trusted header. The gateway trusts
 * `X-User-ID` precisely because the binding is unreachable from the internet;
 * the client's own Authorization header is never forwarded, so a caller cannot
 * present provider credentials or impersonate another user downstream.
 *
 * Chat responses are server-sent events. The upstream body is streamed through
 * untouched rather than buffered, so tokens reach the client as they arrive.
 */
gatewayRoutes.all('/v1/*', requireUser, async (c) =>
  mirrorResponse(await forwardToGateway(c, `/v1/${c.req.param('*')}`)),
);

gatewayRoutes.all('/registry/*', requireAdmin, async (c) =>
  mirrorResponse(await forwardGatewayRegistry(c, `/${c.req.param('*')}`)),
);

gatewayRoutes.all('/registry', requireAdmin, async (c) =>
  mirrorResponse(await forwardGatewayRegistry(c, '')),
);

/** Headers a caller must never be able to set on the internal request. */
function trustedHeaders(c: GatewayContext): Headers {
  const headers = new Headers();
  const caller = c.get('caller');

  const contentType = c.req.header('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);

  // Preserved so the gateway knows whether to open an SSE stream.
  const accept = c.req.header('Accept');
  if (accept) headers.set('Accept', accept);

  headers.set('X-User-ID', caller.sub);
  headers.set('X-Studio-Caller-Role', caller.role ?? '');
  headers.set('X-Request-ID', c.get('requestId'));

  return headers;
}

async function forwardToGateway(c: GatewayContext, path: string) {
  const body = ['GET', 'HEAD'].includes(c.req.method)
    ? null
    : await c.req.raw.clone().arrayBuffer();

  return c.env.GATEWAY.fetch(
    new Request(`https://gateway.internal${path}${new URL(c.req.url).search}`, {
      method: c.req.method,
      headers: trustedHeaders(c),
      body,
    }),
  );
}

// Deliberately builds its own headers rather than reusing trustedHeaders: this
// admin path predates the user-facing proxy and forwarding Accept or a request
// id to it would be an unrelated behavior change.
async function forwardGatewayRegistry(c: GatewayContext, path: string) {
  const body = ['GET', 'HEAD'].includes(c.req.method)
    ? null
    : await c.req.raw.clone().arrayBuffer();
  const headers = new Headers();
  const contentType = c.req.header('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  headers.set('X-User-ID', c.get('caller').sub);
  headers.set('X-Studio-Caller-Role', c.get('caller').role ?? '');
  if (c.env.REGISTRY_MANAGEMENT_TOKEN) {
    headers.set('X-Studio-Registry-Management-Token', c.env.REGISTRY_MANAGEMENT_TOKEN);
  }

  return c.env.GATEWAY.fetch(
    new Request(`https://gateway.internal/management/registry${path}${new URL(c.req.url).search}`, {
      method: c.req.method,
      headers,
      body,
    }),
  );
}
