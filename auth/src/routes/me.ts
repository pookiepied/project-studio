import { Hono } from 'hono';
import { Env, MeResponse, AccessTokenPayload } from '../types';
import { verifyToken } from '../services/jwt';
import { getUserById } from '../services/user';

const me = new Hono<{ Bindings: Env }>();

me.get('/me', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Authorization header required' }, 401);
    }

    const accessToken = authHeader.substring(7);
    const payload = await verifyToken(accessToken, c.env.JWT_SECRET);
    if (!payload || payload.type !== 'access') {
      return c.json({ error: 'Invalid access token' }, 401);
    }

    const access = payload as AccessTokenPayload;
    const user = await getUserById(access.sub, c.env);
    if (!user) return c.json({ error: 'User not found' }, 404);

    const response: MeResponse = {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        role: user.role,
      },
    };

    return c.json(response);
  } catch {
    return c.json({ error: 'Failed to get user info' }, 500);
  }
});

export default me;
