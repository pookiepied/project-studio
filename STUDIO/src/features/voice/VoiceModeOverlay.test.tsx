/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { VoiceModeOverlay } from './VoiceModeOverlay'
import { playCue } from './callSounds'

const session = {
  stage: 'listening' as string,
  elapsedMs: 0,
  turn: 0,
  spoken: [] as string[],
  denied: false,
  note: '',
  muted: false,
  deafened: false,
  toggleMute: vi.fn(),
  toggleDeafen: vi.fn(),
  stopListening: vi.fn(),
  interrupt: vi.fn(),
  retry: vi.fn(),
  mic: { onFrame: () => () => {} },
}
let questions: unknown[] = []
let workers: unknown[] = []
// Off and unavailable, as in a browser tab, unless a test says otherwise.
const screenShare = {
  available: false, sharing: false, showing: false, pending: false, note: '',
  toggle: vi.fn(), showMe: vi.fn(), onSpeechEnd: vi.fn(),
}

vi.mock('@/features/screen/useScreenShare', () => ({ useScreenShare: () => screenShare }))

vi.mock('@/features/voice/useVoiceMode', () => ({ useVoiceSession: () => session }))
vi.mock('@/features/chat/permissions/usePendingApprovals', () => ({
  usePendingApprovals: () => ({ questions, answeringId: null, answeredElsewhere: null, answer: vi.fn(), cancelAll: vi.fn() }),
}))
vi.mock('@/features/chat/permissions/ApprovalPrompt', () => ({ ApprovalPrompt: () => <div>approval card</div> }))
vi.mock('./callSounds', () => ({ playCue: vi.fn() }))
vi.mock('./CallParticipants', async () => {
  const { participantProfiles } = await import('./participants')
  return {
    useCallParticipants: () => ({ participants: workers, profiles: participantProfiles((workers as { id: string }[]).map((w) => w.id)), unavailable: false }),
    ParticipantStack: () => <div>agent faces</div>,
  }
})
window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia

function stage(props: Partial<Parameters<typeof VoiceModeOverlay>[0]> = {}) {
  return render(<VoiceModeOverlay open conversationId="cnv_1" onClose={() => {}} onMinimize={() => {}} {...props} />)
}

describe('VoiceModeOverlay', () => {
  afterEach(() => {
    cleanup(); vi.clearAllMocks(); questions = []; workers = []
    Object.assign(screenShare, { available: false, sharing: false, showing: false, note: '' })
  })

  it('wraps the call switches in the screen pair on the desktop, and says when the screen is shared', () => {
    Object.assign(session, { stage: 'listening', muted: false, deafened: false })
    Object.assign(screenShare, { available: true, sharing: false })
    const { rerender } = stage()
    const bar = screen.getByRole('toolbar', { name: 'Call controls' })
    const labels = [...bar.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))
    expect(labels).toEqual(['Share your screen', 'Mute microphone', 'Interrupt', 'Deafen', 'Share your screen to draw on it'])
    expect(screen.getByRole('button', { name: 'Share your screen to draw on it' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Share your screen' }))
    expect(screenShare.toggle).toHaveBeenCalled()
    Object.assign(screenShare, { sharing: true })
    rerender(<VoiceModeOverlay open conversationId="cnv_1" onClose={() => {}} />)
    expect(screen.getByRole('status').textContent).toContain('Sharing your screen')
    fireEvent.click(screen.getByRole('button', { name: 'Show me: draw on your screen' }))
    expect(screenShare.showMe).toHaveBeenCalled()
  })

  it('names the voice Studio and plays the join cue', () => {
    Object.assign(session, { stage: 'listening', muted: false, deafened: false })
    stage()
    expect(screen.getByText('Studio')).toBeTruthy()
    expect(playCue).toHaveBeenCalledWith('join')
  })

  it('only interrupts while Studio thinks or speaks', () => {
    Object.assign(session, { stage: 'listening', spoken: [] })
    const { rerender } = stage()
    expect(screen.getByRole('button', { name: 'Interrupt' }).hasAttribute('disabled')).toBe(true)
    Object.assign(session, { stage: 'speaking', spoken: ['Hello,', ' ', 'world.'] })
    rerender(<VoiceModeOverlay open conversationId="cnv_1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }))
    expect(session.interrupt).toHaveBeenCalled()
    expect(playCue).toHaveBeenCalledTimes(1)
  })

  it('mutes and deafens with their cues, from one control bar', () => {
    Object.assign(session, { stage: 'listening', muted: false, deafened: false })
    stage()
    const bar = screen.getByRole('toolbar', { name: 'Call controls' })
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }))
    expect(session.toggleMute).toHaveBeenCalled()
    expect(playCue).toHaveBeenCalledWith('mute')
    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }))
    expect(session.toggleDeafen).toHaveBeenCalled()
    expect(playCue).toHaveBeenCalledWith('deafen')
    expect(bar.querySelectorAll('button').length).toBe(3)
  })

  it('says muted and deafened in the state line', () => {
    Object.assign(session, { stage: 'listening', spoken: [], muted: true, deafened: true })
    stage()
    expect(screen.getByText('Muted')).toBeTruthy()
    expect(screen.getByText(/Deafened/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unmute microphone' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Undeafen' })).toBeTruthy()
  })

  it('keeps listening after a missed take and says what was missed', () => {
    Object.assign(session, { stage: 'listening', spoken: [], muted: false, deafened: false, note: 'Missed that. The transcription service is busy right now, so say it again in a moment.' })
    stage()
    expect(screen.getByText(/transcription service is busy/)).toBeTruthy()
    expect(screen.getByRole('toolbar', { name: 'Call controls' })).toBeTruthy()
    Object.assign(session, { note: '' })
  })

  it('shows the agents as faces beside Studio, with no expanding', () => {
    Object.assign(session, { stage: 'thinking', muted: false, deafened: false })
    workers = [{ id: 'voice_1', agentName: 'voice-work', stage: 'working', updatedAt: 0, createdAt: 0 }]
    stage()
    expect(screen.getByText('agent faces')).toBeTruthy()
    expect(screen.getByText('An agent on the call')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /on the call/ })).toBeNull()
  })

  it('says Listening while Studio is held for the person talking over it', () => {
    Object.assign(session, { stage: 'speaking', spoken: ['Hello.'], muted: false, deafened: false, holding: true })
    stage()
    expect(screen.getByText('Listening')).toBeTruthy()
    Object.assign(session, { holding: false })
  })

  it('asks pending approvals on the stage, and points to them from the corner player', async () => {
    Object.assign(session, { stage: 'thinking', muted: false, deafened: false })
    questions = [{ id: 'apr_1' }]
    const onRestore = vi.fn()
    const { rerender } = stage()
    expect(screen.getByText('approval card')).toBeTruthy()
    rerender(<VoiceModeOverlay open minimized conversationId="cnv_1" onClose={() => {}} onRestore={onRestore} insetRight={420} />)
    const player = screen.getByRole('region', { name: 'Voice call' })
    expect(player.style.right).toBe('436px')
    // The full stage plays its exit, then leaves: the page is usable underneath.
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    fireEvent.click(screen.getByText(/agent is waiting for your approval/))
    expect(onRestore).toHaveBeenCalled()
  })
})
