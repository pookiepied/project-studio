/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { present } from '@/platform/harness/contracts/chunks'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { ToolGroups } from '../ToolGroups'
import { readableName } from '../toolResult'
import { jobReports } from './jobReports'

vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
afterEach(cleanup)
function show(toolName: string, input: unknown, output: unknown) {
  const call: ToolCallView = { toolCallId: 'a', toolName, input: present(input), output: present(output), errorText: null }
  const view = render(<ToolGroups conversationId="conv" groups={[{ id: 'a', file: null, calls: [call] }]} />)
  fireEvent.click(screen.getByRole('button'))
  return view
}
describe('remaining tool families', () => {
  it('renders a library item with its title, file, subject and path rather than the content envelope', () => {
    show('library_search', { query: 'logo' }, { content: [{ type: 'text', text: '1 item match.\n\n- Brand logo (image, logo.png, id internal-id)\n  Subject: Brand\n  Tags: logo, identity\n  Path: C:/Library/logo.png' }] })
    expect(screen.getByText('Brand logo')).toBeTruthy()
    expect(screen.getByText('Subject: Brand')).toBeTruthy()
    expect(screen.getByText('C:/Library/logo.png')).toBeTruthy()
    expect(screen.queryByText('internal-id')).toBeNull()
    expect(screen.queryByText('Content')).toBeNull()
  })
  it('shows assigned agent work and the actual response, without inventing child tools', () => {
    show('task', { agent: 'explore', prompt: 'Find the startup file.' }, 'The startup file is **main.tsx**.')
    expect(screen.getByText('Explore')).toBeTruthy()
    expect(screen.getByText('Find the startup file.')).toBeTruthy()
    expect(screen.getByText('main.tsx')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Delegated work' })).toBeTruthy()
  })
  it('distinguishes exited, running and failed background jobs at the time of the check', () => {
    show('jobs', {}, 'job_a  running  npm run dev\njob_b  exited 1  npm test\njob_c  exited 0  npm run build')
    expect(screen.getByText('Running when checked')).toBeTruthy()
    expect(screen.getByText('exited 1').className).toContain('text-danger')
    expect(screen.getByText('Finished')).toBeTruthy()
  })
  it('replaces background-launch instructions with a job receipt', () => {
    show('shell', { command: 'npm run dev', background: true }, 'Started job_a in the background: npm run dev\n\nIt is running now and this call did not wait for it. Read its output with jobs {"id":"job_a"}.')
    expect(screen.getByText('Job job_a')).toBeTruthy()
    expect(screen.getByText('Started in background')).toBeTruthy()
    expect(screen.queryByText(/Read its output with jobs/)).toBeNull()
  })
  it('renders a specific MCP invocation separately from discovery and honors its error flag', () => {
    const server = 'studio_customization'
    const tool = 'connection_status'
    show(`mcp__${server.length}_${server}__${tool.length}_${tool}`, { id: 'blender' }, { isError: true, content: [{ type: 'text', text: 'The connection could not be reached.' }] })
    expect(screen.getByText('The connection could not be reached.')).toBeTruthy()
    expect(screen.queryByText('Content')).toBeNull()
    expect(within(screen.getByRole('region', { name: /^Studio customization connection status$/ })).getByRole('status').textContent).toBe('Failed')
  })
  it('decodes the actual harness names without leaking length prefixes or duplicating the built-in server name', () => {
    const server = 'studio_browser'
    const tool = 'studio_browser_open'
    expect(readableName(`mcp__${server.length}_${server}__${tool.length}_${tool}`)).toBe('Studio browser open')
    const unusual = 'server__name'
    expect(readableName(`mcp__${unusual.length}_${unusual}__4_read`)).toBe('Server name read')
    expect(jobReports('media_a  generating  Product picture\nmedia_b  finished  Logo')).toHaveLength(2)
  })
  it('keeps a failed native browser operation inspectable before any result arrives', () => {
    const call: ToolCallView = { toolCallId: 'browser', toolName: 'mcp__14_studio-browser__19_studio_browser_open',
      input: present({ url: 'https://example.com' }), output: null, errorText: 'The browser could not start.' }
    render(<ToolGroups conversationId="conv" groups={[{ id: 'a', file: null, calls: [call] }]} />)
    fireEvent.click(screen.getByRole('button', { name: /Failed/ }))
    expect(screen.getByText('The browser could not start.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Failed')
    expect(screen.queryByText('1 step')).toBeNull()
  })
})
