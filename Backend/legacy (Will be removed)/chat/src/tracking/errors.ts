/**
 * emitError() — convenience wrapper for emitting error-severity events.
 *
 * Usage:
 *   emitError(env, ctx, 'provider.error', { provider, model, requestType, error: err.message });
 *
 * Equivalent to calling emit() with severity: 'error' — saves repeating the
 * severity field at every error site.
 */

import { Env } from '../env';
import { emit, AIEvent } from './events';

export function emitError(
  env:     Env,
  ctx:     ExecutionContext | undefined,
  event:   AIEvent,
  data:    Record<string, unknown>,
  opts?:   { userId?: string; runId?: string },
): void {
  emit(env, ctx, {
    event,
    severity: 'error',
    userId:   opts?.userId,
    runId:    opts?.runId,
    data,
  });
}
