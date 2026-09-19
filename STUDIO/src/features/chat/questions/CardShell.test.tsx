/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApprovalPrompt } from '@/features/chat/permissions/ApprovalPrompt'
import { QuestionPrompt } from '@/features/chat/questions/QuestionPrompt'
import type { PendingQuestionRecord } from '@/platform/harness'
import type { PermissionQuestion } from '@/domain/permissions/question'

/**
 * The separation the two cards are built on, bound in the render.
 *
 * One shell, two callers - and the shell draws a countdown only when a caller
 * passes it a deadline. The permission caller has no deadline to pass, by the
 * construction of its own props, so no later change to the shell can quietly
 * give a permission a countdown without either the shell's prop changing or
 * this caller changing, and both are caught here.
 */

afterEach(() => {
  // The config does not set `globals: true`, so testing-library's automatic
  // cleanup never registers, and the two cards render text that overlaps.
  cleanup()
})

const approvalQuestion: PermissionQuestion = {
  id: 'approval_1',
  createdAt: 1_000,
  sentence: [{ kind: 'text', text: 'Write ' }, { kind: 'code', text: 'src/app.ts' }, { kind: 'text', text: " in this conversation's workspace." }],
  reason: null,
  lastingScopeId: null,
}

function questionRow(overrides: Partial<PendingQuestionRecord> = {}): PendingQuestionRecord {
  return {
    id: 'question_1',
    conversationId: 'cnv_x',
    createdAt: 1_000,
    expiresAt: null,
    payload: {
      question: 'Which database should this use?',
      header: 'Storage',
      options: [
        { id: 'sqlite', label: 'SQLite (Recommended)', description: 'One file, no setup.' },
        { id: 'postgres', label: 'Postgres', description: 'A server to run.' },
      ],
      multiSelect: false,
      recommendedOptionId: 'sqlite',
    },
    ...overrides,
  }
}

describe('the shared card shell', () => {
  it('draws no countdown for the permission caller, which has no deadline to give', () => {
    const { container } = render(
      <ApprovalPrompt
        questions={[approvalQuestion]}
        answeringId={null}
        onAnswer={vi.fn()}
      />,
    )

    expect(container.querySelector('[data-countdown]')).toBeNull()
    expect(screen.getByText('Allow')).toBeTruthy()
  })

  it('names the kind of question above the sentence, beside the ask mark', () => {
    // The head row is the card's arrangement: what kind of question this is
    // is read first, the sentence second -- the reverse of the old order,
    // where the kind arrived as a muted caption after the sentence it named.
    const { container } = render(
      <ApprovalPrompt
        questions={[approvalQuestion]}
        answeringId={null}
        onAnswer={vi.fn()}
      />,
    )

    const text = container.textContent ?? ''
    expect(text.indexOf('Permission')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('Permission')).toBeLessThan(text.indexOf('Write '))
    expect(container.querySelector('svg.lucide-message-circle-question-mark')).not.toBeNull()
  })

  it('offers Always only when the conversation belongs to a project', () => {
    // "Always" means every conversation in this project. With no project
    // there is nothing beyond this conversation for it to mean, so the rung
    // is not shown rather than shown under a label that promises more.
    const withProject = render(
      <ApprovalPrompt questions={[approvalQuestion]} answeringId={null} onAnswer={vi.fn()} hasProject />,
    )
    expect(withProject.queryByText('Always')).not.toBeNull()
    withProject.unmount()

    const without = render(
      <ApprovalPrompt questions={[approvalQuestion]} answeringId={null} onAnswer={vi.fn()} hasProject={false} />,
    )
    expect(without.queryByText('Always')).toBeNull()
    expect(without.queryByText('This conversation')).not.toBeNull()
  })

  it('arrives on the house entrance rather than popping in', () => {
    const { container } = render(
      <ApprovalPrompt
        questions={[approvalQuestion]}
        answeringId={null}
        onAnswer={vi.fn()}
      />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.style.opacity).toBe('0')
  })
})

