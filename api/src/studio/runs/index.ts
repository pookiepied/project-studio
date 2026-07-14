import { Hono } from 'hono';
import type { Env, Variables } from '../../server/types';
import { requireUser } from '../../identity/requireUser';
import { forwardToWorker, mirrorResponse } from '../../proxy/forward';

export const runsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

runsRoutes.post('/', requireUser, async (c) => {
  const body = await c.req.text();
  const response = await forwardToWorker(c.env.EXECUTION_RUNTIME, '/runs', {
    userId: c.get('caller').sub,
    method: 'POST',
    contentType: c.req.header('Content-Type') ?? 'application/json',
    body,
  });
  return mirrorResponse(response);
});
