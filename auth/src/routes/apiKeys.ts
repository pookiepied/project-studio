import { Hono } from 'hono';
import { Env, AccessTokenPayload } from '../types';
import { verifyToken, generateApiToken, TOKEN_EXPIRY } from '../services/jwt';
import { emit } from '../tracking';

// ---------------------------------------------------------------------------
// KV key schema
//
// apikey:{userId}:{jti}  →  ApiKeyRecord (JSON)
//   - Used for listing a user's API keys (AUTH_KV.list prefix scan)
//
// revoked-jti:{jti}      →  '1'  (TTL = remaining token lifetime)
//   - Checked by api/src/middleware/auth.ts on every request
// ---------------------------------------------------------------------------

interface ApiKeyRecord {
  jti:       string;
  name:      string;
  scope?:    string;
  createdAt: number;  // Unix seconds
  exp:       number;  // Unix seconds
  revoked?:  boolean;
}

const JTI_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const apiKeys = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Helper — require a valid access token (STUDIO users only, not API tokens)
// ---------------------------------------------------------------------------

async function requireAccess(authHeader: string | undefined, secret: string): Promise<AccessTokenPayload | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const payload = await verifyToken(token, secret);
  if (!payload || payload.type !== 'access') return null;
  return payload as AccessTokenPayload;
}

// ---------------------------------------------------------------------------
// POST /api-keys — generate a 30-day API token
// Body: { name: string, scope?: string }
// ---------------------------------------------------------------------------

apiKeys.post('/api-keys', async (c) => {
  const caller = await requireAccess(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!caller) return c.json({ error: 'Valid access token required' }, 401);

  let body: { name?: string; scope?: string };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const name  = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : 'API Key';
  const scope = typeof body.scope === 'string' ? body.scope.trim() || undefined : undefined;

  const token = await generateApiToken(caller.sub, caller.email, caller.role, c.env.JWT_SECRET, scope);

  // Decode the JTI from the generated token payload
  const parts = token.split('.');
  const payloadJson = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  const jti: string = payloadJson.jti;
  const exp: number = payloadJson.exp;
  const now = Math.floor(Date.now() / 1000);

  const record: ApiKeyRecord = { jti, name, ...(scope ? { scope } : {}), createdAt: now, exp };
  await c.env.AUTH_KV.put(
    `apikey:${caller.sub}:${jti}`,
    JSON.stringify(record),
    { expirationTtl: exp - now + 60 },   // auto-expire slightly after token does
  );

  emit(c.env, c.executionCtx, { event: 'auth.apikey.created', severity: 'info', data: { userId: caller.sub, name, scope } });

  return c.json({
    token,
    jti,
    name,
    scope,
    expiresAt: new Date(exp * 1000).toISOString(),
    expiresIn:  TOKEN_EXPIRY.API_TOKEN,
  }, 201);
});

// ---------------------------------------------------------------------------
// GET /api-keys — list active API tokens for the authenticated user
// ---------------------------------------------------------------------------

apiKeys.get('/api-keys', async (c) => {
  const caller = await requireAccess(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!caller) return c.json({ error: 'Valid access token required' }, 401);

  const list = await c.env.AUTH_KV.list({ prefix: `apikey:${caller.sub}:` });
  const now  = Math.floor(Date.now() / 1000);

  const keys: (ApiKeyRecord & { active: boolean })[] = [];
  for (const key of list.keys) {
    const raw = await c.env.AUTH_KV.get(key.name);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw) as ApiKeyRecord;
      keys.push({ ...rec, active: !rec.revoked && rec.exp > now });
    } catch { /* skip malformed records */ }
  }

  // Most recent first
  keys.sort((a, b) => b.createdAt - a.createdAt);

  return c.json({ keys });
});

// ---------------------------------------------------------------------------
// DELETE /api-keys/:jti — revoke an API token
// ---------------------------------------------------------------------------

apiKeys.delete('/api-keys/:jti', async (c) => {
  const caller = await requireAccess(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!caller) return c.json({ error: 'Valid access token required' }, 401);

  const jti = c.req.param('jti');
  if (!jti || !JTI_RE.test(jti)) return c.json({ error: 'Invalid token ID' }, 400);

  const kvKey = `apikey:${caller.sub}:${jti}`;
  const raw   = await c.env.AUTH_KV.get(kvKey);
  if (!raw) return c.json({ error: 'API key not found' }, 404);

  let record: ApiKeyRecord;
  try {
    record = JSON.parse(raw) as ApiKeyRecord;
  } catch {
    return c.json({ error: 'Corrupt key record' }, 500);
  }

  if (record.revoked) return c.json({ error: 'Already revoked' }, 409);

  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(record.exp - now, 0);

  // Mark revoked in the blocklist (checked by api/ middleware on every request)
  if (ttl > 0) {
    await c.env.AUTH_KV.put(`revoked-jti:${jti}`, '1', { expirationTtl: ttl });
  }

  // Update the record metadata
  record.revoked = true;
  await c.env.AUTH_KV.put(kvKey, JSON.stringify(record), { expirationTtl: 86400 }); // keep 24h for history

  emit(c.env, c.executionCtx, { event: 'auth.apikey.revoked', severity: 'info', data: { userId: caller.sub, jti } });

  return c.json({ revoked: true, jti });
});

export default apiKeys;
