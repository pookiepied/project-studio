import { Hono } from 'hono';
import { Env, AccessTokenPayload } from '../../types';
import { isValidEmail } from '../../utils/validation';
import { getUserByEmail } from '../../services/user';
import { rateLimit } from '../../middleware/rateLimit';
import { requireAdmin, ADMIN_RATE_LIMIT } from '../../middleware/admin';
import { emit } from '../../tracking';

const whitelist = new Hono<{ Bindings: Env }>();

whitelist.get('/admin/whitelist', async (c) => {
  const allowed = await rateLimit(c, ADMIN_RATE_LIMIT);
  if (!allowed) return c.json({ error: 'Too many requests' }, 429);

  const result = await requireAdmin(c);
  if (result instanceof Response) return result;
  const admin = result as AccessTokenPayload;

  const allKeys: { name: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await c.env.AUTH_KV.list(
      cursor ? { prefix: 'whitelist:', cursor } : { prefix: 'whitelist:' }
    );
    allKeys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const emails = allKeys.map(k => k.name.replace('whitelist:', ''));

  const users = await Promise.all(
    emails.map(async (email: string) => {
      const profile = await getUserByEmail(email, c.env);
      return {
        email,
        name: profile?.name ?? null,
        picture: profile?.picture ?? null,
        role: profile?.role ?? null,
        createdAt: profile?.createdAt ?? null,
        lastLoginAt: profile?.lastLoginAt ?? null,
        isCurrentAdmin: email === admin.email,
      };
    })
  );

  emit(c.env, c.executionCtx, {
    event: 'auth.admin.whitelist.viewed', severity: 'info',
    userId: admin.sub, data: { count: emails.length },
  });

  return c.json({ users });
});

whitelist.post('/admin/whitelist', async (c) => {
  const allowed = await rateLimit(c, ADMIN_RATE_LIMIT);
  if (!allowed) return c.json({ error: 'Too many requests' }, 429);

  const result = await requireAdmin(c);
  if (result instanceof Response) return result;
  const admin = result as AccessTokenPayload;

  let body: { email?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const email = body.email?.toLowerCase().trim();
  if (!email || !isValidEmail(email)) return c.json({ error: 'Valid email required' }, 400);

  await c.env.AUTH_KV.put(`whitelist:${email}`, 'true');

  emit(c.env, c.executionCtx, {
    event: 'auth.admin.whitelist.added', severity: 'info',
    userId: admin.sub, data: { email },
  });

  return c.json({ success: true, email });
});

whitelist.delete('/admin/whitelist', async (c) => {
  const allowed = await rateLimit(c, ADMIN_RATE_LIMIT);
  if (!allowed) return c.json({ error: 'Too many requests' }, 429);

  const result = await requireAdmin(c);
  if (result instanceof Response) return result;
  const admin = result as AccessTokenPayload;

  let body: { email?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const email = body.email?.toLowerCase().trim();
  if (!email || !isValidEmail(email)) return c.json({ error: 'Valid email required' }, 400);

  if (email === admin.email) {
    return c.json({ error: 'Cannot remove your own access' }, 400);
  }

  await c.env.AUTH_KV.delete(`whitelist:${email}`);

  emit(c.env, c.executionCtx, {
    event: 'auth.admin.whitelist.removed', severity: 'warn',
    userId: admin.sub, data: { email },
  });

  return c.json({ success: true, email });
});

export default whitelist;
