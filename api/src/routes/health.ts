import { Hono } from 'hono';
import { Env, Caller } from '../types';
import { HealthResponse, SystemStatusResponse } from '../types/health';
import { HEALTH } from '../config/constants';

type Variables = {
  caller: Caller;
};

export const healthRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Basic health check endpoint
 */
healthRoutes.get('/health', (c) => {
  const response: HealthResponse = {
    status: 'healthy',
    service: 'api-gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: 0
  };

  return c.json(response);
});

/**
 * Detailed system status with component health checks
 */
healthRoutes.get('/system/status', async (c) => {
  try {
    const startTime = Date.now();
    
    const [queuedResult, runningResult, completedResult, failedResult, engineState] = await Promise.all([
      c.env.DB.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'queued'").first(),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'running'").first(),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'done'").first(),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'").first(),
      c.env.DB.prepare("SELECT value, updated_at FROM system_state WHERE key = 'engine_last_seen'").first()
    ]);

    const engineLastSeen = engineState ? engineState.value as string : null;
    const engineLastUpdate = engineState ? engineState.updated_at as number : null;
    const engineOnline = engineLastUpdate && (Date.now() - engineLastUpdate) < HEALTH.ENGINE_TIMEOUT_MS;

    let aiStatus: 'operational' | 'degraded' | 'down' = 'operational';
    let modelCount = 0;
    let aiMessage = '';

    try {
      const aiHealthResponse = await c.env.AI.fetch(new Request('http://internal/v1/health'));
      
      if (!aiHealthResponse.ok) {
        aiStatus = 'degraded';
        aiMessage = `AI worker returned ${aiHealthResponse.status}`;
      }
      
      const modelsResponse = await c.env.AI.fetch(new Request('http://internal/v1/models'));
      if (modelsResponse.ok) {
        const data = await modelsResponse.json() as { uniqueModels?: number };
        modelCount = data.uniqueModels || 0;
      }
    } catch (error) {
      aiStatus = 'down';
      aiMessage = error instanceof Error ? error.message : 'Connection failed';
    }

    const dbResponseTime = Date.now() - startTime;
    const dbStatus: 'operational' | 'degraded' | 'down' = 
      dbResponseTime < HEALTH.DB_FAST_THRESHOLD_MS ? 'operational' : 
      dbResponseTime < HEALTH.DB_SLOW_THRESHOLD_MS ? 'degraded' : 'down';

    const overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 
      aiStatus === 'down' || dbStatus === 'down' ? 'unhealthy' :
      aiStatus === 'degraded' || dbStatus === 'degraded' || !engineOnline ? 'degraded' : 'healthy';

    const response: SystemStatusResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      components: {
        api: {
          status: 'operational',
          message: 'API gateway running'
        },
        engine: {
          status: engineOnline ? 'operational' : 'down',
          message: engineOnline ? 'Engine connected' : 'Engine offline',
          lastCheck: engineLastSeen || undefined
        },
        ai: {
          status: aiStatus,
          message: aiMessage || 'AI worker operational',
          metadata: {
            modelCount
          }
        },
        database: {
          status: dbStatus,
          message: `Response time: ${dbResponseTime}ms`,
          metadata: {
            responseTime: dbResponseTime
          }
        }
      },
      metrics: {
        jobs: {
          queued: (queuedResult?.count as number) || 0,
          running: (runningResult?.count as number) || 0,
          completed: (completedResult?.count as number) || 0,
          failed: (failedResult?.count as number) || 0
        }
      }
    };

    const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;
    return c.json(response, statusCode);
    
  } catch (error) {
    const errorResponse: SystemStatusResponse = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      components: {
        api: {
          status: 'operational',
          message: 'API gateway running'
        },
        engine: {
          status: 'down',
          message: 'Unable to check engine status'
        },
        ai: {
          status: 'down',
          message: 'Unable to check AI worker status'
        },
        database: {
          status: 'down',
          message: error instanceof Error ? error.message : 'Database check failed'
        }
      },
      metrics: {
        jobs: {
          queued: 0,
          running: 0,
          completed: 0,
          failed: 0
        }
      }
    };

    return c.json(errorResponse, 503);
  }
});
