import type { Context, Next } from 'hono';
import { resolveIdentity } from './resolveIdentity';
import type { Env, Variables } from '../server/types';
import type { Caller } from '../types';

type AppContext = Context<{
  Bindings: Env;
  Variables: Variables & { caller: Caller };
}>;

export async function requireUser(c: AppContext, next: Next) {
  const identity = await resolveIdentity(c.req.raw, c.env);
  if (!identity) return c.json({ error: 'unauthorized' }, 401);

  c.set('caller', {
    type: 'user',
    sub: identity.userId,
    email: identity.email,
    role: identity.role,
  });

  return next();
}
