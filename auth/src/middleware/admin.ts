import { Context } from 'hono';
import { Env, AccessTokenPayload } from '../types';
import { verifyToken } from '../services/jwt';

export const ADMIN_RATE_LIMIT = { windowMs: 60_000, maxRequests: 30 };

export async function requireAdmin(
  c: Context<{ Bindings: Env }>
): Promise<AccessTokenPayload | Response> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authorization header required' }, 401);
  }
  const payload = await verifyToken(authHeader.substring(7), c.env.JWT_SECRET);
  if (!payload || payload.type !== 'access') {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
  const access = payload as AccessTokenPayload;
  if (access.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }
  return access;
}
