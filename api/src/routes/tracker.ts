import { Hono } from 'hono';
import { Env, Caller } from '../types';
import { userAuth } from '../middleware/auth';
import { handleUnknownError } from '../utils/errors';

type Variables = { caller: Caller };

export const trackerRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function proxyToTracker(env: Env, path: string, qs?: string): Promise<Response> {
  const url = `https://tracker${path}${qs ? `?${qs}` : ''}`;
  return env.TRACKER!.fetch(new Request(url));
}

// All /tracker/* routes require auth and proxy straight to the tracker worker.
// The tracker worker itself has no auth — it trusts the api worker to gate access.

trackerRoutes.get('/tracker/events', userAuth, async (c) => {
  try {
    const res = await proxyToTracker(c.env, '/events', new URL(c.req.url).searchParams.toString());
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

trackerRoutes.get('/tracker/runs', userAuth, async (c) => {
  try {
    const caller = c.get('caller');
    const qs     = new URLSearchParams(new URL(c.req.url).searchParams.toString() ?? '');
    if (caller.sub && !qs.has('userId')) qs.set('userId', caller.sub);
    const res = await proxyToTracker(c.env, '/runs', qs.toString());
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

trackerRoutes.get('/tracker/runs/:runId', userAuth, async (c) => {
  try {
    const res = await proxyToTracker(c.env, `/runs/${c.req.param('runId')}`);
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

trackerRoutes.get('/tracker/summary', userAuth, async (c) => {
  try {
    const caller = c.get('caller');
    const qs     = new URLSearchParams(new URL(c.req.url).searchParams.toString() ?? '');
    if (caller.sub && !qs.has('userId')) qs.set('userId', caller.sub);
    const res = await proxyToTracker(c.env, '/summary', qs.toString());
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

trackerRoutes.get('/tracker/tail-events', userAuth, async (c) => {
  try {
    const res = await proxyToTracker(c.env, '/tail-events', new URL(c.req.url).searchParams.toString());
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ── Usage routes — token/cost/latency data from usage_events table ───────────

trackerRoutes.get('/tracker/usage/summary', userAuth, async (c) => {
  try {
    const caller = c.get('caller');
    const qs     = new URLSearchParams(new URL(c.req.url).searchParams.toString() ?? '');
    if (caller.sub && !qs.has('userId')) qs.set('userId', caller.sub);
    const res = await proxyToTracker(c.env, '/usage/summary', qs.toString());
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

trackerRoutes.get('/tracker/usage/data', userAuth, async (c) => {
  try {
    const caller = c.get('caller');
    const qs     = new URLSearchParams(new URL(c.req.url).searchParams.toString() ?? '');
    if (caller.sub && !qs.has('userId')) qs.set('userId', caller.sub);
    const res = await proxyToTracker(c.env, '/usage/data', qs.toString());
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

trackerRoutes.get('/tracker/usage/logs', userAuth, async (c) => {
  try {
    const caller = c.get('caller');
    const qs     = new URLSearchParams(new URL(c.req.url).searchParams.toString() ?? '');
    if (caller.sub && !qs.has('userId')) qs.set('userId', caller.sub);
    const res = await proxyToTracker(c.env, '/usage/logs', qs.toString());
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

trackerRoutes.get('/tracker/usage/credits', userAuth, async (c) => {
  try {
    const res = await proxyToTracker(c.env, '/usage/credits');
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});
