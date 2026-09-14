import type { ToolCallView } from '@/features/chat/transcript/projection'
import type { MediaJob } from '@/platform/harness'
import type { Artifact, ArtifactStatus } from '@/domain/artifacts/types'
import { isRecord } from '@/lib/guards'
import { answerText, inputString } from './callText'

/**
 * Reading a generation call - `studio_image`, `studio_video` - out of the
 * transcript's tool call, and writing it as the artifact the transcript
 * draws.
 *
 * The harness writes every finished output as one line of a fixed shape,
 * `Artifact: <path> (<mime>)`, where the path is where the harness serves
 * the bytes. The shape is the contract between the tool and this file
 * (`STUDIO HARNESS/src/tools/media/index.ts` states it), so the line is
 * parsed rather than the sentence around it guessed at. A video call
 * answers before its file exists, with the job's id; the transcript then
 * follows the job through the media routes until it lands, and the job's
 * status is folded in here.
 *
 * ---- Why an artifact ---------------------------------------------------------
 *
 * The gallery draws a generated picture as an artifact: the shell's title
 * and status line, the frames, the prompt under them. A real generation is
 * the same object and is drawn by the same component, so the two cannot
 * drift - the fixture the renderer is judged against is the renderer the
 * turn lands in. What this file produces is the envelope that component
 * reads, with the call's input where the fence's `data` would be.
 */

const MEDIA_TOOL = /^(?:native_)?studio_(image|video)$/

const ARTIFACT_LINE =
  /^Artifact: (\/api\/media\/artifacts\/[A-Za-z0-9_-]+\/media_[a-z0-9]+-[0-9]+\.[a-z0-9]+) \(([a-z]+\/[a-z0-9.+-]+)\)$/gm

const JOB_ID = /\b(media_[a-z0-9]+)\b/
const MODEL = /\bwith (\S+?)\.(?:\s|$)/

export interface MediaArtifactRef {
  readonly path: string
  readonly mimeType: string
}

export interface MediaCallView {
  readonly kind: 'image' | 'video'
  readonly prompt: string | null
  /** What the call asked for, in the tool's own spellings. */
  readonly aspectRatio: string | null
  readonly size: string | null
  readonly count: number
  readonly artifacts: readonly MediaArtifactRef[]
  /** The model named in the answer, when it named one. */
  readonly model: string | null
  /** The job a video call started, from its answer. */
  readonly jobId: string | null
}

/** `image` or `video` for one of ours, else null. */
export function mediaKind(toolName: string): 'image' | 'video' | null {
  const match = MEDIA_TOOL.exec(toolName)
  return match?.[1] === 'image' || match?.[1] === 'video' ? match[1] : null
}

/**
 * Every `Artifact:` line in a text, in order, each file once. An answer
 * can carry a file twice - the tool's own line and a job notice appended
 * to the same result - and one file is one frame whatever said it.
 */
export function artifactsIn(text: string): readonly MediaArtifactRef[] {
  const found = new Map<string, MediaArtifactRef>()
  for (const match of text.matchAll(ARTIFACT_LINE)) {
    const path = match[1]
    const mimeType = match[2]
    if (path !== undefined && mimeType !== undefined && !found.has(path)) found.set(path, { path, mimeType })
  }
  return [...found.values()]
}

export function readMediaCall(call: ToolCallView): MediaCallView | null {
  const kind = mediaKind(call.toolName)
  if (kind === null) return null
  const input = call.input?.present ? call.input.value : null
  const count = isRecord(input) && typeof input['count'] === 'number' ? input['count'] : 1
  const answered = call.output?.present ? answerText(call.output.value) : ''
  return {
    kind,
    prompt: inputString(input, 'prompt'),
    aspectRatio: inputString(input, 'aspect_ratio'),
    size: inputString(input, 'size'),
    count: Number.isInteger(count) && count > 0 ? count : 1,
    artifacts: artifactsIn(answered),
    model: MODEL.exec(answered)?.[1] ?? null,
    jobId: kind === 'video' ? (JOB_ID.exec(answered)?.[1] ?? null) : null,
  }
}

