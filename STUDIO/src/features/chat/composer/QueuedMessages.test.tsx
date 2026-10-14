// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueuedMessages } from './QueuedMessages'

afterEach(cleanup)

it('provides steer, delete, and an edit menu for each queued message', () => {
  const message = { submissionId: 'queued_1', text: 'ROADMAP', images: [] }
  const onAction = vi.fn()
  render(<QueuedMessages messages={[message]} disabled={false} onAction={onAction} />)
  expect(screen.getByText('ROADMAP')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Steer' }))
  expect(onAction).toHaveBeenLastCalledWith(message, 'steer')
  fireEvent.click(screen.getByRole('button', { name: 'Delete queued message' }))
  expect(onAction).toHaveBeenLastCalledWith(message, 'remove')
  fireEvent.click(screen.getByRole('button', { name: 'Queued message options' }))
  fireEvent.click(screen.getByText('Edit message'))
  expect(onAction).toHaveBeenLastCalledWith(message, 'edit')
})
