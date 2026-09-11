import type { ToolCallView } from '@/features/chat/transcript/projection'

/**
 * Reading a generation call - `studio_image`, `studio_video` - out of the
 * transcript's tool call.
 *
 * The harness writes every finished output as one line of a fixed shape,
 * `Artifact: <path> (<mime>)`, where the path is where the harness serves
 * the bytes. The shape is the contract between the tool and this card
 * (`STUDIO HARNESS/src/tools/media/index.ts` states it), so the card parses
 * the line rather than guessing at the sentence around it. A video call
 * answers before its file exists, with the job's id; the card then follows
 * the job through the media routes until it lands.
 */

const MEDIA_TOOL = /^(?:native_)?studio_(image|video)$/

const ARTIFACT_LINE = /^Artifact: (\/api\/media\/artifacts\/[A-Za-z0-9_-]+\/media_[a-z0-9]+-[0-9]+\.[a-z0-9]+) \(([a-z]+\/[a-z0-9.+-]+)\)$/gm

const JOB_ID = /\b(media_[a-z0-9]+)\b/

export interface MediaArtifact {
  readonly path: string
  readonly mimeType: string
}

export interface MediaCallView {
  readonly kind: 'image' | 'video'
  readonly prompt: string | null
  readonly artifacts: readonly MediaArtifact[]
  /** The job a video call started, from its answer. */
  readonly jobId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `image` or `video` for one of ours, else null. */
export function mediaKind(toolName: string): 'image' | 'video' | null {
  const match = MEDIA_TOOL.exec(toolName)
  return match?.[1] === 'image' || match?.[1] === 'video' ? match[1] : null
}

function blocks(output: unknown): readonly unknown[] {
  if (Array.isArray(output)) return output
  if (!isRecord(output)) return []
  const content = output['content']
  if (Array.isArray(content)) return content
  const inner = output['value'] ?? output['result']
  return inner === undefined ? [] : blocks(inner)
}

function textOf(output: unknown): string {
  if (typeof output === 'string') return output
  return blocks(output)
    .filter((block): block is Record<string, unknown> => isRecord(block))
    .filter((block) => block['type'] === 'text' && typeof block['text'] === 'string')
    .map((block) => block['text'] as string)
    .join('\n')
}

/** Every `Artifact:` line in a text, in order. */
export function artifactsIn(text: string): readonly MediaArtifact[] {
  const found: MediaArtifact[] = []
  for (const match of text.matchAll(ARTIFACT_LINE)) {
    const path = match[1]
    const mimeType = match[2]
    if (path !== undefined && mimeType !== undefined) found.push({ path, mimeType })
  }
  return found
}

export function readMediaCall(call: ToolCallView): MediaCallView | null {
  const kind = mediaKind(call.toolName)
  if (kind === null) return null
  const input = call.input?.present ? call.input.value : null
  const prompt = isRecord(input) && typeof input['prompt'] === 'string' ? input['prompt'] : null
  const answered = call.output?.present ? textOf(call.output.value) : ''
  return {
    kind,
    prompt,
    artifacts: artifactsIn(answered),
    jobId: kind === 'video' ? (JOB_ID.exec(answered)?.[1] ?? null) : null,
  }
}