/**
 * The job a video call is followed through, as the transcript knows it.
 *
 * `null` before the first answer from the media routes; `'unknown'` when the
 * harness answered and does not hold the job - the registry is in memory,
 * so a job from before a restart is gone, and its result with it.
 */
export type FollowedJob = MediaJob | 'unknown' | null

/** How long a title may run before the prompt is a caption under it. */
const TITLE_LENGTH = 72

/**
 * A title from the prompt: its first clause, cut at a natural break when it
 * runs long. The whole prompt then stands under the frames as the caption -
 * but only when it says more than the title already has, because the same
 * sentence twice on one card is the card padding itself.
 */
export function titleOf(prompt: string | null, kind: 'image' | 'video'): string {
  if (prompt === null) return kind === 'image' ? 'An image' : 'A video'
  const line = prompt.replace(/\s+/g, ' ').trim()
  if (line.length <= TITLE_LENGTH) return line
  const head = line.slice(0, TITLE_LENGTH)
  // A clause end past the middle is the break; failing that, a word end.
  const clause = Math.max(head.lastIndexOf('. '), head.lastIndexOf(', '))
  const cut = clause > TITLE_LENGTH / 2 ? clause : head.lastIndexOf(' ')
  return `${(cut > TITLE_LENGTH / 2 ? head.slice(0, cut) : head).trimEnd()}…`
}

/**
 * The artifact the transcript draws for a generation call.
 *
 * An image call is one round trip: working until it answers, then its
 * pictures. A video call answers at once with a job, and the job is the
 * truth from then on: its state, its vendor's word on progress, its files
 * when it ends. The refusal of the call itself - a permission not granted, a
 * slot unset - is the harness's sentence and outranks everything else.
 */
export function mediaCallArtifact(
  call: ToolCallView,
  view: MediaCallView,
  job: FollowedJob,
  conversationId: string,
): Artifact {
  const answered = call.output !== null && call.output.present
  const fromJob =
    job !== null && job !== 'unknown' && job.state === 'done'
      ? job.outputs.map((output) => ({
          path: `/api/media/artifacts/${conversationId}/${output.fileName}`,
          mimeType: output.mimeType,
        }))
      : []
  const outputs = view.artifacts.length > 0 ? view.artifacts : fromJob

  let status: ArtifactStatus
  let error: string | undefined
  if (call.errorText !== null) {
    status = 'failed'
    error = call.errorText
  } else if (view.kind === 'image' || view.jobId === null) {
    status = answered ? 'done' : 'running'
  } else if (job === null) {
    status = 'running'
  } else if (job === 'unknown') {
    status = outputs.length > 0 ? 'done' : 'cancelled'
    if (outputs.length === 0) error = 'Started before Studio last restarted, so its result was not kept.'
  } else if (job.state === 'failed') {
    status = 'failed'
    error = job.error ?? 'The generation failed.'
  } else if (job.state === 'stopped') {
    status = 'cancelled'
    error = 'The generation was stopped.'
  } else if (job.state === 'done') {
    status = 'done'
  } else {
    status = 'running'
  }

  const title = titleOf(view.prompt, view.kind)
  const caption = view.prompt !== null && view.prompt.trim() !== title ? view.prompt : undefined
  const model = job !== null && job !== 'unknown' ? job.modelId : view.model
  const detail = job !== null && job !== 'unknown' && job.state === 'running' ? job.detail : null

  return {
    kind: view.kind === 'image' ? 'image_generation' : 'video_generation',
    id: call.toolCallId,
    title,
    status,
    data: {
      ...(caption === undefined ? {} : { prompt: caption }),
      ...(model === null ? {} : { model }),
      ...(view.aspectRatio === null ? {} : { aspectRatio: view.aspectRatio }),
      ...(view.size === null ? {} : { size: view.size }),
      ...(detail === null || detail === undefined ? {} : { detail }),
      ...(error === undefined ? {} : { error }),
      count: view.count,
      outputs,
    },
  }
}
