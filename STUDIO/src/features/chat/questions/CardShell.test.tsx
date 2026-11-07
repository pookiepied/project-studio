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

/** The card itself, inside the frame that stands where the composer was. */
function cardIn(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-prompt-card]') as HTMLElement
}

afterEach(() => {
  // The config does not set `globals: true`, so testing-library's automatic
  // cleanup never registers, and the two cards render text that overlaps.
  cleanup()
})

const approvalQuestion: PermissionQuestion = {
  id: 'approval_1',
  createdAt: 1_000,
  agentId: null,
  sentence: [{ kind: 'text', text: 'Write ' }, { kind: 'code', text: 'src/app.ts' }, { kind: 'text', text: " in this conversation's workspace." }],
  reason: null,
  lastingScopeId: null,
  maxDuration: 'always',
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
    expect(screen.getByText('Allow once')).toBeTruthy()
  })

  it('names the kind of question in the hint row, above the sentence, with no mark', () => {
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
    // The hint row is words and keys only, as the reference's panel is.
    expect(container.querySelector('svg.studio-mark-ask')).toBeNull()
  })

  it('offers Always only when the conversation belongs to a project', () => {
    // "Always" means every conversation in this project. With no project
    // there is nothing beyond this conversation for it to mean, so the rung
    // is not shown rather than shown under a label that promises more.
    const withProject = render(
      <ApprovalPrompt questions={[approvalQuestion]} answeringId={null} onAnswer={vi.fn()} hasProject />,
    )
    expect(withProject.queryByText('Always allow in this project')).not.toBeNull()
    withProject.unmount()

    const without = render(
      <ApprovalPrompt questions={[approvalQuestion]} answeringId={null} onAnswer={vi.fn()} hasProject={false} />,
    )
    expect(without.queryByText('Always allow in this project')).toBeNull()
    expect(without.queryByText('Allow for this conversation')).not.toBeNull()
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

describe('answer rows', () => {
  it('lights the narrowest grant first, so Enter on the card allows once', () => {
    const onAnswer = vi.fn(async () => undefined)
    const { container } = render(
      <ApprovalPrompt questions={[approvalQuestion]} answeringId={null} onAnswer={onAnswer} hasProject />,
    )

    const first = screen.getByText('Allow once').closest('[data-card-row]') as HTMLElement
    expect(first.className).toContain('bg-soft')
    fireEvent.keyDown(cardIn(container), { key: 'Enter' })
    expect(onAnswer).toHaveBeenCalledWith('approval_1', { verdict: 'allow', duration: 'once' })
  })

  it('answers a wider grant from its own row, against the offered folder', () => {
    const onAnswer = vi.fn(async () => undefined)
    render(
      <ApprovalPrompt
        questions={[{ ...approvalQuestion, lastingScopeId: 'this-folder' }]}
        answeringId={null}
        onAnswer={onAnswer}
        hasProject
      />,
    )

    // The row says what it stores before it is clicked: pointing at it lights
    // it, and the lit row's consequence shows beneath the rows.
    expect(screen.queryByText(/stops asking about this folder in every conversation/)).toBeNull()
    fireEvent.mouseEnter(screen.getByText('Always allow in this project').closest('[data-card-row]') as HTMLElement)
    expect(screen.getByText(/stops asking about this folder in every conversation/)).toBeTruthy()
    fireEvent.click(screen.getByText('Always allow in this project'))
    expect(onAnswer).toHaveBeenCalledWith('approval_1', { verdict: 'allow', duration: 'always', scopeId: 'this-folder' })
  })

  it('denies once, storing nothing', () => {
    const onAnswer = vi.fn(async () => undefined)
    render(
      <ApprovalPrompt
        questions={[{ ...approvalQuestion, lastingScopeId: 'this-folder' }]}
        answeringId={null}
        onAnswer={onAnswer}
        hasProject
      />,
    )

    fireEvent.click(screen.getByText('Deny'))
    expect(onAnswer).toHaveBeenCalledWith('approval_1', { verdict: 'deny', duration: 'once' })
  })

  it('moves the highlight with the arrow keys, and Enter answers with the row it lands on', () => {
    const onAnswer = vi.fn(async () => undefined)
    const { container } = render(
      <ApprovalPrompt questions={[approvalQuestion]} answeringId={null} onAnswer={onAnswer} hasProject />,
    )
    const card = cardIn(container)

    fireEvent.keyDown(card, { key: 'ArrowDown' })
    const second = screen.getByText('Allow for this conversation').closest('[data-card-row]') as HTMLElement
    expect(document.activeElement).toBe(second)
    expect(second.className).toContain('bg-soft')

    // Up from the first row wraps to the last.
    fireEvent.keyDown(card, { key: 'ArrowUp' })
    fireEvent.keyDown(card, { key: 'ArrowUp' })
    const last = screen.getByText('Deny').closest('[data-card-row]') as HTMLElement
    expect(document.activeElement).toBe(last)

    fireEvent.keyDown(last, { key: 'Enter' })
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer).toHaveBeenCalledWith('approval_1', { verdict: 'deny', duration: 'once' })
  })

  it("carries the composer's stop, since the composer is gone while it waits", () => {
    const onAnswer = vi.fn(async () => undefined)
    const onStop = vi.fn()
    render(
      <ApprovalPrompt questions={[approvalQuestion]} answeringId={null} onAnswer={onAnswer} onStop={onStop} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Stop the run' }))
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('offers no Escape: the key leaves a permission unanswered', () => {
    const onAnswer = vi.fn(async () => undefined)
    const { container } = render(
      <ApprovalPrompt questions={[approvalQuestion]} answeringId={null} onAnswer={onAnswer} />,
    )
    fireEvent.keyDown(cardIn(container), { key: 'Escape' })
    expect(onAnswer).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('esc')
  })
})

describe('the ask card', () => {
  it('lights the recommended option on arrival without choosing it', () => {
    const onAnswer = vi.fn(async () => undefined)
    render(
      <QuestionPrompt rows={[questionRow()]} answeringId={null} onAnswer={onAnswer} onStop={vi.fn()} />,
    )
    const row = screen.getByText('SQLite (Recommended)').closest('[data-card-row]') as HTMLElement
    expect(row.className).toContain('bg-soft')
    expect(row.getAttribute('aria-checked')).toBe('false')
    expect(onAnswer).not.toHaveBeenCalled()
  })

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

  it('says where a question stands in its call, and holds the count as they are answered', () => {
    const second = questionRow({ id: 'question_2', createdAt: 2_000, payload: { ...questionRow().payload, header: 'Style' } })
    const { rerender } = render(
      <QuestionPrompt rows={[questionRow(), second]} answeringId={null} onAnswer={vi.fn()} onStop={vi.fn()} />,
    )
    expect(screen.getByLabelText('Question 1 of 2')).toBeTruthy()

    // The first is answered: the pending list now holds only the second.
    rerender(<QuestionPrompt rows={[second]} answeringId={null} onAnswer={vi.fn()} onStop={vi.fn()} />)
    expect(screen.getByLabelText('Question 2 of 2')).toBeTruthy()
  })

  it('says nothing about position for a lone question', () => {
    render(<QuestionPrompt rows={[questionRow()]} answeringId={null} onAnswer={vi.fn()} onStop={vi.fn()} />)
    expect(screen.queryByLabelText(/Question \d of/)).toBeNull()
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
    // Shift Enter breaks the line, as in the composer; Enter sends.
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onAnswer).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith('question_1', { text: 'Bun with SQLite baked in.' }),
    )
  })

  it('keeps the arrows for the caret while writing', () => {
    render(<QuestionPrompt rows={[questionRow()]} answeringId={null} onAnswer={vi.fn()} onStop={vi.fn()} />)
    const input = screen.getByLabelText('Your own answer')
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(input)
  })

  it('skips with its own labelled control, distinct from stopping', () => {
    const onAnswer = vi.fn(async () => undefined)
    const onStop = vi.fn()
    render(
      <QuestionPrompt rows={[questionRow()]} answeringId={null} onAnswer={onAnswer} onStop={onStop} />,
    )

    fireEvent.click(screen.getByText('Skip'))
    expect(onAnswer).toHaveBeenCalledWith('question_1', { deferred: true })
    expect(onStop).not.toHaveBeenCalled()
  })

  it('stops the run from the round button while nothing is written, as the composer does', () => {
    const onAnswer = vi.fn(async () => undefined)
    const onStop = vi.fn()
    render(
      <QuestionPrompt rows={[questionRow()]} answeringId={null} onAnswer={onAnswer} onStop={onStop} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Stop the run' }))
    expect(onStop).toHaveBeenCalled()
    expect(onAnswer).not.toHaveBeenCalled()

    // Once words are written the same button sends them instead.
    fireEvent.change(screen.getByLabelText('Your own answer'), { target: { value: 'Neither' } })
    expect(screen.queryByRole('button', { name: 'Stop the run' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }))
    expect(onAnswer).toHaveBeenCalledWith('question_1', { text: 'Neither' })
  })

  it('commits several choices on a multiSelect question through the send button', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Send choices' }))

    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith('question_1', { optionIds: ['sqlite', 'postgres'] }),
    )
  })

  it('offers no ambiguous dismissal: nothing closes the card but an answer', () => {
    const onAnswer = vi.fn(async () => undefined)
    const { container } = render(
      <QuestionPrompt rows={[questionRow()]} answeringId={null} onAnswer={onAnswer} onStop={vi.fn()} />,
    )

    fireEvent.keyDown(cardIn(container), { key: 'Escape' })
    // A click outside has no listener to reach: the card is not a dialog.
    fireEvent.click(document.body)
    expect(onAnswer).not.toHaveBeenCalled()
  })
})
