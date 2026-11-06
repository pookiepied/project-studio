/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PageTransition } from './PageTransition'

afterEach(cleanup)

it('mounts the incoming page immediately and keeps the exit visible but inert', async () => {
  const { rerender } = render(
    <PageTransition view="chat" main><button type="button">Send message</button></PageTransition>,
  )
  const chat = screen.getByRole('main')
  rerender(
    <PageTransition view="settings" move="push" main><button type="button">Change theme</button></PageTransition>,
  )
  expect(screen.getByRole('button', { name: 'Change theme' })).toBeTruthy()
  expect(chat.isConnected).toBe(true)
  expect(chat.hasAttribute('inert')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull()
  await waitFor(() => expect(chat.isConnected).toBe(false))
})

it('keeps a settled settings page in place when only the section changes', async () => {
  const { rerender } = render(<PageTransition view="chat" main>Chat</PageTransition>)
  rerender(<PageTransition view="settings" move="push" main>Models</PageTransition>)
  const settings = screen.getByRole('main')
  await waitFor(() => expect(settings.style.transform).toBe('none'))
  rerender(<PageTransition view="settings" move="sibling" main>Appearance</PageTransition>)
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  })
  expect(screen.getByRole('main')).toBe(settings)
  expect(settings.style.transform).toBe('none')
})