describe('the ask card', () => {
  it('draws a countdown only when the question actually has a deadline', () => {
    const { container: withoutDeadline } = render(
      <QuestionPrompt
        rows={[questionRow()]}
        answeringId={null}
        onAnswer={vi.fn()}
        onStop={vi.fn()}
      />,
    )
    expect(withoutDeadline.querySelector('[data-countdown]')).toBeNull()

    const { container: withDeadline } = render(
      <QuestionPrompt
        rows={[questionRow({ expiresAt: Date.now() + 90_000 })]}
        answeringId={null}
        onAnswer={vi.fn()}
        onStop={vi.fn()}
      />,
    )
    expect(withDeadline.querySelector('[data-countdown]')).not.toBeNull()
  })

  it('names the questions waiting beneath the active one', () => {
    render(
      <QuestionPrompt
        rows={[
          questionRow(),
          questionRow({ id: 'question_2', createdAt: 2_000, payload: { ...questionRow().payload, header: 'Style' } }),
        ]}
        answeringId={null}
        onAnswer={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    expect(screen.getByText('Which database should this use?')).toBeTruthy()
    const waiting = screen.getByText(/Also waiting, one at a time:/)
    expect(waiting.textContent).toContain('Style')
  })

  it('commits a chosen option and says what was chosen', async () => {
    vi.useFakeTimers()
    const onAnswer = vi.fn(async () => undefined)
    render(
      <QuestionPrompt rows={[questionRow()]} answeringId={null} onAnswer={onAnswer} onStop={vi.fn()} />,
    )

    // A beat first: the choice is seen before the card advances.
    fireEvent.click(screen.getByText('Postgres'))
    expect(onAnswer).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(320)

    expect(onAnswer).toHaveBeenCalledWith('question_1', { optionIds: ['postgres'] })
    vi.useRealTimers()
  })

  it('commits a written answer, which the model never declared', async () => {
    const onAnswer = vi.fn(async () => undefined)
    render(
      <QuestionPrompt rows={[questionRow()]} answeringId={null} onAnswer={onAnswer} onStop={vi.fn()} />,
    )

    const input = screen.getByLabelText('Your own answer')
    fireEvent.change(input, { target: { value: 'Bun with SQLite baked in.' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith('question_1', { text: 'Bun with SQLite baked in.' }),
    )
  })

  it('defers with its own labelled control, distinct from stopping', () => {
    const onAnswer = vi.fn(async () => undefined)
    const onStop = vi.fn()
    render(
      <QuestionPrompt rows={[questionRow()]} answeringId={null} onAnswer={onAnswer} onStop={onStop} />,
    )

    fireEvent.click(screen.getByText('You decide'))
    expect(onAnswer).toHaveBeenCalledWith('question_1', { deferred: true })
    expect(onStop).not.toHaveBeenCalled()
  })

  it('stops the run with its own labelled control, distinct from deferring', () => {
    const onAnswer = vi.fn(async () => undefined)
    const onStop = vi.fn()
    render(
      <QuestionPrompt rows={[questionRow()]} answeringId={null} onAnswer={onAnswer} onStop={onStop} />,
    )

    fireEvent.click(screen.getByText('Stop'))
    expect(onStop).toHaveBeenCalled()
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('commits several choices on a multiSelect question through its continue control', async () => {
    const onAnswer = vi.fn(async () => undefined)
    render(
      <QuestionPrompt
        rows={[
          questionRow({
            payload: {
              ...questionRow().payload,
              multiSelect: true,
              recommendedOptionId: null,
            },
          }),
        ]}
        answeringId={null}
        onAnswer={onAnswer}
        onStop={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('SQLite (Recommended)'))
    fireEvent.click(screen.getByText('Postgres'))
    fireEvent.click(screen.getByText('Submit'))

    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith('question_1', { optionIds: ['sqlite', 'postgres'] }),
    )
  })

  it('offers no ambiguous dismissal: nothing closes the card but an answer', () => {
    const onAnswer = vi.fn(async () => undefined)
    const { container } = render(
      <QuestionPrompt rows={[questionRow()]} answeringId={null} onAnswer={onAnswer} onStop={vi.fn()} />,
    )

    fireEvent.keyDown(container.firstElementChild as HTMLElement, { key: 'Escape' })
    // A click outside has no listener to reach: the card is not a dialog.
    fireEvent.click(document.body)
    expect(onAnswer).not.toHaveBeenCalled()
  })
})
