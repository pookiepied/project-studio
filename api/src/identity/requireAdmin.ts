import type { Context, Next } from 'hono';
import type { Env, Variables } from '../server/types';
import { resolveIdentity } from './resolveIdentity';

type AppContext = Context<{
  Bindings: Env;
  Variables: Variables;
}>;

export async function requireAdmin(c: AppContext, next: Next) {
  const identity = await resolveIdentity(c.req.raw, c.env);
  if (!identity) return c.json({ error: 'unauthorized' }, 401);
  if (identity.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

  c.set('caller', {
    type: 'user',
    sub: identity.userId,
    email: identity.email,
    role: identity.role,
  });

  return next();
}
