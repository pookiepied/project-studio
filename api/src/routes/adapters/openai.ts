import { Hono } from 'hono';
import type { Context } from 'hono';
import { Env, Caller } from '../../types';
import { userAuth } from '../../middleware/auth';
import { handleUnknownError } from '../../utils/errors';

type Variables = { caller: Caller };
type AppCtx = Context<{ Bindings: Env; Variables: Variables }>;

export const openaiAdapterRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Proxy helpers ─────────────────────────────────────────────────────────────

async function proxyToAI(
  c: AppCtx,
  aiPath: string,
  opts: { method?: string; headers?: Record<string, string>; body?: BodyInit | null } = {}
): Promise<Response> {
  const method = opts.method ?? c.req.method;
  const res = await c.env.AI.fetch(
    new Request(`http://internal${aiPath}`, { method, headers: opts.headers, body: opts.body })
  );
  return new Response(res.body, { status: res.status, headers: res.headers });
}

async function proxyToGateway(
  c: AppCtx,
  gatewayPath: string,
  opts: { method?: string; headers?: Record<string, string>; body?: BodyInit | null } = {}
): Promise<Response> {
  const method = opts.method ?? c.req.method;
  const res = await c.env.GATEWAY.fetch(
    new Request(`http://studio-gateway${gatewayPath}`, { method, headers: opts.headers, body: opts.body })
  );
  return new Response(res.body, { status: res.status, headers: res.headers });
}

async function proxyToChats(c: AppCtx, method: string, body?: BodyInit | null): Promise<Response> {
  const caller = c.get('caller');
  if (caller.type !== 'user' || !caller.sub) return c.json({ error: 'Unauthorized' }, 401);
  const path = c.req.param('path');
  const headers: Record<string, string> = { 'X-User-Id': caller.sub };
  if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
  const res = await c.env.CHATS_SERVICE.fetch(
    new Request(`http://internal/chats/${path}`, { method, headers, body })
  );
  if (method === 'HEAD') return new Response(null, { status: res.status });
  return new Response(res.body, { status: res.status, headers: res.headers });
}

async function proxyToTracker(c: AppCtx, trackerPath: string, injectUserId = true): Promise<Response> {
  const qs = new URLSearchParams(c.req.url.split('?')[1] ?? '');
  if (injectUserId) {
    const caller = c.get('caller');
    if (caller?.sub && !qs.has('userId')) qs.set('userId', caller.sub);
  }
  const res = await c.env.TRACKER!.fetch(new Request(`https://tracker${trackerPath}?${qs}`));
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}

function authHeader(c: AppCtx): string {
  return c.req.header('Authorization') ?? '';
}

function withError(fn: (c: AppCtx) => Promise<Response>) {
  return async (c: AppCtx) => {
    try {
      return await fn(c);
    } catch (error) {
      return c.json(handleUnknownError(error), 500);
    }
  };
}

// ── AI core endpoints ─────────────────────────────────────────────────────────

openaiAdapterRoutes.post('/adapters/openai/v1/chat/completions', userAuth, withError(async (c) => {
  const body = await c.req.json();
  const jwt = authHeader(c).startsWith('Bearer ') ? authHeader(c).slice(7) : '';
  const caller = c.get('caller');
  const cf = (c.req.raw as Request & { cf?: Record<string, unknown> }).cf;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) headers['X-User-JWT'] = jwt;
  if (caller?.sub) headers['X-User-ID'] = caller.sub;
  if (cf?.timezone) headers['X-CF-Timezone'] = cf.timezone as string;
  if (cf?.city)     headers['X-CF-City']     = cf.city as string;
  if (cf?.country)  headers['X-CF-Country']  = cf.country as string;
  return proxyToAI(c, '/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify(body) });
}));

openaiAdapterRoutes.get('/adapters/openai/v1/modes', userAuth, withError(async (c) =>
  proxyToAI(c, '/v1/modes', { method: 'GET' })
));

openaiAdapterRoutes.get('/adapters/openai/v1/models', userAuth, withError(async (c) =>
  proxyToGateway(c, '/v1/models', { method: 'GET' })
));

// Admin wildcard — AI worker handles role verification internally
openaiAdapterRoutes.all('/adapters/openai/v1/admin/*', userAuth, withError(async (c) => {
  const reqUrl = new URL(c.req.url);
  const aiPath = reqUrl.pathname.replace('/adapters/openai', '') + reqUrl.search;
  const headers: Record<string, string> = { Authorization: authHeader(c) };
  let body: string | undefined;
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    body = await c.req.text();
    if (body) headers['Content-Type'] = c.req.header('Content-Type') ?? 'application/json';
  }
  return proxyToAI(c, aiPath, { headers, body });
}));

// ── Audio endpoints ───────────────────────────────────────────────────────────

