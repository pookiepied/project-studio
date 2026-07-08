import { Hono } from 'hono';
import { Env, Caller } from '../types';
import { userAuth } from '../middleware/auth';
import { handleUnknownError } from '../utils/errors';

type Variables = { caller: Caller };

export const studioRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Forward a request to the Studio worker, injecting the authenticated
 * user's sub claim as x-user-id.  The Studio worker trusts this header
 * and never performs its own JWT verification.
 */
function proxyToStudio(env: Env, path: string, req: Request, userId: string): Promise<Response> {
  const headers = new Headers(req.headers);
  headers.set('x-user-id', userId);
  // Service-binding URLs use a synthetic hostname — the actual host is ignored.
  return env.STUDIO.fetch(new Request(`https://studio${path}`, {
    method:  req.method,
    headers,
    body:    ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
  }));
}

// ── GET /preferences ──────────────────────────────────────────────────────────
studioRoutes.get('/adapters/openai/v1/user/preferences', userAuth, async (c) => {
  try {
    const userId = c.get('caller').sub ?? '';
    const res    = await proxyToStudio(c.env, '/preferences', c.req.raw, userId);
    return new Response(res.body, {
      status:  res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ── PUT /preferences ──────────────────────────────────────────────────────────
studioRoutes.put('/adapters/openai/v1/user/preferences', userAuth, async (c) => {
  try {
    const userId = c.get('caller').sub ?? '';
    const res    = await proxyToStudio(c.env, '/preferences', c.req.raw, userId);
    return new Response(res.body, {
      status:  res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});
