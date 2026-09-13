/**
 * The background commands and generation jobs a conversation started.
 */

import { CAPABILITY_SLOTS, type CapabilitySlot } from './picklists'
import { oneOf } from './guards'

/**
 * One command the model started in the background.
 *
 * The wire shape of the harness's job status, narrowed to what the panel
 * renders. `output` is the bounded tail the harness keeps - a few hundred
 * lines - and `dropped` is how many scrolled off the front of it, which is the
 * one thing a tail cannot say about itself.
 */
export interface BackgroundJob {
  readonly id: string
  /** The command line as the person would read it. */
  readonly command: string
  readonly state: 'running' | 'exited' | 'stopped' | 'failed'
  /** Null while it runs. */
  readonly exitCode: number | null
  readonly startedAt: number
  readonly endedAt: number | null
  readonly output: string
  readonly dropped: number
  /** Why it never started, when that is what happened. */
  readonly error?: string
}

export const JOB_STATES = ['running', 'exited', 'stopped', 'failed'] as const

/**
 * A generation job - an image or a video the model asked for - as the
 * harness's `MediaJobs` reports it. Its outputs are files the harness holds,
 * served at `/api/media/artifacts/<conversation>/<fileName>`.
 */
export interface MediaJob {
  readonly id: string
  readonly slot: CapabilitySlot
  /** The prompt. */
  readonly description: string
  readonly modelId: string
  readonly state: 'queued' | 'running' | 'done' | 'failed' | 'stopped'
  readonly detail: string | null
  readonly startedAt: number
  readonly endedAt: number | null
  readonly outputs: readonly { readonly fileName: string; readonly mimeType: string }[]
  readonly error?: string
}

export const MEDIA_JOB_STATES = ['queued', 'running', 'done', 'failed', 'stopped'] as const

export function parseMediaJobs(value: unknown): readonly MediaJob[] {
  if (typeof value !== 'object' || value === null) return []
  const rows = (value as Record<string, unknown>)['jobs']
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => {
    const job = parseMediaJob(row)
    return job === null ? [] : [job]
  })
}

export function parseMediaJob(value: unknown): MediaJob | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const id = row['id']
  const slot = oneOf(CAPABILITY_SLOTS, row['slot'])
  const state = row['state']
  if (typeof id !== 'string' || id === '' || slot === null) return null
  if (typeof state !== 'string' || !MEDIA_JOB_STATES.includes(state as MediaJob['state'])) return null
  const number = (key: string): number | null => {
    const found = row[key]
    return typeof found === 'number' && Number.isFinite(found) ? found : null
  }
  const outputs = Array.isArray(row['outputs'])
    ? row['outputs'].flatMap((output: unknown) => {
        if (typeof output !== 'object' || output === null) return []
        const record = output as Record<string, unknown>
        const fileName = record['fileName']
        const mimeType = record['mimeType']
        return typeof fileName === 'string' && typeof mimeType === 'string' ? [{ fileName, mimeType }] : []
      })
    : []
  const error = row['error']
  return {
    id,
    slot,
    description: typeof row['description'] === 'string' ? row['description'] : '',
    modelId: typeof row['modelId'] === 'string' ? row['modelId'] : '',
    state: state as MediaJob['state'],
    detail: typeof row['detail'] === 'string' ? row['detail'] : null,
    startedAt: number('startedAt') ?? 0,
    endedAt: number('endedAt'),
    outputs,
    ...(typeof error === 'string' ? { error } : {}),
  }
}

/**
 * Reads the jobs out of a listing, dropping anything malformed.
 *
 * A row that does not parse is left out rather than rendered as a job with
 * blank fields: the panel is a list of processes a person may stop, and a row
 * with no id is a stop button that cannot work.
 */
export function parseBackgroundJobs(value: unknown): readonly BackgroundJob[] {
  if (typeof value !== 'object' || value === null) return []
  const rows = (value as Record<string, unknown>)['jobs']
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => {
    const job = parseBackgroundJob(row)
    return job === null ? [] : [job]
  })
}

export function parseBackgroundJob(value: unknown): BackgroundJob | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const id = row['id']
  const command = row['command']
  const state = row['state']
  if (typeof id !== 'string' || id === '') return null
  if (typeof command !== 'string') return null
  if (typeof state !== 'string' || !JOB_STATES.includes(state as BackgroundJob['state'])) {
    return null
  }
  const number = (key: string): number | null => {
    const found = row[key]
    return typeof found === 'number' && Number.isFinite(found) ? found : null
  }
  const error = row['error']
  return {
    id,
    command,
    state: state as BackgroundJob['state'],
    exitCode: number('exitCode'),
    startedAt: number('startedAt') ?? 0,
    endedAt: number('endedAt'),
    output: typeof row['output'] === 'string' ? row['output'] : '',
    dropped: number('dropped') ?? 0,
    ...(typeof error === 'string' ? { error } : {}),
  }
}
