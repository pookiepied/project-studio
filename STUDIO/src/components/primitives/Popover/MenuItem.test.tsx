/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MenuItem } from './MenuItem'

afterEach(cleanup)

it('uses distinct resting treatments for a chosen model and its adjacent browse action', () => {
  const onSelect = vi.fn()
  const { rerender } = render(
    <>
      <MenuItem expanded={false} onSelect={onSelect}>More models</MenuItem>
      <MenuItem selected onSelect={onSelect}>Selected model</MenuItem>
    </>,
  )
  const browse = screen.getByRole('menuitem', { name: 'More models' })
  const selected = screen.getByRole('menuitemradio', { name: 'Selected model' })
  expect(browse.classList.contains('enabled:hover:bg-tint')).toBe(true)
  expect(selected.classList.contains('bg-selected')).toBe(true)
  expect(selected.classList.contains('enabled:hover:bg-tint')).toBe(false)

  rerender(
    <>
      <MenuItem expanded onSelect={onSelect}>More models</MenuItem>
      <MenuItem selected onSelect={onSelect}>Selected model</MenuItem>
    </>,
  )
  expect(browse.getAttribute('aria-expanded')).toBe('true')
  expect(browse.classList.contains('ring-inset')).toBe(true)
  expect(browse.classList.contains('bg-selected')).toBe(false)
  expect(browse.classList.contains('enabled:hover:bg-tint')).toBe(false)
  expect(selected.classList.contains('bg-selected')).toBe(true)
})
