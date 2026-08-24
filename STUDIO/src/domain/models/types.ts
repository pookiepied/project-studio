import type { ProviderId } from '@/components/icons'

/**
 * What a model can be asked to do.
 *
 * Capabilities are declared rather than inferred from the slug, because the
 * composer disables controls from them — a picker that offers vision to a
 * text-only model is a failure the user only discovers after sending.
 */
type Capability = 'text' | 'vision' | 'tools' | 'reasoning'

export interface Model {
  readonly id: string
  readonly providerId: ProviderId
  /** What the user sees. */
  readonly name: string
  /** What the API is called, and what a custom provider asks for. */
  readonly slug: string
  readonly capabilities: readonly Capability[]
  /** One line, shown under the name. Says what it is for, not what it is. */
  readonly note: string
  /**
   * Tokens the model can hold. Declared per model rather than assumed, because
   * the meter is meaningless if every model is measured against one number.
   */
  readonly contextWindow: number
}

export interface Provider {
  readonly id: ProviderId
  readonly name: string
  /** Which wire format the endpoint speaks. */
  readonly compatibility: Compatibility
  /** Absent for the built-ins, set when someone adds their own endpoint. */
  readonly baseUrl?: string
  readonly custom: boolean
}

/**
 * The wire formats a custom provider may declare.
 *
 * Four, because these are the four the harness can actually speak. Offering a
 * fifth in the UI would be offering a choice that fails at the first request.
 */
export const COMPATIBILITIES = [
  { id: 'openai-chat', name: 'OpenAI (chat completions)' },
  { id: 'openai-responses', name: 'OpenAI (responses)' },
  { id: 'anthropic', name: 'Anthropic (messages)' },
  { id: 'google', name: 'Google (generateContent)' },
] as const

export type Compatibility = (typeof COMPATIBILITIES)[number]['id']

/**
 * Reasoning effort.
 *
 * Steps, not a slider. A continuous control implies a precision the underlying
 * setting does not have and invites fiddling with a number nobody can evaluate.
 */
export type Effort = 'minimal' | 'low' | 'medium' | 'high' | 'max'

export const EFFORTS: readonly { id: Effort; name: string; note: string }[] = [
  { id: 'minimal', name: 'Minimal', note: 'Answer straight away.' },
  { id: 'low', name: 'Low', note: 'A moment of thought.' },
  { id: 'medium', name: 'Medium', note: 'The everyday balance.' },
  { id: 'high', name: 'High', note: 'Work the problem through.' },
  { id: 'max', name: 'Max', note: 'Take as long as it needs.' },
]
