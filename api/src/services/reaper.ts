/**
 * Stale Job Reaper
 *
 * Resets running jobs whose heartbeat_at has gone stale back to 'queued'
 * so they can be reclaimed by an engine after a crash or restart.
 *
 * A job is considered stale if:
 *   - Its status is 'running', AND
 *   - heartbeat_at is NULL (engine never sent a beat), OR
 *   - heartbeat_at is older than HEARTBEAT_STALE_THRESHOLD_MS
 *
 * Invoked by the Cloudflare Cron trigger defined in wrangler.toml.
 */

import { Env } from '../types';
import { JOB } from '../config/constants';

export interface ReaperResult {
  reset: number;
  deadLetters: number;
  checkedAt: string;
}

export async function runStaleJobReaper(env: Env): Promise<ReaperResult> {
  const now = Date.now();
  const staleThreshold = now - JOB.HEARTBEAT_STALE_THRESHOLD_MS;

  // Reset all running jobs whose heartbeat is absent or too old.
  // Also resets jobs that have been running for over 10 minutes regardless
  // of heartbeat — a safety net for very long-running or hung jobs.
  const MAX_RUNNING_MS = 10 * 60 * 1000; // 10 minutes
  const maxRunningThreshold = now - MAX_RUNNING_MS;

  // Clean up jobs that have been stuck in 'queued' for over 1 hour
  const MAX_QUEUED_MS = 60 * 60 * 1000; // 1 hour
  const maxQueuedThreshold = now - MAX_QUEUED_MS;

  const result = await env.DB.prepare(`
    UPDATE jobs
    SET
      status     = 'queued',
      updated_at = ?
    WHERE
      status = 'running'
      AND (
        heartbeat_at IS NULL
        OR heartbeat_at < ?
        OR updated_at  < ?
      )
  `).bind(now, staleThreshold, maxRunningThreshold).run();

  const deadLetterResult = await env.DB.prepare(`
    UPDATE jobs
    SET
      status     = 'failed',
      error      = 'Job timed out in queued state (dead letter)',
      updated_at = ?
    WHERE
      status = 'queued'
      AND updated_at < ?
  `).bind(now, maxQueuedThreshold).run();

  const reset = result.meta.changes ?? 0;
  const deadLetters = deadLetterResult.meta.changes ?? 0;

  return {
    reset,
    deadLetters,
    checkedAt: new Date(now).toISOString(),
  };
}
