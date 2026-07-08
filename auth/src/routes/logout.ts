import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { Env } from '../types';
import { verifyToken } from '../services/jwt';
import { emit } from '../tracking';

const logout = new Hono<{ Bindings: Env }>();

logout.post('/logout', async (c) => {
  deleteCookie(c, 'refresh_token', {
    httpOnly: true,
    secure: c.env.ENVIRONMENT === 'production',
    sameSite: 'Strict',
    path: '/',
  });

  // Server-side access token revocation.
  // The HMAC signature (third JWT segment) is stored in KV as the unique revocation key
  // with a TTL equal to the token's remaining lifetime, so expired entries clean themselves up.
  try {
    const body = await c.req.json().catch(() => ({})) as { accessToken?: unknown };
    const accessToken = body.accessToken;

    if (accessToken && typeof accessToken === 'string') {
      const parts = accessToken.split('.');
      if (parts.length === 3) {
        const payload = await verifyToken(accessToken, c.env.JWT_SECRET);
        if (payload && payload.type === 'access') {
          const ttl = payload.exp - Math.floor(Date.now() / 1000);
          if (ttl > 0) {
            await c.env.AUTH_KV.put(`revoked:${parts[2]}`, '1', { expirationTtl: ttl });
          }
        }
      }
    }
  } catch {
    // Revocation failure is non-fatal — the token expires naturally within 1 hour.
  }

  emit(c.env, c.executionCtx, { event: 'auth.logout', severity: 'info' });
  return c.json({ success: true, message: 'Logged out successfully' });
});

export default logout;
