import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { Env, LoginResponse, TOKEN_EXPIRY } from '../types';
import { generateAccessToken, generateRefreshToken } from '../services/jwt';
import { isWhitelisted } from '../services/whitelist';
import { verifyGoogleIdToken } from '../services/google';
import { upsertUser } from '../services/user';
import { rateLimit } from '../middleware/rateLimit';
import { emit } from '../tracking';

const google = new Hono<{ Bindings: Env }>();

google.post('/google', async (c) => {
  const allowed = await rateLimit(c, { windowMs: 60_000, maxRequests: 5 });
  if (!allowed) {
    emit(c.env, c.executionCtx, { event: 'auth.login.rate_limited', severity: 'warn' });
    return c.json({ error: 'Too many requests' }, 429);
  }

  try {
    let body: { idToken?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const { idToken } = body;
    if (!idToken || typeof idToken !== 'string') {
      return c.json({ error: 'ID token required' }, 400);
    }

    const googleUser = await verifyGoogleIdToken(idToken, c.env.GOOGLE_CLIENT_ID);
    if (!googleUser) {
      emit(c.env, c.executionCtx, { event: 'auth.login.failed', severity: 'warn', data: { reason: 'invalid_token' } });
      return c.json({ error: 'Invalid ID token' }, 400);
    }

    if (!googleUser.email_verified) {
      emit(c.env, c.executionCtx, { event: 'auth.login.failed', severity: 'warn', data: { reason: 'email_not_verified' } });
      return c.json({ error: 'Email not verified' }, 403);
    }

    const whitelisted = await isWhitelisted(googleUser.email, c.env);
    if (!whitelisted) {
      emit(c.env, c.executionCtx, { event: 'auth.login.failed', severity: 'warn', data: { reason: 'not_whitelisted' } });
      return c.json({
        error: 'Access denied',
        message: 'Your email is not whitelisted. Please contact the administrator.',
      }, 403);
    }

    const user = await upsertUser(googleUser, c.env);

    const [accessToken, refreshToken] = await Promise.all([
      generateAccessToken(user.id, user.email, user.role, c.env.JWT_SECRET),
      generateRefreshToken(user.id, user.email, c.env.JWT_SECRET),
    ]);

    setCookie(c, 'refresh_token', refreshToken, {
      httpOnly: true,
      secure: c.env.ENVIRONMENT === 'production',
      sameSite: 'Strict',
      path: '/',
      maxAge: TOKEN_EXPIRY.REFRESH_TOKEN,
    });

    const response: LoginResponse = {
      accessToken,
      refreshToken, // included for desktop apps that can't read HttpOnly cookies
      expiresIn: TOKEN_EXPIRY.ACCESS_TOKEN,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        role: user.role,
      },
    };

    emit(c.env, c.executionCtx, {
      event: 'auth.login.success', severity: 'info',
      userId: user.id, data: { role: user.role },
    });

    return c.json(response);
  } catch {
    emit(c.env, c.executionCtx, { event: 'auth.login.failed', severity: 'error', data: { reason: 'exception' } });
    return c.json({ error: 'Authentication failed' }, 500);
  }
});

export default google;
