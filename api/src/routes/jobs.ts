import { Hono } from 'hono';
import { Env, Caller } from '../types';
import { userAuth } from '../middleware/auth';
import { JOB } from '../config/constants';
import { VALID_JOB_STATUSES, parseJobData, isValidJobId, sanitizeLimit } from '../utils/validation';
import { createApiError, ErrorCode, getStatusCode, handleUnknownError } from '../utils/errors';
import { emit } from '../tracking';

type Variables = {
  caller: Caller;
  requestId?: string;
};

export const jobRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Create a new job
 */
jobRoutes.post('/run', userAuth, async (c) => {
  const requestId = c.get('requestId') as string | undefined;
  
  try {
    let body;
    try {
      body = await c.req.json();
    } catch (e) {
      const error = createApiError(ErrorCode.INVALID_JSON, undefined, requestId);
      return c.json(error, getStatusCode(ErrorCode.INVALID_JSON) as 400);
    }
    
    const { taskId, inputs, options, executionTarget } = body;
    const caller = c.get('caller');

    if (!taskId || typeof taskId !== 'string') {
      const error = createApiError(
        ErrorCode.MISSING_REQUIRED_FIELD,
        'taskId is required and must be a string',
        requestId
      );
      return c.json(error, 400);
    }
    
    if (!inputs || typeof inputs !== 'object') {
      const error = createApiError(
        ErrorCode.MISSING_REQUIRED_FIELD,
        'inputs is required and must be an object',
        requestId
      );
      return c.json(error, 400);
    }
    
    // Ensure user ID exists (should always be set by userAuth middleware)
    const userId = caller.sub;
    if (!userId) {
      emit(c.env, c.executionCtx, { event: 'job.auth.missing_sub', severity: 'error', data: { route: 'POST /run' } });
      const error = createApiError(ErrorCode.INTERNAL_ERROR, undefined, requestId);
      return c.json(error, getStatusCode(ErrorCode.INTERNAL_ERROR) as 500);
    }

    // Use full UUID to prevent collisions
    const jobId = `job_${crypto.randomUUID()}`;
    const now = Date.now();
    const validTargets = ['cloud', 'local', 'any'];
    const target = validTargets.includes(executionTarget) ? executionTarget : 'any';

    await c.env.DB.prepare(`
      INSERT INTO jobs (id, task_id, user_id, status, execution_target, inputs, options, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)
    `).bind(
      jobId,
      taskId,
      userId,
      target,
      JSON.stringify(inputs),
      JSON.stringify(options || {}),
      now,
      now
    ).run();

    emit(c.env, c.executionCtx, {
      event: 'job.created', severity: 'info',
      userId, data: { jobId, taskId, target },
    });

    return c.json({
      jobId,
      status: 'queued',
      taskId,
      createdAt: new Date(now).toISOString(),
      estimatedWait: '~2s'
    });
  } catch (error) {
    const apiError = handleUnknownError(error, requestId);
    return c.json(apiError, getStatusCode(apiError.code) as 500);
  }
});

/**
 * List jobs for the authenticated user
 */
