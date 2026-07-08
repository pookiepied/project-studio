import { Context, Next } from 'hono';
import { Env, Caller } from '../types';
import { verifyToken, AccessTokenPayload } from '@studio/jwt';
import { AUTH } from '../config/constants';

type Variables = {
  caller: Caller;
};

export async function userAuth(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7).trim();
  if (!token || token.length > AUTH.MAX_TOKEN_LENGTH) {
    return c.json({ error: 'Invalid token format' }, 401);
  }

  const jwtSecret = c.env.JWT_SECRET;
  if (!jwtSecret) {
    return c.json({ error: 'Authentication not configured' }, 503);
  }

  const payload = await verifyToken(token, jwtSecret);
  if (!payload || payload.type === 'refresh') {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (c.env.REVOKED_KV) {
    const byToken = await c.env.REVOKED_KV.get(`revoked:${token}`);
    if (byToken !== null) return c.json({ error: 'Token has been revoked' }, 401);
    const jti = (payload as any).jti;
    if (jti) {
      const byJti = await c.env.REVOKED_KV.get(`revoked-jti:${jti}`);
      if (byJti !== null) return c.json({ error: 'Token has been revoked' }, 401);
    }
  }

  c.set('caller', {
    type: 'user',
    sub: payload.sub,
    email: (payload as AccessTokenPayload).email,
    role: (payload as AccessTokenPayload).role,
  } as Caller);
  return await next();
}
