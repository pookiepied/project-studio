/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ServerDialog } from './ServerDialog'
import type { McpServerDraft, McpServerRecord } from '@/platform/harness'

afterEach(cleanup)

const CANARY = 'sk-CANARY-DO-NOT-PERSIST'

function open(overrides: Partial<Parameters<typeof ServerDialog>[0]> = {}) {
  const saved: McpServerDraft[] = []
  const credentials: { id: string; secret: string }[] = []
  const onClose = vi.fn()

  render(
    <ServerDialog
      open
      editing={null}
      onClose={onClose}
      onSave={async (draft) => {
        saved.push(draft)
        return null
      }}
      onSaveCredential={async (id, secret) => {
        credentials.push({ id, secret })
        return null
      }}
      {...overrides}
    />,
  )
  return { saved, credentials, onClose }
}

function type(label: string, value: string) {
  const field = screen.getByLabelText(label)
  fireEvent.change(field, { target: { value } })
}

/**
 * A control's current value.
 *
 * Read from the element rather than an attribute: React reflects an input's
 * value into the attribute but a textarea's into the property only, so
 * `getAttribute('value')` silently returns null for the JSON view. Narrowed
 * with `instanceof` because this codebase does not take casts.
 */
function valueOf(element: HTMLElement): string {
  if (element instanceof HTMLInputElement) return element.value
  if (element instanceof HTMLTextAreaElement) return element.value
  throw new Error('That element does not hold a value.')
}

describe('adding a server', () => {
  it('will not save until the form says what is wrong', () => {
    open()
    const add = screen.getByRole('button', { name: 'Add server' })
    expect(add.hasAttribute('disabled')).toBe(true)
    // The first complaint only, not a list about a form nobody has filled in.
    expect(screen.getByText('Give the server an id.')).toBeTruthy()
  })

  it('sends the command as a vector, never a string', async () => {
    const { saved } = open()
    type('Name', 'Memory')
    type('Id', 'memory')
    type('Command', 'node')
    type('Arguments', '--root "D:\\My Projects\\site" -y')

    fireEvent.click(screen.getByRole('button', { name: 'Add server' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.args).toEqual(['--root', 'D:\\My Projects\\site', '-y'])
    expect(typeof saved[0]?.command).toBe('string')
  })

  it('shows the http fields instead of the local ones', () => {
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'HTTP' }))

    expect(screen.getByLabelText('Address')).toBeTruthy()
    expect(screen.queryByLabelText('Command')).toBeNull()
    expect(screen.queryByLabelText('Environment')).toBeNull()
  })

  it('offers only the two transports the harness implements', () => {
    open()
    const transports = screen
      .getAllByRole('radio')
      .map((entry) => entry.textContent)
      .filter((label) => label === 'Local command' || label === 'HTTP' || label === 'SSE')
    expect(transports).toEqual(['Local command', 'HTTP'])
  })

  it('asks for a header name only for the header kind', () => {
    open()
    expect(screen.queryByLabelText('Header name')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Header' }))
    expect(screen.getByLabelText('Header name')).toBeTruthy()
  })
})

describe('the secret', () => {
  it('goes in its own call and never into the record', async () => {
    const { saved, credentials } = open()
    type('Name', 'Remote')
    type('Id', 'remote')
    fireEvent.click(screen.getByRole('radio', { name: 'HTTP' }))
    type('Address', 'https://example.com/mcp')
    fireEvent.click(screen.getByRole('radio', { name: 'Bearer' }))
    type('Secret', CANARY)

    fireEvent.click(screen.getByRole('button', { name: 'Add server' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    // The record the harness stores cannot carry it, in any field, at any
    // depth. This is the assertion the whole design exists to make passable.
    expect(JSON.stringify(saved[0])).not.toContain(CANARY)
    // It travelled, once, by the route built for it.
    expect(credentials).toEqual([{ id: 'remote', secret: CANARY }])
  })

  it('is masked while it is on screen', () => {
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'Bearer' }))
    expect(screen.getByLabelText('Secret').getAttribute('type')).toBe('password')
  })

  it('is not printed in the JSON view', () => {
    open()
    type('Name', 'Remote')
    type('Id', 'remote')
    fireEvent.click(screen.getByRole('radio', { name: 'Bearer' }))
    type('Secret', CANARY)
    fireEvent.click(screen.getByRole('radio', { name: 'JSON' }))

    // The JSON view shows the draft, and the draft has no field a secret
    // could live in. That is what makes showing it safe at all.
    expect(document.body.textContent).not.toContain(CANARY)
  })
})

describe('the JSON view', () => {
  it('shows what will actually be sent', () => {
    open()
    type('Name', 'Memory')
    type('Id', 'memory')
    type('Command', 'node')
    type('Arguments', '-y server-memory')
    fireEvent.click(screen.getByRole('radio', { name: 'JSON' }))

    const text = valueOf(screen.getByRole('textbox'))
    const parsed: unknown = JSON.parse(text)
    expect(parsed).toMatchObject({
      id: 'memory',
      transport: 'stdio',
      args: ['-y', 'server-memory'],
    })
  })

  it('keeps you in the view when the JSON will not parse, with the reason', () => {
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'JSON' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{not json' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Form' }))

    // Discarding an unparseable edit silently is how someone loses work they
    // can still see on the screen.
    expect(screen.getByText('That is not valid JSON.')).toBeTruthy()
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('carries an edit made in JSON back to the form', () => {
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'JSON' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: '{"id":"pasted","title":"Pasted","command":"node","args":["-y","server-memory"]}',
      },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Form' }))

    expect(valueOf(screen.getByLabelText('Id'))).toBe('pasted')
    expect(valueOf(screen.getByLabelText('Arguments'))).toBe('-y server-memory')
  })
})

describe('editing an installed server', () => {
  const RECORD: McpServerRecord = {
    id: 'memory',
    title: 'Memory',
    description: 'Remembers things between conversations.',
    provenance: 'user',
    transport: 'stdio',
    command: 'node',
    args: ['-y', 'server-memory'],
    env: { LOG: 'info' },
    auth: 'none',
    needsNetwork: true,
    enabledByDefault: true,
  }

  it('opens filled in, and saving without changing anything sends the same server', async () => {
    const { saved } = open({ editing: RECORD })
    expect(valueOf(screen.getByLabelText('Id'))).toBe('memory')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({
      id: 'memory',
      command: 'node',
      args: ['-y', 'server-memory'],
      env: { LOG: 'info' },
    })
  })

  it('does not send a credential when the secret was left blank', async () => {
    const { saved, credentials } = open({
      editing: { ...RECORD, auth: 'bearer' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    // Blank means "keep the stored one", so nothing may be written - sending
    // an empty string here would erase a working key.
    expect(credentials).toEqual([])
  })
})