jobRoutes.get('/jobs', userAuth, async (c) => {
  const requestId = c.get('requestId') as string | undefined;
  
  try {
    const caller = c.get('caller');
    const statusParam = c.req.query('status');
    const limitParam = c.req.query('limit');
    
    // Ensure user ID exists
    const userId = caller.sub;
    if (!userId) {
      emit(c.env, c.executionCtx, { event: 'job.auth.missing_sub', severity: 'error', data: { route: 'GET /jobs' } });
      const error = createApiError(ErrorCode.INTERNAL_ERROR, undefined, requestId);
      return c.json(error, 500);
    }

    const limit = sanitizeLimit(limitParam, JOB.DEFAULT_LIMIT, JOB.MAX_LIMIT);

    let query = 'SELECT * FROM jobs WHERE user_id = ?';
    const params: (string | number)[] = [userId];

    if (statusParam && VALID_JOB_STATUSES.includes(statusParam as typeof VALID_JOB_STATUSES[number])) {
      query += ' AND status = ?';
      params.push(statusParam);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const jobs = (result.results || []).map((row: Record<string, unknown>) => ({
      ...row,
      inputs: parseJobData(row.inputs as string) || {},
      options: parseJobData(row.options as string) || {},
      result: row.result ? parseJobData(row.result as string) : null,
      progress: row.progress ? parseJobData(row.progress as string) : null
    }));

    return c.json({ jobs });
  } catch (error) {
    const apiError = handleUnknownError(error, requestId);
    return c.json(apiError, getStatusCode(apiError.code) as 500);
  }
});

/**
 * Get a specific job by ID
 */
jobRoutes.get('/jobs/:id', userAuth, async (c) => {
  const requestId = c.get('requestId') as string | undefined;
  
  try {
    const jobId = c.req.param('id');
    const caller = c.get('caller');
    
    if (!jobId || !isValidJobId(jobId)) {
      const error = createApiError(ErrorCode.INVALID_FORMAT, 'Invalid job ID format', requestId);
      return c.json(error, 400);
    }
    
    // Ensure user ID exists
    const userId = caller.sub;
    if (!userId) {
      emit(c.env, c.executionCtx, { event: 'job.auth.missing_sub', severity: 'error', data: { route: 'GET /jobs/:id' } });
      const error = createApiError(ErrorCode.INTERNAL_ERROR, undefined, requestId);
      return c.json(error, 500);
    }

    const result = await c.env.DB.prepare(
      'SELECT * FROM jobs WHERE id = ? AND user_id = ?'
    ).bind(jobId, userId).first();

    if (!result) {
      const error = createApiError(ErrorCode.NOT_FOUND, 'Job not found', requestId);
      return c.json(error, 404);
    }

    const job = {
      ...result,
      inputs: parseJobData(result.inputs as string) || {},
      options: parseJobData(result.options as string) || {},
      result: result.result ? parseJobData(result.result as string) : null,
      progress: result.progress ? parseJobData(result.progress as string) : null
    };

    return c.json({ job });
  } catch (error) {
    const apiError = handleUnknownError(error, requestId);
    return c.json(apiError, getStatusCode(apiError.code) as 500);
  }
});

/**
 * Cancel a queued job
 */
jobRoutes.delete('/jobs/:id', userAuth, async (c) => {
  const requestId = c.get('requestId') as string | undefined;
  
  try {
    const jobId = c.req.param('id');
    const caller = c.get('caller');
    
    if (!jobId || !isValidJobId(jobId)) {
      const error = createApiError(ErrorCode.INVALID_FORMAT, 'Invalid job ID format', requestId);
      return c.json(error, 400);
    }
    
    // Ensure user ID exists
    const userId = caller.sub;
    if (!userId) {
      emit(c.env, c.executionCtx, { event: 'job.auth.missing_sub', severity: 'error', data: { route: 'DELETE /jobs/:id' } });
      const error = createApiError(ErrorCode.INTERNAL_ERROR, undefined, requestId);
      return c.json(error, 500);
    }

    const result = await c.env.DB.prepare(`
      UPDATE jobs
      SET status = 'cancelled', updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'queued'
    `).bind(Date.now(), jobId, userId).run();

    if (result.meta.changes === 0) {
      const error = createApiError(ErrorCode.CANNOT_MODIFY, 'Job not found or cannot be cancelled', requestId);
      return c.json(error, 409);
    }

    emit(c.env, c.executionCtx, {
      event: 'job.cancelled', severity: 'info',
      userId, data: { jobId },
    });

    return c.json({ success: true, message: 'Job cancelled' });
  } catch (error) {
    const apiError = handleUnknownError(error, requestId);
    return c.json(apiError, getStatusCode(apiError.code) as 500);
  }
});
