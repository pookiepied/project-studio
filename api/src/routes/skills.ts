import { Hono } from 'hono';
import { Env, Caller } from '../types';
import { userAuth } from '../middleware/auth';
import { handleUnknownError } from '../utils/errors';

type Variables = { caller: Caller };

export const skillRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Forward a POST to the studio-skills worker's internal REST API.
 * Injects the authenticated user's sub claim as userId and the
 * SKILLS_AUTH_SECRET bearer token when configured.
 */
async function proxySkillsPost(
  env: Env,
  internalPath: string,
  payload: Record<string, unknown>,
  userId: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.SKILLS_AUTH_SECRET) {
    headers['Authorization'] = `Bearer ${env.SKILLS_AUTH_SECRET}`;
  }
  const res = await env.SKILLS.fetch(
    new Request(`https://studio-skills${internalPath}`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ ...payload, userId }),
    }),
  );
  return new Response(res.body, {
    status:  res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Forward a GET to the studio-skills worker's internal REST API.
 */
async function proxySkillsGet(
  env: Env,
  internalPath: string,
  userId: string,
  extraParams?: Record<string, string>,
): Promise<Response> {
  const params = new URLSearchParams({ userId, ...(extraParams ?? {}) });
  const headers: Record<string, string> = {};
  if (env.SKILLS_AUTH_SECRET) {
    headers['Authorization'] = `Bearer ${env.SKILLS_AUTH_SECRET}`;
  }
  const res = await env.SKILLS.fetch(
    new Request(`https://studio-skills${internalPath}?${params.toString()}`, { headers }),
  );
  return new Response(res.body, {
    status:  res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── GET /v1/skills — list all skills (bundled + local) ────────────────────────
skillRoutes.get('/v1/skills', userAuth, async (c) => {
  try {
    const userId   = c.get('caller').sub ?? '';
    const runtime  = c.req.query('runtime') === 'local' ? 'local' : 'cloud';
    const deviceId = c.req.query('deviceId') ?? '';
    return proxySkillsPost(c.env, '/internal/skills/list', { runtime, deviceId }, userId);
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ── GET /v1/skills/index — prompt-ready index for system prompt ───────────────
skillRoutes.get('/v1/skills/index', userAuth, async (c) => {
  try {
    const userId   = c.get('caller').sub ?? '';
    const runtime  = c.req.query('runtime') === 'local' ? 'local' : 'cloud';
    const deviceId = c.req.query('deviceId') ?? '';
    return proxySkillsGet(c.env, '/internal/skills/index', userId, { runtime, ...(deviceId ? { deviceId } : {}) });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ── GET /v1/skills/:key — read full skill content ─────────────────────────────
skillRoutes.get('/v1/skills/:key', userAuth, async (c) => {
  try {
    const userId   = c.get('caller').sub ?? '';
    const key      = c.req.param('key');
    const runtime  = c.req.query('runtime') === 'local' ? 'local' : 'cloud';
    const deviceId = c.req.query('deviceId') ?? '';
    return proxySkillsPost(c.env, '/internal/skills/read', { key, runtime, deviceId }, userId);
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ── GET /v1/skills/search?q= — search skills by token ────────────────────────
skillRoutes.get('/v1/skills/search', userAuth, async (c) => {
  try {
    const userId   = c.get('caller').sub ?? '';
    const query    = c.req.query('q') ?? '';
    const runtime  = c.req.query('runtime') === 'local' ? 'local' : 'cloud';
    const deviceId = c.req.query('deviceId') ?? '';
    return proxySkillsPost(c.env, '/internal/skills/search', { query, runtime, deviceId }, userId);
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ── POST /v1/skills/validate — validate a skill manifest and/or SKILL.md ────
skillRoutes.post('/v1/skills/validate', userAuth, async (c) => {
  try {
    const userId = c.get('caller').sub ?? '';
    const body   = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    return proxySkillsPost(c.env, '/internal/skills/validate', body, userId);
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ── POST /v1/skills/install-plan — create a reviewable install plan ──────────
skillRoutes.post('/v1/skills/install-plan', userAuth, async (c) => {
  try {
    const userId = c.get('caller').sub ?? '';
    const body   = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    return proxySkillsPost(c.env, '/internal/skills/install-plan', body, userId);
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ── POST /v1/skills/local — register a local skill (metadata only) ───────────
skillRoutes.post('/v1/skills/local', userAuth, async (c) => {
  try {
    const userId = c.get('caller').sub ?? '';
    const body   = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    return proxySkillsPost(c.env, '/internal/skills/register-local', body, userId);
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ── DELETE /v1/skills/local/:key — unregister a local skill ─────────────────
skillRoutes.delete('/v1/skills/local/:key', userAuth, async (c) => {
  try {
    const userId   = c.get('caller').sub ?? '';
    const key      = c.req.param('key');
    const deviceId = c.req.query('deviceId') ?? '';
    return proxySkillsPost(c.env, '/internal/skills/unregister-local', { key, deviceId }, userId);
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ── POST /v1/skills/local/:key/heartbeat — keep local skill alive ───────────
skillRoutes.post('/v1/skills/local/:key/heartbeat', userAuth, async (c) => {
  try {
    const userId   = c.get('caller').sub ?? '';
    const key      = c.req.param('key');
    const deviceId = c.req.query('deviceId') ?? '';
    return proxySkillsPost(c.env, '/internal/skills/heartbeat-local', { key, deviceId }, userId);
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});
