/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { present } from '@/platform/harness/contracts/chunks'
import type { ToolCallView } from '@/features/chat/transcript/projection'

import { activitySections } from './ActivityBlock'
import { QuestionAnswers, summaryOf } from './QuestionAnswers'

afterEach(() => {
  cleanup()
})

const QUESTIONS = present({
  questions: [
    {
      header: 'Auth',
      question: 'Which auth approach should we use?',
      options: [{ id: 'cookies', label: 'Session cookies', description: 'Keep it server-side.' }],
    },
    { header: 'Secrets', question: 'Where should secrets live?', options: [] },
  ],
})

function askCall(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    toolCallId: 'ask-1',
    toolName: 'ask_user_question',
    input: QUESTIONS,
    output: null,
    errorText: null,
    ...overrides,
  }
}

/** Opens the row, as a reader does to see each question. */
function open(): void {
  fireEvent.click(screen.getByRole('button'))
}

/**
 * What the person answered stays on the page, where they answered it, as one
 * row that reads the answers at a glance - not behind the activity block's
 * disclosure, where the transcript used to keep it.
 */
describe('the answers in the transcript', () => {
  it('stands on its own, outside the activity block', () => {
    const sections = activitySections([
      { kind: 'tools', id: 'seg', groups: [{ id: 'g', toolName: 'ask_user_question', calls: [askCall()] }] },
    ] as never)
    expect(sections.map((section) => section.kind)).toEqual(['artifact'])
  })

  it('shows each question with the exact answer, chosen or written', () => {
    render(
      <QuestionAnswers
        call={askCall({
          output: present({
            questions: [
              { header: 'Auth', outcome: 'answered', optionIds: ['cookies'], labels: ['Session cookies'] },
              { header: 'Secrets', outcome: 'answered', text: 'In the vault,\nnot the repo' },
            ],
          }),
        })}
      />,
    )
    // At rest: one line, the answers in it, a written one cut at its first line.
    expect(screen.getByText('Answered · Session cookies · In the vault,…')).toBeTruthy()
    expect(screen.queryByText('Which auth approach should we use?')).toBeNull()
    open()
    expect(screen.getByText('Which auth approach should we use?')).toBeTruthy()
    expect(screen.getByText('Session cookies').className).toContain('whitespace-pre-wrap')
    expect(screen.getByText(/not the repo/).textContent).toBe('In the vault,\nnot the repo')
  })

  it('reads the answers as the wire carries them: the result serialised as text', () => {
    // The harness gives the model a tool's result as text, and the projection
    // hands the client that lone text block - a JSON string, not the object.
    render(
      <QuestionAnswers
        call={askCall({
          output: present(JSON.stringify({
            questions: [
              { header: 'Auth', outcome: 'answered', labels: ['Session cookies'] },
              { header: 'Secrets', outcome: 'deferred' },
            ],
            note: 'The person skipped every question marked deferred.',
          })),
        })}
      />,
    )
    expect(screen.getByText('Answered · Session cookies · 1 skipped')).toBeTruthy()
    open()
    expect(screen.getByText('Skipped, left to the agent')).toBeTruthy()
  })

  it('still shows the questions when the answer cannot be read', () => {
    render(<QuestionAnswers call={askCall({ output: present('not json') })} />)
    open()
    expect(screen.getByText('Which auth approach should we use?')).toBeTruthy()
    // The row says Answered, and so does each question's line beneath it.
    expect(screen.getAllByText('Answered')).toHaveLength(3)
  })

  it('says what happened instead of a choice', () => {
    render(
      <QuestionAnswers
        call={askCall({
          output: present({
            questions: [
              { header: 'Auth', outcome: 'deferred' },
              { header: 'Secrets', outcome: 'timed_out' },
            ],
          }),
        })}
      />,
    )
    expect(screen.getByText('Timed out')).toBeTruthy()
    open()
    expect(screen.getByText('Skipped, left to the agent')).toBeTruthy()
    expect(screen.getAllByText('Timed out')).toHaveLength(2)
  })

  it('takes the one row gap below another row, and nothing otherwise', () => {
    const answered = askCall({ output: present({ questions: [{ header: 'Auth', outcome: 'answered', labels: ['Session cookies'] }] }) })
    const { container, rerender } = render(<QuestionAnswers call={answered} />)
    expect(container.firstElementChild?.className ?? '').not.toMatch(/(?:^|\s)m[tby]-/)
    rerender(<QuestionAnswers call={answered} rowBefore />)
    expect(container.firstElementChild?.classList.contains('mt-2')).toBe(true)
  })

  it('shows nothing while the question is still on the card', () => {
    const { container } = render(<QuestionAnswers call={askCall()} />)
    expect(container.textContent).toBe('')
  })

  it('leaves no raw JSON behind', () => {
    render(
      <QuestionAnswers
        call={askCall({
          output: present({ questions: [{ header: 'Auth', outcome: 'answered', labels: ['Session cookies'] }] }),
        })}
      />,
    )
    expect(screen.queryByText(/"outcome"/)).toBeNull()
  })
})

describe('the row line', () => {
  const report = (outcome: string, extra: { labels?: string[]; text?: string } = {}) => ({
    outcome, labels: extra.labels ?? [], text: extra.text ?? null,
  })

  it('reads every answer, choices joined, skips counted at the end', () => {
    expect(summaryOf([
      report('answered', { labels: ['Email'] }),
      report('answered', { labels: ['Rust', 'TypeScript'] }),
      report('deferred'),
    ], false)).toBe('Answered · Email · Rust, TypeScript · 1 skipped')
  })

  it('says what happened when nothing was answered', () => {
    expect(summaryOf([report('deferred'), report('deferred')], false)).toBe('Skipped 2 questions')
    expect(summaryOf([report('deferred')], false)).toBe('Skipped')
    expect(summaryOf([report('stopped')], false)).toBe('Stopped')
    expect(summaryOf(null, true)).toBe('Question not answered')
  })
})
