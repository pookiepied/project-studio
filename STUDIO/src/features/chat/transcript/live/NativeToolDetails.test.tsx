/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { present } from '@/platform/harness/contracts/chunks'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { ActivityBlock } from './ActivityBlock'
import { ToolGroups } from './ToolGroups'
import { discoveryEntries } from './NativeToolDetails'
import { resultState } from './toolResult'

afterEach(cleanup)

function call(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return { toolCallId: 'a', toolName: 'shell', input: present({ command: 'pnpm test' }), output: null, errorText: null, ...overrides }
}

function expand(value: ToolCallView) {
  const view = render(<ToolGroups conversationId="test" groups={[{ id: 'a', file: null, calls: [value] }]} />)
  fireEvent.click(screen.getByRole('button'))
  return view
}

describe('purpose-built tool reports', () => {
  it('reports the native Git failure receipt as failed at both presentation levels', () => {
    const value = call({ toolName: 'git', input: present({ subcommand: 'checkout', args: ['missing'] }),
      output: present('git checkout exited with code 128.\nfatal: invalid reference: missing') })
    expect(resultState(value)).toBe('failed')
    expect(resultState({ ...value, output: present('git status completed with no output.') })).toBe('success')
    render(<ActivityBlock conversationId="test" active={false} segments={[
      { kind: 'tools', id: 'git', groups: [{ id: 'git', file: null, calls: [value] }] },
    ]} />)
    fireEvent.click(screen.getByRole('button', { name: /Some tools failed/ }))
    fireEvent.click(screen.getByRole('button', { name: /Failed/ }))
    expect(within(screen.getByRole('region', { name: 'Git' })).getByRole('status').textContent).toBe('Failed')
  })

  it('opens both levels without rules and reports a nonzero exit as failed at each level', () => {
    const value = call({ output: present('A test failed.\n\n[exit code 1]\n\n[sandbox] Output note') })
    const { container } = render(<ActivityBlock conversationId="test" active={false} segments={[
      { kind: 'tools', id: 'a', groups: [{ id: 'a', file: null, calls: [value] }] },
    ]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ran commands Some tools failed' }))
    fireEvent.click(screen.getByRole('button', { name: /Ran.*pnpm test.*Failed/ }))
    const shell = screen.getByRole('region', { name: 'Shell' })
    expect(within(shell).getByRole('status').textContent).toBe('Failed')
    expect(within(shell).getByText(/A test failed/).textContent).toContain('[sandbox] Output note')
    expect(container.querySelector('.border-l-2')).toBeNull()
    expect(container.querySelector('pre')).toBeNull()
    expect(container.textContent).not.toMatch(/in:|out:/)
  })

  it('uses output plan items including user changes, hiding protocol ids', () => {
    expand(call({ toolName: 'plan', input: present({ items: [{ id: 'internal', text: 'Old request', status: 'pending' }] }),
      output: present({ items: [
        { id: 'internal', text: 'User changed this step', status: 'done', updatedBy: 'user' },
        { id: 'second', text: 'Check the result', status: 'running' },
      ] }) }))
    expect(screen.getByText('User changed this step')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByText('In progress')).toBeTruthy()
    expect(screen.queryByText('Old request')).toBeNull()
    expect(screen.queryByText('internal')).toBeNull()
  })

  it('shows discovery names as words, without the schema and model-facing instructions', () => {
    expand(call({ toolName: 'discover', input: present({ scope: 'mcp:blender/add_camera' }),
      output: present('mcp:blender/add_camera - its full definition.\n\nAdds a camera.\n\nThe input it takes, as JSON Schema:\n{"type":"object"}\n\nIt is not in the tool list you are holding.') }))
    expect(screen.getByText('Blender add camera')).toBeTruthy()
    expect(screen.queryByText(/JSON Schema/)).toBeNull()
    expect(screen.queryByText(/tool list you are holding/)).toBeNull()
  })

  it('reads all native discovery formats and never treats a requested name as a discovered tool', () => {
    expect(discoveryEntries('mcp:blender - 2 tools.\n\n  add_camera - Add a camera.\n  add_light - Add a light.')).toEqual([
      { name: 'mcp:blender', description: '2 tools' }, { name: 'add_camera', description: 'Add a camera.' }, { name: 'add_light', description: 'Add a light.' },
    ])
    expect(discoveryEntries('mcp:blender - 3D tools - 2 tools\n  add_camera, add_light')).toHaveLength(3)
    expect(discoveryEntries('2 tools - their full definitions.\n\nmcp:blender/add_camera\n\nDescription\n\nmcp:blender/add_light')).toHaveLength(2)
    expand(call({ toolName: 'discover', input: present({ scope: 'mcp:missing/add_camera' }), output: present('No extension mcp:missing is installed.') }))
    expect(screen.getByRole('status').textContent).toBe('Failed')
    expect(screen.getByText('No extension mcp:missing is installed.')).toBeTruthy()
    expect(screen.queryByText('Missing add camera', { exact: true })).toBeNull()
  })

  it('shows paged summaries and named loads from the new discovery interface', () => {
    expect(discoveryEntries('Showing 1 of 20 matching tools.\nadd_camera - Add a camera.\nNext cursor: private_cursor\nNo tools were loaded.')).toEqual([
      { name: 'add_camera', description: 'Add a camera.' },
    ])
    expect(discoveryEntries('Showing 1 of 1 matching servers.\nmcp:studio-browser (Native MCP, 24 tools) - Browse pages.')).toEqual([
      { name: 'mcp:studio-browser', description: 'Browse pages.' },
    ])
    expand(call({ toolName: 'discover', input: present({ action: 'load', server: 'mcp:blender', tools: ['add_camera'] }),
      output: present('Loaded 1 tool from mcp:blender.\nmcp:blender/add_camera\nAvailable from your next step.') }))
    expect(screen.getByText('Looking up Blender')).toBeTruthy()
    expect(screen.getByText('Blender add camera')).toBeTruthy()
    expect(screen.queryByText(/next step/)).toBeNull()
  })

  it('shows inspected names and descriptions without exposing schemas or instructions', () => {
    expand(call({ toolName: 'discover', input: present({ action: 'inspect', server: 'mcp:blender', tools: ['add_camera'] }),
      output: present('{"name":"mcp:blender/add_camera","description":"Adds a camera.","inputSchema":{"type":"object"}}\nNo tools were loaded. Use action load to make them callable.') }))
    expect(screen.getByText('Blender add camera')).toBeTruthy()
    expect(screen.getByText('Adds a camera.')).toBeTruthy()
    expect(screen.queryByText(/inputSchema/)).toBeNull()
    expect(screen.queryByText(/Use action load/)).toBeNull()
  })

  it('reports a missing MCP server as a failure without guessing tools from input', () => {
    expand(call({ toolName: 'discover', input: present({ action: 'load', server: 'mcp:missing', tools: ['add_camera'] }),
      output: present('No MCP server mcp:missing is installed. Use action list without server to see enabled servers.') }))
    expect(screen.getByRole('status').textContent).toBe('Failed')
    expect(screen.queryByText('Missing add camera', { exact: true })).toBeNull()
  })

  it('renders unknown tools as readable fields, lists and booleans', () => {
    const { container } = expand(call({ toolName: 'mcp__assets__inspect_scene', input: present({ includeTextures: true }), output: present({ files: ['a.png', 'b.png'], total: 2 }) }))
    expect(screen.getByText('Include Textures')).toBeTruthy()
    expect(screen.getByText('Yes')).toBeTruthy()
    expect(screen.getByText('a.png')).toBeTruthy()
    expect(screen.getByText('b.png')).toBeTruthy()
    expect(container.querySelector('pre')).toBeNull()
    expect(container.textContent).not.toContain('"files"')
  })

  it('keeps pending, live, background, failed and successful outcomes distinct', () => {
    expect(resultState(call())).toBe('pending')
    expect(resultState(call(), true)).toBe('running')
    expect(resultState(call({ output: present('Started job-1 in the background: npm run dev') }))).toBe('background')
    expect(resultState(call({ output: present('Build complete') }))).toBe('success')
    expect(resultState(call({ output: present({ exitCode: 2 }) }))).toBe('failed')
    expect(resultState(call({ output: present({ isError: true }) }))).toBe('failed')
    expect(resultState(call({ errorText: 'Timed out' }))).toBe('failed')
    expect(resultState(call({ output: present('The command runs node, and the sandbox could not make everything it needs readable, so nothing ran.') }))).toBe('failed')
  })
})