openaiAdapterRoutes.post('/adapters/openai/v1/audio/transcriptions', userAuth, withError(async (c) => {
  const formData = await c.req.formData();
  return proxyToGateway(c, '/v1/audio/transcriptions', { method: 'POST', body: formData });
}));

openaiAdapterRoutes.post('/adapters/openai/v1/audio/speech', userAuth, withError(async (c) => {
  const jwt = authHeader(c).startsWith('Bearer ') ? authHeader(c).slice(7) : '';
  const body = await c.req.json();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) headers['X-User-JWT'] = jwt;
  return proxyToGateway(c, '/v1/audio/speech', { method: 'POST', headers, body: JSON.stringify(body) });
}));

// ── MCP server management ─────────────────────────────────────────────────────

openaiAdapterRoutes.get('/adapters/openai/v1/mcp/catalog', userAuth, withError(async (c) =>
  proxyToAI(c, '/v1/mcp/catalog', { method: 'GET', headers: { Authorization: authHeader(c) } })
));

openaiAdapterRoutes.get('/adapters/openai/v1/mcp/servers', userAuth, withError(async (c) =>
  proxyToAI(c, '/v1/mcp/servers', { method: 'GET', headers: { Authorization: authHeader(c) } })
));

openaiAdapterRoutes.post('/adapters/openai/v1/mcp/servers', userAuth, withError(async (c) => {
  const body = await c.req.json();
  return proxyToAI(c, '/v1/mcp/servers', {
    method: 'POST',
    headers: { Authorization: authHeader(c), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}));

openaiAdapterRoutes.post('/adapters/openai/v1/mcp/sync/:name', userAuth, withError(async (c) => {
  const name = c.req.param('name') ?? '';
  return proxyToAI(c, `/v1/mcp/servers/${encodeURIComponent(name)}/sync`, {
    method: 'POST',
    headers: { Authorization: authHeader(c) },
  });
}));

openaiAdapterRoutes.patch('/adapters/openai/v1/mcp/servers/:name', userAuth, withError(async (c) => {
  const name = c.req.param('name') ?? '';
  const body = await c.req.json();
  return proxyToAI(c, `/v1/mcp/servers/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { Authorization: authHeader(c), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}));

openaiAdapterRoutes.delete('/adapters/openai/v1/mcp/servers/:name', userAuth, withError(async (c) => {
  const name = c.req.param('name') ?? '';
  return proxyToAI(c, `/v1/mcp/servers/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { Authorization: authHeader(c) },
  });
}));

// ── Composio ──────────────────────────────────────────────────────────────────

openaiAdapterRoutes.get('/adapters/openai/v1/composio/apps', userAuth, withError(async (c) => {
  const qs = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return proxyToAI(c, `/v1/composio/apps${qs}`, { method: 'GET', headers: { Authorization: authHeader(c) } });
}));

openaiAdapterRoutes.get('/adapters/openai/v1/composio/connections', userAuth, withError(async (c) =>
  proxyToAI(c, '/v1/composio/connections', { method: 'GET', headers: { Authorization: authHeader(c) } })
));

openaiAdapterRoutes.post('/adapters/openai/v1/composio/connect', userAuth, withError(async (c) => {
  const body = await c.req.json();
  return proxyToAI(c, '/v1/composio/connect', {
    method: 'POST',
    headers: { Authorization: authHeader(c), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}));

openaiAdapterRoutes.patch('/adapters/openai/v1/composio/connections/:id', userAuth, withError(async (c) => {
  const id = c.req.param('id') ?? '';
  const body = await c.req.json();
  return proxyToAI(c, `/v1/composio/connections/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Authorization: authHeader(c), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}));

openaiAdapterRoutes.delete('/adapters/openai/v1/composio/connections/:id', userAuth, withError(async (c) => {
  const id = c.req.param('id') ?? '';
  return proxyToAI(c, `/v1/composio/connections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: authHeader(c) },
  });
}));

openaiAdapterRoutes.delete('/adapters/openai/v1/composio/apps/cache', userAuth, withError(async (c) =>
  proxyToAI(c, '/v1/composio/apps/cache', { method: 'DELETE', headers: { Authorization: authHeader(c) } })
));

openaiAdapterRoutes.get('/adapters/openai/v1/composio/apps/config', userAuth, withError(async (c) =>
  proxyToAI(c, '/v1/composio/apps/config', { method: 'GET', headers: { Authorization: authHeader(c) } })
));

openaiAdapterRoutes.put('/adapters/openai/v1/composio/apps/config', userAuth, withError(async (c) => {
  const body = await c.req.json();
  return proxyToAI(c, '/v1/composio/apps/config', {
    method: 'PUT',
    headers: { Authorization: authHeader(c), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}));

openaiAdapterRoutes.delete('/adapters/openai/v1/composio/apps/config/cache', userAuth, withError(async (c) =>
  proxyToAI(c, '/v1/composio/apps/config/cache', { method: 'DELETE', headers: { Authorization: authHeader(c) } })
));

// ── User chat storage ─────────────────────────────────────────────────────────
// Auth is handled here; ChatsStorage trusts the X-User-Id header we inject.
// Path: /adapters/openai/v1/user/chats/:path (e.g. "chat-index.json")

openaiAdapterRoutes.get('/adapters/openai/v1/user/chats/:path{.+}', userAuth, withError((c) =>
  proxyToChats(c, 'GET')
));

openaiAdapterRoutes.on('HEAD', '/adapters/openai/v1/user/chats/:path{.+}', userAuth, withError((c) =>
  proxyToChats(c, 'HEAD')
));

openaiAdapterRoutes.put('/adapters/openai/v1/user/chats/:path{.+}', userAuth, withError(async (c) => {
  const body = await c.req.text();
  return proxyToChats(c, 'PUT', body);
}));

openaiAdapterRoutes.delete('/adapters/openai/v1/user/chats/:path{.+}', userAuth, withError((c) =>
  proxyToChats(c, 'DELETE')
));

// ── Generated images ──────────────────────────────────────────────────────────

openaiAdapterRoutes.get('/adapters/openai/v1/images/:id', userAuth, withError(async (c) =>
  proxyToAI(c, `/v1/images/${c.req.param('id')}`, { method: 'GET' })
));

openaiAdapterRoutes.delete('/adapters/openai/v1/images/:id', userAuth, withError(async (c) =>
  proxyToAI(c, `/v1/delete-image/${c.req.param('id')}`, { method: 'DELETE' })
));

// ── Tracking ──────────────────────────────────────────────────────────────────
// Path mapping:
//   /tracking/summary → tracker /usage/summary  (platform-wide, no userId)
//   /tracking/me      → tracker /usage/summary  (user-scoped, userId injected)
//   /tracking/usage   → tracker /usage/data
//   /tracking/logs    → tracker /usage/logs
//   /tracking/credits → tracker /usage/credits  (no userId injection)

openaiAdapterRoutes.get('/adapters/openai/v1/tracking/summary', userAuth, withError((c) =>
  proxyToTracker(c, '/usage/summary', false)
));

openaiAdapterRoutes.get('/adapters/openai/v1/tracking/usage', userAuth, withError((c) =>
  proxyToTracker(c, '/usage/data')
));

openaiAdapterRoutes.get('/adapters/openai/v1/tracking/logs', userAuth, withError((c) =>
  proxyToTracker(c, '/usage/logs')
));

openaiAdapterRoutes.get('/adapters/openai/v1/tracking/credits', userAuth, withError((c) =>
  proxyToTracker(c, '/usage/credits', false)
));

openaiAdapterRoutes.get('/adapters/openai/v1/tracking/me', userAuth, withError((c) =>
  proxyToTracker(c, '/usage/summary')
));

// ── RAG & local inference callbacks ──────────────────────────────────────────

openaiAdapterRoutes.post('/adapters/openai/v1/docs/index', userAuth, withError(async (c) => {
  const body = await c.req.text();
  return proxyToAI(c, '/v1/docs/index', {
    method: 'POST',
    headers: { Authorization: authHeader(c), 'Content-Type': c.req.header('Content-Type') ?? 'application/json' },
    body,
  });
}));

openaiAdapterRoutes.post('/adapters/openai/v1/local/chat/save', userAuth, withError(async (c) => {
  const body = await c.req.text();
  return proxyToAI(c, '/v1/local/chat/save', {
    method: 'POST',
    headers: { Authorization: authHeader(c), 'Content-Type': 'application/json' },
    body,
  });
}));

openaiAdapterRoutes.post('/adapters/openai/v1/local/tool/execute', userAuth, withError(async (c) => {
  const body = await c.req.text();
  return proxyToAI(c, '/v1/local/tool/execute', {
    method: 'POST',
    headers: { Authorization: authHeader(c), 'Content-Type': 'application/json' },
    body,
  });
}));

// ── Memories ──────────────────────────────────────────────────────────────────

openaiAdapterRoutes.get('/adapters/openai/v1/user/memories', userAuth, withError(async (c) => {
  const caller = c.get('caller');
  if (caller.type !== 'user' || !caller.sub) return c.json({ error: 'Unauthorized' }, 401);
  return proxyToAI(c, '/v1/user/memories', { method: 'GET', headers: { 'X-User-Id': caller.sub } });
}));

openaiAdapterRoutes.delete('/adapters/openai/v1/user/memories/:id', userAuth, withError(async (c) => {
  const caller = c.get('caller');
  if (caller.type !== 'user' || !caller.sub) return c.json({ error: 'Unauthorized' }, 401);
  const id   = c.req.param('id');
  const type = c.req.query('type') ?? 'fact';
  return proxyToAI(c, `/v1/user/memories/${id}?type=${type}`, {
    method: 'DELETE',
    headers: { 'X-User-Id': caller.sub },
  });
}));
