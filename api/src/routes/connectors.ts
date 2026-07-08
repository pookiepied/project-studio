import { Hono } from 'hono';
import { Env, Caller } from '../types';
import { userAuth } from '../middleware/auth';
import { handleUnknownError } from '../utils/errors';

type Variables = { caller: Caller };

export const connectorRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function proxyToConnectors(env: Env, path: string, req: Request, userId: string): Promise<Response> {
  const headers = new Headers(req.headers);
  headers.set('x-user-id', userId);

  return env.CONNECTORS.fetch(new Request(`https://connectors${path}`, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
  }));
}

connectorRoutes.all('/adapters/openai/v1/connectors/*', userAuth, async (c) => {
  try {
    const userId = c.get('caller').sub ?? '';
    const url = new URL(c.req.url);
    const path = url.pathname.replace('/adapters/openai/v1/connectors', '') + url.search;
    const res = await proxyToConnectors(c.env, path || '/', c.req.raw, userId);
    return new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});
