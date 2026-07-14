import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAdmin } from '../../identity/requireAdmin';
import { mirrorResponse } from '../../proxy/forward';
import type { Env, Variables } from '../../server/types';

export const gatewayRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

gatewayRoutes.all('/registry/*', requireAdmin, async (c) =>
  mirrorResponse(await forwardGatewayRegistry(c, `/${c.req.param('*')}`)),
);

gatewayRoutes.all('/registry', requireAdmin, async (c) =>
  mirrorResponse(await forwardGatewayRegistry(c, '')),
);

async function forwardGatewayRegistry(c: Context<{ Bindings: Env; Variables: Variables }>, path: string) {
  const body = ['GET', 'HEAD'].includes(c.req.method) ? null : await c.req.raw.clone().arrayBuffer();
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
