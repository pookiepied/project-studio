import { Hono } from 'hono';
import { corsMiddleware, requestId, requestLogger, requestSizeLimit, securityHeaders } from '../middleware/security';
import type { Env, Variables } from './types';
import { studioRoutes } from '../studio';

export function createApiApp(): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use('/*', requestId);
  app.use('/*', requestLogger);
  app.use('/*', corsMiddleware());
  app.use('/*', securityHeaders);
  app.use('/*', requestSizeLimit);

  app.route('/studio', studioRoutes);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
