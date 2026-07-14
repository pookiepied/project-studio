import { Hono } from 'hono';
import type { Env, Variables } from '../../../server/types';

export const healthRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

healthRoutes.get('/health', (c) =>
  c.json({
    service: 'studio-api',
    status: 'ok',
    timestamp: new Date().toISOString(),
  }),
);

healthRoutes.get('/status', (c) =>
  c.json({
    service: 'studio-api',
    status: 'operational',
    environment: c.env.ENVIRONMENT ?? 'unknown',
    timestamp: new Date().toISOString(),
  }),
);
