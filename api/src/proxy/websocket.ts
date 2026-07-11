import type { Env } from '../types';
import { resolveIdentity } from '../identity/resolveIdentity';

const EVENTS_PATH = /^\/studio\/conversations\/([^/]+)\/events$/;

export async function maybeForwardStudioWebSocket(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (request.headers.get('Upgrade') !== 'websocket') return null;

  const url = new URL(request.url);
  const match = url.pathname.match(EVENTS_PATH);
  if (!match) return null;

  const identity = await resolveIdentity(request, env);
  if (!identity) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const conversationId = match[1];
  const headers = new Headers(request.headers);
  headers.set('X-User-ID', identity.userId);

  const target = new URL(request.url);
  target.pathname = `/runs/${encodeURIComponent(conversationId)}/ws`;
  return env.EXECUTION_RUNTIME.fetch(new Request(target, { headers }));
}
