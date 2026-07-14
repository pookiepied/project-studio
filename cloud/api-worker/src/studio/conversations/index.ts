import { Hono } from 'hono';
import type { Env, Variables } from '../../server/types';
import { requireUser } from '../../identity/requireUser';
import { forwardToWorker, mirrorResponse } from '../../proxy/forward';

export const conversationsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

conversationsRoutes.get('/:conversationId/state', requireUser, async (c) => {
  const conversationId = requireParam(c.req.param('conversationId'), 'conversationId');
  const response = await forwardToWorker(
    c.env.EXECUTION_RUNTIME,
    `/runs/${encodeURIComponent(conversationId)}`,
    {
      userId: c.get('caller').sub,
      method: 'GET',
    },
  );
  return mirrorResponse(response);
});

for (const action of ['pause', 'resume', 'cancel'] as const) {
  conversationsRoutes.post(`/:conversationId/${action}`, requireUser, async (c) => {
    const conversationId = requireParam(c.req.param('conversationId'), 'conversationId');
    const body = await c.req.text();
    const response = await forwardToWorker(
      c.env.EXECUTION_RUNTIME,
      `/runs/${encodeURIComponent(conversationId)}/${action}`,
      {
        userId: c.get('caller').sub,
        method: 'POST',
        contentType: c.req.header('Content-Type') ?? 'application/json',
        body,
      },
    );
    return mirrorResponse(response);
  });
}

conversationsRoutes.post(
  '/:conversationId/approvals/:approvalId/resolve',
  requireUser,
  async (c) => {
    const conversationId = requireParam(c.req.param('conversationId'), 'conversationId');
    const approvalId = requireParam(c.req.param('approvalId'), 'approvalId');
    const body = await c.req.text();
    const response = await forwardToWorker(
      c.env.EXECUTION_RUNTIME,
      `/runs/${encodeURIComponent(conversationId)}/approvals/${encodeURIComponent(approvalId)}/resolve`,
      {
        userId: c.get('caller').sub,
        method: 'POST',
        contentType: c.req.header('Content-Type') ?? 'application/json',
        body,
      },
    );
    return mirrorResponse(response);
  },
);

conversationsRoutes.get('/:conversationId/stream', requireUser, (c) =>
  c.json({ error: 'not_implemented', message: 'SSE projection is pending.' }, 501),
);

function requireParam(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}
