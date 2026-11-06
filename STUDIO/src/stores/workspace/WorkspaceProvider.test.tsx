/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { clientObservations } from '@/platform/diagnostics/events'
import { loadDefaultPermission } from '@/platform/execution-preference'
import { WorkspaceProvider, useWorkspace } from './WorkspaceProvider'

function PermissionChoices() {
  const { settings, setDefaultPermission, setConversationPermission } = useWorkspace()
  return (
    <>
      <output aria-label="Default mode">{settings.permission}</output>
      <button onClick={() => void setDefaultPermission('auto')}>Save Auto for new chats</button>
      <button onClick={() => setConversationPermission('cnv_existing', 'ask')}>Ask in this chat</button>
    </>
  )
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  clientObservations.configure(null)
  vi.unstubAllGlobals()
})

it('restores the saved default without copying a conversation choice into it', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline fixture')))
  clientObservations.configure('test-capture')
  const first = render(<WorkspaceProvider><PermissionChoices /></WorkspaceProvider>)

  fireEvent.click(screen.getByRole('button', { name: 'Save Auto for new chats' }))
  await screen.findByText('auto')
  first.unmount()

  const initialPermission = await loadDefaultPermission()
  render(<WorkspaceProvider initialPermission={initialPermission}><PermissionChoices /></WorkspaceProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Ask in this chat' }))

  expect(screen.getByLabelText('Default mode').textContent).toBe('auto')
  expect(await loadDefaultPermission()).toBe('auto')
  expect(clientObservations.take()?.events.filter((event) => event.name === 'client.window')).toEqual([
    expect.objectContaining({ identity: {}, attributes: { stage: 'execution_default_save_requested' } }),
  ])
})
