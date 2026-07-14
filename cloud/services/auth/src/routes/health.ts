import { Hono } from 'hono';
import { Env } from '../types';

const health = new Hono<{ Bindings: Env }>();

health.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'auth-gate',
    timestamp: new Date().toISOString(),
    version: '1.0.4',
  })
);

export default health;
