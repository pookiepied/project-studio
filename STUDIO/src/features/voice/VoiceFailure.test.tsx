/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VoiceFailure } from './VoiceFailure'
import { DictationBar } from './DictationBar'

afterEach(cleanup)

describe('bounded voice failure details', () => {
  it('keeps long provider text out of the row and opens bounded, wrapping details', () => {
    const note = `OpenRouter refused: ${'unbroken-provider-detail'.repeat(100)}`
    const { container } = render(<VoiceFailure label="Read-aloud failed" note={note} />)
    expect(container.textContent).not.toContain(note)
    expect(screen.getByRole('status').textContent).toBe('Read-aloud failed')
    fireEvent.click(screen.getByRole('button', { name: 'Read-aloud failed details' }))
    const details = screen.getByText(note)
    expect(details.className).toContain('overflow-y-auto')
    expect(details.className).toContain('[overflow-wrap:anywhere]')
    expect(container.contains(details)).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Read-aloud failed details' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('uses the same compact details control for dictation failures', () => {
    render(<DictationBar stage="blocked" elapsedMs={0} denied={false} note="Detailed transcription refusal" onFrame={() => () => {}} />)
    expect(screen.queryByText('Detailed transcription refusal')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dictation failed details' }))
    expect(screen.getByText('Detailed transcription refusal')).toBeTruthy()
  })
})
