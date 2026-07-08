import { Hono } from 'hono';
import { Env, Caller } from '../types';
import { userAuth } from '../middleware/auth';
import { JOB, TASK } from '../config/constants';
import { VALID_RESULT_STATUSES, parseJobData, sanitizeWaitSeconds, isPlainObject, isValidJobId } from '../utils/validation';
import { handleUnknownError } from '../utils/errors';
import { emit } from '../tracking';

type Variables = {
  caller: Caller;
};

export const engineRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ------------------------------------------------------------------
// Job claiming
// ------------------------------------------------------------------

/**
 * Claim the next queued job with optional long-polling.
 *
 * The caller may pass ?target=local to claim only local-targeted jobs,
 * or ?target=any to claim jobs with no specific target requirement.
 * Omitting the parameter defaults to 'local' (the typical case for a
 * local engine claiming work it can execute).
 *
 * Uses an atomic UPDATE...WHERE...RETURNING to prevent race conditions
 * when multiple engine instances poll simultaneously.
 */
engineRoutes.get('/internal/jobs/next', userAuth, async (c) => {
  try {
    const waitParam = c.req.query('wait');
    const targetParam = c.req.query('target') ?? 'local';

    // Only allow known target values
    const validTargets = ['cloud', 'local', 'any'] as const;
    type Target = typeof validTargets[number];
    const target: Target = validTargets.includes(targetParam as Target)
      ? (targetParam as Target)
      : 'local';

    const waitSeconds = sanitizeWaitSeconds(waitParam, JOB.MAX_WAIT_SECONDS);
    const deadline = Date.now() + waitSeconds * 1000;

    while (Date.now() < deadline) {
      // Atomic claim: matches jobs whose execution_target is either the
      // requested target or 'any' (claimable by anyone).
      const result = await c.env.DB.prepare(`
        UPDATE jobs
        SET status = 'running', updated_at = ?, heartbeat_at = ?
        WHERE id = (
          SELECT id FROM jobs
          WHERE status = 'queued'
            AND (execution_target = ? OR execution_target = 'any')
          ORDER BY created_at ASC
          LIMIT 1
        )
        RETURNING *
      `).bind(Date.now(), Date.now(), target).first();

      if (result) {
        const job = {
          ...result,
          inputs: parseJobData(result.inputs as string) || {},
          options: parseJobData(result.options as string) || {},
        };
        emit(c.env, c.executionCtx, {
          event: 'job.claimed', severity: 'info',
          userId: result.user_id as string | undefined,
          data: { jobId: result.id, taskId: result.task_id, target },
        });
        return c.json({ job });
      }

      const remaining = deadline - Date.now();
      if (remaining > JOB.POLL_INTERVAL_MS) {
        await new Promise((resolve) => setTimeout(resolve, JOB.POLL_INTERVAL_MS));
      } else if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
        break;
      } else {
        break;
      }
    }

    return c.json({ job: null });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ------------------------------------------------------------------
// Job result submission
// ------------------------------------------------------------------

/**
 * Submit job result (status: 'done' | 'failed').
 * Only accepts jobs currently in 'running' state.
 */
engineRoutes.post('/internal/jobs/:id/result', userAuth, async (c) => {
  try {
    const jobId = c.req.param('id');

    if (!jobId || !isValidJobId(jobId)) {
      return c.json({ error: 'Invalid job ID format' }, 400);
    }

    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON in request body' }, 400);
    }

    const { status, result, error } = body;

    if (!status || typeof status !== 'string') {
      return c.json({ error: 'status is required and must be a string' }, 400);
    }

    if (!VALID_RESULT_STATUSES.includes(status as typeof VALID_RESULT_STATUSES[number])) {
      return c.json({ error: 'status must be "done" or "failed"' }, 400);
    }

    const resultStr = result ? JSON.stringify(result) : null;
    if (resultStr && resultStr.length > 1048576) {
      return c.json({ error: 'Result data exceeds 1MB limit' }, 400);
    }

    const now = Date.now();
    const updateResult = await c.env.DB.prepare(`
      UPDATE jobs
      SET status = ?, result = ?, error = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'running'
    `).bind(status, resultStr, error ?? null, now, now, jobId).run();

    if (updateResult.meta.changes === 0) {
      return c.json({ error: 'Job not found or not in running state' }, 404);
    }

    emit(c.env, c.executionCtx, {
      event:    status === 'done' ? 'job.completed' : 'job.failed',
      severity: status === 'done' ? 'info' : 'warn',
      data:     { jobId, status, hasError: !!error },
    });

    return c.json({ success: true });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ------------------------------------------------------------------
// Heartbeat
// ------------------------------------------------------------------

/**
 * Update the heartbeat timestamp for a running job.
 *
 * The local engine calls this every few seconds while processing to prove
 * liveness. Jobs whose heartbeat_at becomes stale (per HEARTBEAT_TIMEOUT_MS
 * in constants) are eligible for reset by a future reaper process.
 *
 * Deliberately lightweight — no body required.
 */
engineRoutes.post('/internal/jobs/:id/heartbeat', userAuth, async (c) => {
  try {
    const jobId = c.req.param('id');

    if (!jobId || !isValidJobId(jobId)) {
      return c.json({ error: 'Invalid job ID format' }, 400);
    }

    const updateResult = await c.env.DB.prepare(`
      UPDATE jobs
      SET heartbeat_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).bind(Date.now(), Date.now(), jobId).run();

    if (updateResult.meta.changes === 0) {
      return c.json({ error: 'Job not found or not in running state' }, 404);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ------------------------------------------------------------------
// Job progress
// ------------------------------------------------------------------

/**
 * Update job progress metadata (e.g. percentage, current step description).
 */
engineRoutes.post('/internal/jobs/:id/progress', userAuth, async (c) => {
  try {
    const jobId = c.req.param('id');

    if (!jobId || !isValidJobId(jobId)) {
      return c.json({ error: 'Invalid job ID format' }, 400);
    }

    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON in request body' }, 400);
    }

    const { progress } = body;

    if (!isPlainObject(progress)) {
      return c.json({ error: 'progress is required and must be an object' }, 400);
    }

    const updateResult = await c.env.DB.prepare(`
      UPDATE jobs
      SET progress = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).bind(JSON.stringify(progress), Date.now(), jobId).run();

    if (updateResult.meta.changes === 0) {
      return c.json({ error: 'Job not found or not in running state' }, 404);
    }

    emit(c.env, c.executionCtx, {
      event: 'job.progress.updated', severity: 'info',
      data: { jobId },
    });

    return c.json({ success: true });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});

// ------------------------------------------------------------------
// Task registration
// ------------------------------------------------------------------

/**
 * Register the set of tasks the local engine can handle.
 * Stored in KV for the frontend to display available capabilities.
 */
engineRoutes.post('/internal/tasks/register', userAuth, async (c) => {
  try {
    const body = await c.req.json();
    const { tasks } = body;

    if (!Array.isArray(tasks)) {
      return c.json({ error: 'tasks must be an array' }, 400);
    }

    if (tasks.length === 0) {
      return c.json({ error: 'tasks array cannot be empty' }, 400);
    }

    if (tasks.length > TASK.MAX_TASKS) {
      return c.json({ error: `Maximum ${TASK.MAX_TASKS} tasks allowed` }, 400);
    }

    await c.env.KV.put('task_catalog', JSON.stringify(tasks), {
      expirationTtl: TASK.CATALOG_TTL,
    });

    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO system_state (key, value, updated_at)
      VALUES ('engine_last_seen', ?, ?)
    `).bind(new Date().toISOString(), Date.now()).run();

    emit(c.env, c.executionCtx, {
      event: 'engine.tasks.registered', severity: 'info',
      data: { taskCount: tasks.length },
    });

    return c.json({ success: true, taskCount: tasks.length });
  } catch (error) {
    return c.json(handleUnknownError(error), 500);
  }
});
