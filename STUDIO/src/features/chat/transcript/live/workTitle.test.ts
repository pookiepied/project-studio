import { describe, expect, it } from 'vitest'
import { present } from '@/platform/harness/contracts/chunks'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { workTitle } from './workTitle'

function file(id: string, path: string, toolName = 'edit'): ToolCallView {
  return { toolCallId: id, toolName, input: present({ path, oldString: 'before', newString: 'after', content: 'after' }),
    output: present(`${toolName === 'write' ? 'Created' : 'Edited'} ${path}`), errorText: null }
}
function media(id: string, type: 'image' | 'video'): ToolCallView {
  return { toolCallId: id, toolName: `studio_${type}`, input: present({}), errorText: null,
    output: present(`Artifact: /api/media/artifacts/conv/media_ab12-0.${type === 'image' ? 'png' : 'mp4'} (${type === 'image' ? 'image/png' : 'video/mp4'})`) }
}
describe('completed work titles', () => {
  it('names the changed file without exposing its full path', () => {
    expect(workTitle([file('edit', 'C:\\project\\src\\search.ts')])).toBe('Updated search.ts')
    expect(workTitle([file('create', '/project/index.html', 'write')])).toBe('Created index.html')
  })
  it('summarizes distinct changed files rather than tool count, ignoring failures', () => {
    expect(workTitle([file('one', 'a.ts'), file('two', 'a.ts'), file('three', 'b.ts'), { ...file('fail', 'c.ts'), errorText: 'Denied' }])).toBe('Updated 2 files')
  })
  it('does not attribute mixed operations to creation alone', () => {
    expect(workTitle([file('one', 'a.ts', 'write'), file('two', 'b.ts')])).toBe('Updated 2 files')
  })
  it('describes generated artifacts without counting repeated references twice', () => {
    expect(workTitle([media('one', 'image'), media('again', 'image')])).toBe('Generated an image')
    expect(workTitle([media('one', 'video')])).toBe('Generated a video')
    expect(workTitle([file('one', 'a.ts'), media('two', 'image')])).toBe('File changes and generated media')
  })
  it('keeps unusually long filenames out of the title', () => {
    expect(workTitle([file('one', `${'x'.repeat(100)}.ts`)])).toBe('Updated a file')
  })
})
