import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { Env, RefreshResponse, TOKEN_EXPIRY } from '../types';
import { generateAccessToken, generateRefreshToken, verifyToken } from '../services/jwt';
import { isWhitelisted } from '../services/whitelist';
import { getUserById } from '../services/user';
import { rateLimit } from '../middleware/rateLimit';
import { emit } from '../tracking';

const refresh = new Hono<{ Bindings: Env }>();

refresh.post('/refresh', async (c) => {
  const allowed = await rateLimit(c, { windowMs: 60_000, maxRequests: 10 });
  if (!allowed) {
    emit(c.env, c.executionCtx, { event: 'auth.token.refresh_rate_limited', severity: 'warn' });
    return c.json({ error: 'Too many requests' }, 429);
  }

  try {
    // Browser clients send the refresh token as an HttpOnly cookie.
    // Desktop/mobile clients send it in the request body (can't read HttpOnly cookies).
    let refreshToken: string | null = null;

    const cookies = c.req.header('Cookie');
    if (cookies) {
      const match = cookies.match(/refresh_token=([^;]+)/);
      if (match?.[1]) refreshToken = decodeURIComponent(match[1]);
    }

    if (!refreshToken) {
      try {
        const body = await c.req.json();
        if (body.refreshToken && typeof body.refreshToken === 'string') {
          refreshToken = body.refreshToken;
        }
      } catch {
        // body parse failed — fall through to the 401 below
      }
    }

    if (!refreshToken) {
      return c.json({ error: 'Refresh token not found. Provide token in Cookie header or request body.' }, 401);
    }

    const payload = await verifyToken(refreshToken, c.env.JWT_SECRET);
    if (!payload || payload.type !== 'refresh') {
      return c.json({ error: 'Invalid refresh token' }, 401);
    }

    const user = await getUserById(payload.sub, c.env);
    if (!user) return c.json({ error: 'User not found' }, 404);

    const whitelisted = await isWhitelisted(user.email, c.env);
    if (!whitelisted) return c.json({ error: 'Access revoked' }, 403);

    const [accessToken, newRefreshToken] = await Promise.all([
      generateAccessToken(user.id, user.email, user.role, c.env.JWT_SECRET),
      generateRefreshToken(user.id, user.email, c.env.JWT_SECRET),
    ]);

    setCookie(c, 'refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: c.env.ENVIRONMENT === 'production',
      sameSite: 'Strict',
      path: '/',
      maxAge: TOKEN_EXPIRY.REFRESH_TOKEN,
    });

    const response: RefreshResponse = {
      accessToken,
      refreshToken: newRefreshToken, // for desktop/native apps
      expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
    };

    emit(c.env, c.executionCtx, {
      event: 'auth.token.refreshed', severity: 'info',
      userId: payload.sub,
    });

    return c.json(response);
  } catch {
    emit(c.env, c.executionCtx, { event: 'auth.token.refresh_failed', severity: 'warn' });
    return c.json({ error: 'Token refresh failed' }, 500);
  }
});

export default refresh;
