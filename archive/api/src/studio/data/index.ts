import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../server/types';
import { requireUser } from '../../identity/requireUser';
import { forwardToWorker, mirrorResponse } from '../../proxy/forward';

export const dataRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

dataRoutes.all('/conversations', requireUser, (c) => forwardData(c, '/conversations'));

dataRoutes.all('/conversations/*', requireUser, (c) =>
  forwardData(c, `/conversations/${c.req.param('*')}`),
);

dataRoutes.all('/uploads/*', requireUser, (c) =>
  forwardData(c, `/uploads/${c.req.param('*')}`),
);

dataRoutes.post('/uploads', requireUser, (c) => forwardData(c, '/uploads'));

dataRoutes.all('/artifacts/*', requireUser, (c) =>
  forwardData(c, `/artifacts/${c.req.param('*')}`),
);

dataRoutes.post('/artifacts', requireUser, (c) => forwardData(c, '/artifacts'));

dataRoutes.all('/workspace', requireUser, (c) => forwardData(c, '/workspace'));

dataRoutes.all('/workspace/*', requireUser, (c) =>
  forwardData(c, `/workspace/${c.req.param('*')}`),
);

async function forwardData(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  dataPath: string,
): Promise<Response> {
  const body = ['GET', 'HEAD'].includes(c.req.method) ? null : await c.req.raw.clone().arrayBuffer();
  const response = await forwardToWorker(c.env.DATA, dataPath, {
    userId: c.get('caller').sub,
    method: c.req.method,
    contentType: c.req.header('Content-Type'),
    body,
    search: new URL(c.req.url).search,
  });
  return mirrorResponse(response);
}
