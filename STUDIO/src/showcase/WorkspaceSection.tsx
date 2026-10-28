import { useEffect } from 'react'
import { RailProvider, useRail } from '@/stores/rail'
import { WorkspaceProvider } from '@/stores/workspace'
import { SideRail } from '@/features/rail/SideRail'
import { workspaceTasks } from '@/features/rail/workspaceTasks'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { Section } from './Section'

const items: TranscriptItem[] = [
  { kind: 'assistant', id: 'review', submissionId: 'review', end: { state: 'complete' }, usage: null, model: null, segments: [
    { kind: 'text', id: 'review-text', text: 'Reviewed the workspace lifecycle and conversation ownership.' },
    { kind: 'tools', id: 'review-tools', groups: [{ id: 'read', file: null, calls: [{ toolCallId: 'read', toolName: 'read', input: { present: true, value: { path: 'src/workspace.ts' } }, output: { present: true, value: 'Workspace source' }, errorText: null }] }] },
  ] },
  { kind: 'assistant', id: 'change', submissionId: 'change', end: { state: 'complete' }, usage: null, model: null, segments: [
    { kind: 'tools', id: 'change-tools', groups: [{ id: 'edit', file: 'workspace.ts', calls: [{ toolCallId: 'edit', toolName: 'edit', input: { present: true, value: { path: 'workspace.ts', oldString: 'const scope = null', newString: 'const scope = conversation.id' } }, output: { present: true, value: 'Edited workspace.ts' }, errorText: null }] }] },
  ] },
  { kind: 'assistant', id: 'test', submissionId: 'test', end: { state: 'stopped' }, usage: null, model: null, segments: [
    { kind: 'tools', id: 'test-tools', groups: [{ id: 'checks', file: null, calls: [
      { toolCallId: 'search', toolName: 'grep', input: { present: true, value: { pattern: 'workspace' } }, output: { present: true, value: '3 matches' }, errorText: null },
      { toolCallId: 'shell', toolName: 'shell', input: { present: true, value: { command: 'pnpm test' } }, output: null, errorText: null },
    ] }] },
  ] },
]
const tasks = workspaceTasks('workspace-specimen', items, true, 'test')

function Specimen() {
  const rail = useRail()
  const { publishTasks, showResources } = rail
  useEffect(() => {
    publishTasks('workspace-specimen', tasks)
    showResources('workspace-specimen', 'Workspace specimen', true, true)
  }, [publishTasks, showResources])
  return <div className="relative flex h-[560px] overflow-hidden rounded-xl bg-surface text-foreground shadow-panel">
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-3 p-8">
      <span className="text-micro text-muted-foreground">Conversation workspace</span>
      <p className="text-title">Work, at a glance.</p>
      <p className="max-w-72 text-caption text-muted-foreground">The production workspace with recorded fixture data. Open a task, review its changes, or collapse and reopen the panel.</p>
      <button type="button" className="w-fit rounded-lg bg-tint px-3 py-2 text-caption" onClick={rail.open ? rail.collapse : rail.expand}>{rail.open ? 'Collapse workspace' : 'Open workspace'}</button>
    </div>
    <SideRail open={rail.open} />
  </div>
}

export function WorkspaceSection() {
  return <Section title="Workspace" note="One surface for live work, compact history and focused inspection. Only Studio's neutral surface and foreground tokens.">
    <WorkspaceProvider><RailProvider conversationId="workspace-specimen"><Specimen /></RailProvider></WorkspaceProvider>
  </Section>
}
