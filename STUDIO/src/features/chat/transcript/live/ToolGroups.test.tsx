/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { present } from '@/platform/harness/contracts/chunks'
import type { ToolCallView, ToolGroupView } from '@/features/chat/transcript/projection'
import { NavigationProvider } from '@/stores/navigation'
import { RailProvider } from '@/stores/rail'
import { WorkspaceProvider } from '@/stores/workspace'

import { RollingCount, STEP_MS } from './RollingCount'
import { ToolGroups } from './ToolGroups'

afterEach(() => {
  // The config does not set `globals: true`, so testing-library's automatic
  // cleanup never registers.
  cleanup()
  vi.useRealTimers()
})

/**
 * The tool chip, fact by fact, rendered by default -- there is no count line
 * in front of it any more to expand through. Each assertion pins one claim a
 * chip makes: the verb it is doing or did, the file it names and the way to
 * it, the count of lines its own input says it changes, and what it refuses
 * to claim -- no diff where the input carries none, no file mark on a
 * command, no "running" once the turn it belonged to is over.
 */
function call(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    toolCallId: 'call-1',
    toolName: 'edit',
    input: present({
      file_path: 'STUDIO/src/features/x.ts',
      old_string: 'const a = 1\nconst b = 2',
      new_string: 'const a = 1\nconst b = 3',
    }),
    output: null,
    errorText: null,
    ...overrides,
  }
}

function groupsOf(
  ...specs: readonly (ToolGroupView | { readonly toolName: string; readonly calls: readonly ToolCallView[] })[]
): ToolGroupView[] {
  // A bare `{ toolName, calls }` literal is a stand of single calls, one row
  // each -- the shape a segment of read-only calls takes. Run rows are built
  // explicitly, with `runOf`.
  return specs.flatMap((spec) =>
    'id' in spec
      ? [spec]
      : spec.calls.map((call, index) => ({
          id: `${spec.toolName}-${index}-${call.toolCallId}`,
          calls: [call],
          file: null,
        })),
  )
}

/** One same-file mutating run, N calls deep. */
function runOf(file: string, ...calls: readonly ToolCallView[]): ToolGroupView {
  return { id: `run-${file}-${calls.length}-${calls[0]?.toolCallId ?? ''}`, calls, file }
}

describe('the chip is the default', () => {
  it('renders every call as its own row, with no count line in front', () => {
    const { container } = render(
      <ToolGroups conversationId="conv"
        groups={groupsOf(
          {
            toolName: 'edit',
            calls: [call(), call({ toolCallId: 'call-2', output: present('done') })],
          },
          { toolName: 'shell', calls: [call({ toolName: 'shell', toolCallId: 'call-3', input: present({ command: 'pnpm build' }) })] },
        )}
      />,
    )
    expect(screen.getByText('Editing')).toBeTruthy()
    expect(screen.getByText('Edited')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('pnpm build')).toBeTruthy()
    // Nothing is collapsed: three calls, three disclosure rows.
    expect(container.querySelectorAll('button[aria-expanded]')).toHaveLength(3)
  })

  it('renders an unknown tool under its raw name', () => {
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({ toolName: 'mystery', calls: [call({ toolName: 'mystery' })] })}
      />,
    )
    expect(screen.getByText('mystery')).toBeTruthy()
  })

  it('gives the harness tools that arrived last a verb instead of their raw name', () => {
    // `discover` and `jobs` are native tools like any other, and an unmapped
    // native tool falls through to the same rendering as `mystery` above --
    // its bare wire name, with no mark. That is right for an extension's tool,
    // whose name we cannot know, and wrong for ours, whose name we chose. This
    // pins the two that shipped after the map was written, because the way
    // this breaks is silent: the row still renders, it just reads like a leak.
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf(
          { toolName: 'discover', calls: [call({ toolName: 'discover', output: present('found') })] },
          { toolName: 'jobs', calls: [call({ toolName: 'jobs', toolCallId: 'call-9', output: present('none') })] },
        )}
      />,
    )

    expect(screen.getByText('Discovered')).toBeTruthy()
    expect(screen.getByText('Checked')).toBeTruthy()
    expect(screen.queryByText('discover')).toBeNull()
    expect(screen.queryByText('jobs')).toBeNull()
  })
})

describe('the verb', () => {
  it('runs while the answer has not arrived, on a live turn', () => {
    const { container } = render(
      <ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'edit', calls: [call()] })} live />,
    )
    expect(screen.getByText('Editing')).toBeTruthy()
    expect(container.querySelector('.studio-shimmer')).not.toBeNull()
  })

  it('never moves on a turn that is not being written', () => {
    const { container } = render(
      <ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'edit', calls: [call()] })} />,
    )
    expect(screen.getByText('Editing')).toBeTruthy()
    expect(container.querySelector('.studio-shimmer')).toBeNull()
  })

  it('settles to the past tense once the answer arrives', () => {
    const { container } = render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({ toolName: 'edit', calls: [call({ output: present('done') })] })}
        live
      />,
    )
    expect(screen.getByText('Edited')).toBeTruthy()
    expect(container.querySelector('.studio-shimmer')).toBeNull()
  })
})

describe('the chip', () => {
  it('names the file, then the way to it', () => {
    render(<ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'edit', calls: [call()] })} />)
    expect(screen.getByText('x.ts')).toBeTruthy()
    expect(screen.getByText('STUDIO/src/features')).toBeTruthy()
  })

  it('carries the count of lines the edit adds and removes', () => {
    const { container } = render(
      <ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'edit', calls: [call()] })} />,
    )
    // The count is a live element -- the digits are their own spans -- so it
    // is read as text, not as one node.
    expect(container.textContent).toContain('+1')
    expect(container.textContent).toContain('-1')
  })

  it('shows no count for a call whose input carries no diff', () => {
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'read',
          calls: [call({ toolName: 'read', input: present({ file_path: 'a.ts' }) })],
        })}
      />,
    )
    expect(screen.getByText('Reading')).toBeTruthy()
    expect(screen.queryByText(/^\+\d+$/)).toBeNull()
  })

  it('does not give a command a file mark', () => {
    const { container } = render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'shell',
          calls: [call({ toolName: 'shell', input: present({ command: 'pnpm build' }) })],
        })}
      />,
    )
    expect(screen.getByText('pnpm build')).toBeTruthy()
    // The language glyphs are the only filled marks on a chip; the action and
    // disclosure marks are stroked. A command is not a file, so there is none.
    expect(container.querySelectorAll('svg[fill="currentColor"]')).toHaveLength(0)
  })

  it('gives a file the language glyph its extension names', () => {
    const { container } = render(
      <ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'edit', calls: [call()] })} />,
    )
    expect(container.querySelectorAll('svg[fill="currentColor"]')).toHaveLength(1)
  })
})

describe('expanding a call', () => {
  it('opens the diff an edit sent, in place of its raw input', () => {
    const { container } = render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({ toolName: 'edit', calls: [call({ output: present('done') })] })}
      />,
    )
    fireEvent.click(screen.getByText('Edited'))
    expect(container.querySelector('code')).not.toBeNull()
    expect(screen.queryByText(/in:/)).toBeNull()
    // The answer stands under the card as the harness spoke it.
    expect(screen.getByText('done')).toBeTruthy()
  })

  it('falls back to the raw input for a call with no diff', () => {
    // A read used to stand in here, but a read is a statement now; the
    // property moved to the next tool whose input carries no diff.
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'move',
          calls: [
            call({
              toolName: 'move',
              input: present({ from: 'a.ts', to: 'b/c.ts' }),
              output: present('Moved a.ts to b/c.ts'),
            }),
          ],
        })}
      />,
    )
    fireEvent.click(screen.getByText('Moved'))
    expect(screen.getByText(/in:/)).toBeTruthy()
    expect(screen.getByText(/out:/)).toBeTruthy()
  })

  it('keeps the error beside the working-out', () => {
    render(
      <ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'edit', calls: [call({ errorText: 'boom' })] })} />,
    )
    // A failed call is not a running one: the verb is past tense even here.
    fireEvent.click(screen.getByText('Edited'))
    expect(screen.getByText('boom')).toBeTruthy()
  })

  it('opens a diff flush, and loose working-out behind the rule', () => {
    // The diff is its own framed card: a rule beside it would draw a second
    // edge. The raw input of a call with no diff keeps the ruled body.
    const diffed = render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({ toolName: 'edit', calls: [call({ output: present('done') })] })}
      />,
    )
    fireEvent.click(screen.getByText('Edited'))
    const diffBody = diffed.container.querySelector('[class*="mt-1.5"]')
    expect(diffBody?.className).not.toContain('border-l-2')

    const plain = render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'glob',
          calls: [call({ toolName: 'glob', input: present({ pattern: '*.ts' }) })],
        })}
      />,
    )
    fireEvent.click(plain.getByText('Searching'))
    const plainBody = plain.container.querySelector('[class*="mt-1.5"]')
    expect(plainBody?.className).toContain('border-l-2')
  })
})

describe('the edit diff', () => {
  it('reads the field names the harness actually sends', () => {
    // The harness's edit schema is `oldString`/`newString`; the extractor
    // once knew only snake_case, and edits showed no diff at all.
    const { container } = render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'edit',
          calls: [
            call({
              input: present({
                path: 'src/x.ts',
                oldString: 'const a = 1\nconst b = 2',
                newString: 'const a = 1\nconst b = 3',
              }),
            }),
          ],
        })}
      />,
    )
    expect(container.textContent).toContain('+1')
    fireEvent.click(screen.getByText('Editing'))
    expect(container.querySelector('code')).not.toBeNull()
  })
})

describe('the entrance', () => {
  it('fades in when the chip arrives with a live turn', () => {
    const { container } = render(
      <ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'edit', calls: [call()] })} live />,
    )
    expect(container.querySelector('button')?.parentElement?.style.opacity).toBe('0')
  })

  it('is already on the page for a chip the reader did not watch arrive', () => {
    const { container } = render(
      <ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'edit', calls: [call()] })} />,
    )
    expect(container.querySelector('button')?.parentElement?.style.opacity).not.toBe('0')
  })
})

/**
 * The record of a question call. The live card takes the answers and the run
 * moves on; the chip is what the transcript keeps, so it names the question
 * and holds the exact words or options the person answered with -- the part
 * the transcript used to lose.
 */
describe('the question and its answer', () => {
  const askCall = (overrides: Partial<ToolCallView> = {}): ToolCallView =>
    call({
      toolName: 'ask_user_question',
      input: present({
        questions: [
          {
            header: 'Auth',
            question: 'Which auth approach should we use?',
            options: [{ id: 'cookies', label: 'Session cookies', description: 'Keep it server-side.' }],
          },
          {
            header: 'Secrets',
            question: 'Where should secrets live?',
            options: [],
          },
        ],
      }),
      ...overrides,
    })

  it('names the folder the model asked for on a folder question', () => {
    render(
      <ToolGroups
        conversationId="conv"
        groups={groupsOf({
          toolName: 'request_folder',
          calls: [call({ toolName: 'request_folder', input: present({ path: 'C:/Users/me/Downloads', mode: 'write', reason: 'x' }) })],
        })}
      />,
    )
    expect(screen.getByText('C:/Users/me/Downloads')).toBeTruthy()
    expect(screen.getByText('Asking for')).toBeTruthy()
  })

  it('names the first question on the chip, with the count beside it', () => {
    render(
      <ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'ask_user_question', calls: [askCall()] })} />,
    )
    expect(screen.getByText('Auth +1')).toBeTruthy()
  })

  it('shows each question and the exact answer given, including custom words', () => {
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'ask_user_question',
          calls: [
            askCall({
              output: present({
                questions: [
                  {
                    header: 'Auth',
                    question: 'Which auth approach should we use?',
                    outcome: 'answered',
                    optionIds: ['cookies'],
                    labels: ['Session cookies'],
                  },
                  {
                    header: 'Secrets',
                    question: 'Where should secrets live?',
                    outcome: 'answered',
                    text: 'In the vault, not the repo',
                  },
                ],
              }),
            }),
          ],
        })}
      />,
    )
    fireEvent.click(screen.getByText('Asked'))
    expect(screen.getByText('Which auth approach should we use?')).toBeTruthy()
    expect(screen.getByText('Session cookies')).toBeTruthy()
    expect(screen.getByText('In the vault, not the repo')).toBeTruthy()
    // The answer is the fact this record exists to hold, and it reads as one.
    expect(screen.getByText('Session cookies').className).toContain('text-foreground')
  })

  it('says what happened instead of a choice', () => {
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'ask_user_question',
          calls: [
            askCall({
              output: present({
                questions: [
                  { header: 'Auth', question: 'Which auth approach?', outcome: 'deferred' },
                  { header: 'Secrets', question: 'Where should secrets live?', outcome: 'timed_out' },
                ],
              }),
            }),
          ],
        })}
      />,
    )
    fireEvent.click(screen.getByText('Asked'))
    expect(screen.getByText('You decide')).toBeTruthy()
    expect(screen.getByText('Timed out')).toBeTruthy()
  })

  it('shows only the questions while the call is still parked', () => {
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({ toolName: 'ask_user_question', calls: [askCall()] })}
      />,
    )
    fireEvent.click(screen.getByText('Asking'))
    expect(screen.getByText('Which auth approach should we use?')).toBeTruthy()
    expect(screen.queryByText('Session cookies')).toBeNull()
  })

  it('leaves no raw JSON behind for a question call', () => {
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'ask_user_question',
          calls: [
            askCall({
              output: present({
                questions: [
                  { header: 'Auth', question: 'Which auth approach?', outcome: 'answered', labels: ['Session cookies'] },
                ],
              }),
            }),
          ],
        })}
      />,
    )
    fireEvent.click(screen.getByText('Asked'))
    expect(screen.queryByText(/in:/)).toBeNull()
    expect(screen.queryByText(/out:/)).toBeNull()
  })
})

describe('failure and pending', () => {
  it('marks a failed call in the danger colour', () => {
    render(
      <ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'edit', calls: [call({ errorText: 'boom' })] })} />,
    )
    const failed = screen.getByText('Failed')
    expect(failed.className).toContain('text-danger')
  })

  it('says pending, not running, once the turn it belonged to is over', () => {
    const { container } = render(
      <ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'edit', calls: [call()] })} />,
    )
    expect(screen.getByText('pending')).toBeTruthy()
    expect(container.querySelector('.studio-shimmer')).toBeNull()
  })
})

function writeCall(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return call({
    toolName: 'write',
    input: present({ path: 'snake.html', content: '<html>\n<body>\n</body>\n</html>' }),
    ...overrides,
  })
}

describe('a write with nothing to say', () => {
  it('shows the empty diff a write of an empty file sent', () => {
    // Emptiness is a fact, not an absence: the input carried content, the
    // content was "", and the honest card is a head with no rows under it --
    // not a fall-back to raw JSON that pretends no diff was claimed.
    const { container } = render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'write',
          calls: [
            writeCall({
              input: present({ path: 'snake.html', content: '' }),
              output: present('Created snake.html'),
            }),
          ],
        })}
      />,
    )
    fireEvent.click(screen.getByText('Wrote'))
    expect(screen.getByText('+0')).toBeTruthy()
    expect(container.querySelector('code')).toBeNull()
  })
})

/**
 * The count on a running chip arrives: it starts at nothing, climbs to the
 * fact over a beat, and rests there. The wire delivers a call's input whole,
 * so nothing real trickles in -- the ramp is the chip's entrance, and it is
 * drawn only for a turn being written now.
 */
describe('the count arriving', () => {
  it('counts up on a live chip and rests on the fact', () => {
    vi.useFakeTimers()
    const { container } = render(
      <ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'write', calls: [writeCall()] })} live />,
    )
    expect(screen.getByText('Writing')).toBeTruthy()
    expect(container.textContent).toContain('+0 -0')
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(container.textContent).toContain('+4 -0')
  })

  it('renders the settled count for history', () => {
    const { container } = render(
      <ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'write', calls: [writeCall()] })} />,
    )
    expect(container.textContent).toContain('+4 -0')
  })

  it('settles the moment the call is answered, whatever the ramp was doing', () => {
    vi.useFakeTimers()
    const view = render(
      <ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'write', calls: [writeCall()] })} live />,
    )
    expect(view.container.textContent).toContain('+0 -0')
    view.rerender(
      <ToolGroups conversationId="conv"
        groups={groupsOf({ toolName: 'write', calls: [writeCall({ output: present('Replaced snake.html') })] })}
        live
      />,
    )
    expect(view.container.textContent).toContain('+4 -0')
  })
})

/**
 * What a call's answer renders as. The harness's answers to file tools are
 * sentences and numbered pages -- `Replaced snake.html`, `cat -n` lines --
 * and a shell command's output is text. Strings render as themselves; only
 * structured answers print as JSON. Under a diff card, the status sentence
 * stands alone, without the `out:` prefix that made it read as debris.
 */
describe('the answer', () => {
  it('speaks the status of a diffed call under the card, verbatim', () => {
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'write',
          calls: [writeCall({ output: present('Replaced snake.html') })],
        })}
      />,
    )
    fireEvent.click(screen.getByText('Wrote'))
    expect(screen.getByText('Replaced snake.html')).toBeTruthy()
    expect(screen.queryByText(/out:/)).toBeNull()
  })

  it('renders a read as a statement that opens onto nothing', () => {
    // The read's answer is the page the model read -- the model's business,
    // and a slab a reader was never meant to wade through -- so the row is
    // a statement: no chevron, no region, nothing to open.
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'read',
          calls: [
            call({
              toolName: 'read',
              input: present({ path: 'notes.txt' }),
              output: present('     1\tfirst line\n     2\tsecond line'),
            }),
          ],
        })}
      />,
    )
    const row = screen.getByText('Read').closest('button')
    expect(row?.getAttribute('aria-expanded')).toBeNull()
    expect(row?.disabled).toBe(true)
    fireEvent.click(screen.getByText('Read'))
    expect(screen.queryByText('first line')).toBeNull()
    expect(screen.queryByText(/out:/)).toBeNull()
  })

  it('prints a structured answer as JSON', () => {
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'shell',
          calls: [
            call({
              toolName: 'shell',
              input: present({ command: 'git status' }),
              output: present({ branch: 'main', clean: true }),
            }),
          ],
        })}
      />,
    )
    fireEvent.click(screen.getByText('Ran'))
    expect(screen.getByText(/out:/).textContent).toContain('"branch"')
  })
})

/**
 * A read is a statement, not a disclosure -- except when it failed. The
 * error is the one part of a read's answer a person may need, and it lives
 * nowhere else, so failure is the one read that still opens.
 */
describe('the read that failed', () => {
  it('keeps its disclosure, and the error under it', () => {
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'read',
          calls: [
            call({
              toolName: 'read',
              input: present({ path: 'notes.txt' }),
              errorText: 'There is no file at notes.txt.',
            }),
          ],
        })}
      />,
    )
    fireEvent.click(screen.getByText('Read'))
    expect(screen.getByText(/There is no file at notes\.txt\./)).toBeTruthy()
  })

  it('renders an image read as the same statement, its bytes never printed', () => {
    const { container } = render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'read',
          calls: [
            call({
              toolName: 'read',
              input: present({ path: 'snake.png' }),
              output: present({
                content: [
                  { type: 'text', text: 'Attached: snake.png (image/png).' },
                  { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
                ],
              }),
            }),
          ],
        })}
      />,
    )
    const row = screen.getByText('Read').closest('button')
    expect(row?.disabled).toBe(true)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).not.toContain('aGVsbG8=')
  })
})

/**
 * The four native tools that shipped after the action map was first
 * written. Like `discover` and `jobs` above, an unmapped native tool falls
 * through to its bare wire name with no mark -- right for an extension's
 * tool, wrong for ours. Each of these also pins the subject the chip names:
 * the path the act touched, or the query that drove it.
 */
describe('the late native tools', () => {
  it('gives delete its mark and its path', () => {
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'delete',
          calls: [call({ toolName: 'delete', input: present({ path: 'STUDIO/src/old.ts' }), output: present('Deleted STUDIO/src/old.ts') })],
        })}
      />,
    )
    expect(screen.getByText('Deleted')).toBeTruthy()
    // Only the file tools split a path into name and way; delete names the
    // path whole.
    expect(screen.getByText('STUDIO/src/old.ts')).toBeTruthy()
    expect(screen.queryByText('delete')).toBeNull()
  })

  it('gives move its mark and names the file that moved', () => {
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'move',
          calls: [call({ toolName: 'move', input: present({ from: 'a.ts', to: 'b/c.ts' }), output: present('Moved a.ts to b/c.ts') })],
        })}
      />,
    )
    expect(screen.getByText('Moved')).toBeTruthy()
    expect(screen.getByText('a.ts')).toBeTruthy()
    expect(screen.queryByText('move')).toBeNull()
  })

  it('gives the library tools their marks and their subjects', () => {
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf(
          { toolName: 'library_search', calls: [call({ toolName: 'library_search', input: present({ query: 'the logo' }), output: present('Found 1.') })] },
          { toolName: 'library_keep', calls: [call({ toolName: 'library_keep', toolCallId: 'call-11', input: present({ path: 'out.png' }), output: present('Kept.') })] },
        )}
      />,
    )
    expect(screen.getByText('Searched')).toBeTruthy()
    expect(screen.getByText('the logo')).toBeTruthy()
    expect(screen.getByText('Kept')).toBeTruthy()
    expect(screen.getByText('out.png')).toBeTruthy()
    expect(screen.queryByText('library_search')).toBeNull()
    expect(screen.queryByText('library_keep')).toBeNull()
  })
})

/**
 * Every tool in the harness's native registry, against the rendering. The
 * list is copied by hand from `STUDIO HARNESS/src/tools` -- the UI cannot
 * import the harness, so this file is the pin: when a native tool ships,
 * it goes here AND into the action map (or a family of its own), or it
 * falls through to its bare wire name with no mark. That fall-through is
 * right for an extension's tool, whose name we cannot know, and a leak for
 * ours, whose names we chose -- discover and jobs leaked exactly this way,
 * silently, because the row still renders. One test per tool, so the
 * failure names the tool that leaked.
 */
describe('every native tool', () => {
  const NATIVE_TOOLS = [
    'read',
    'write',
    'edit',
    'delete',
    'move',
    'glob',
    'grep',
    'git',
    'shell',
    'jobs',
    'discover',
    'plan',
    'ask_user_question',
    'request_folder',
    'library_search',
    'library_keep',
    'ocr',
    'studio_image',
    'studio_video',
    'web_search',
    'fetch',
  ]

  for (const toolName of NATIVE_TOOLS) {
    it(`never renders ${toolName} under its raw wire name`, () => {
      // The media and web tools draw their artifact cards, and those cards
      // reach for the workspace and rail stores; every row here renders
      // inside the same providers a real transcript sits in.
      render(
        <NavigationProvider>
          <WorkspaceProvider>
            <RailProvider>
              <ToolGroups conversationId="conv"
                groups={groupsOf({
                  toolName,
                  calls: [call({ toolName, input: present({ path: 'a.ts' }), output: present('done') })],
                })}
              />
            </RailProvider>
          </WorkspaceProvider>
        </NavigationProvider>,
      )
      expect(screen.queryByText(toolName)).toBeNull()
    })
  }
})

/**
 * An edit answer echoes the changed span of the post-edit file, numbered --
 * the only place the span's real line numbers exist. The diff card takes
 * those numbers into its gutters, and the echo itself is not printed under
 * the card: a one-line change shown twice, the second time as a slab of the
 * file, is the debris this expansion used to end with.
 */
describe('the edit answer echo', () => {
  const OUTCOME =
    'Edited snake/script.js\n' +
    '\n' +
    '   197\tfunction drawFood(now) {\n' +
    '   198\t    const cx = food.x * CELL + CELL / 2;\n' +
    '   199\t    const cy = food.y * CELL + CELL / 2;\n' +
    '   200\t    // clamp to >= 0: foodSpawnAt is taken with performance.now() mid-frame,\n' +
    '   201\t    // which is always slightly after this frame\'s rAF timestamp, so on the\n' +
    '   202\t    // spawn frame (now - foodSpawnAt) is negative and an unclamped radius\n' +
    '   203\t    // would throw IndexSizeError and kill the render loop\n' +
    '   204\t    const grow = easeOut(Math.max(0, Math.min((now - foodSpawnAt) / 250, 1)));\n' +
    '   205\t    const pulse = 1 + Math.sin(now / 260) * 0.08;\n' +
    '   206\t    const r = CELL * 0.32 * grow * pulse;\n' +
    '   207\t'

  function snakeEdit(): ToolCallView {
    return call({
      input: present({
        path: 'snake/script.js',
        oldString: '    const grow = easeOut(Math.min((now - foodSpawnAt) / 250, 1));',
        newString: [
          '    // clamp to >= 0: foodSpawnAt is taken with performance.now() mid-frame,',
          "    // which is always slightly after this frame's rAF timestamp, so on the",
          '    // spawn frame (now - foodSpawnAt) is negative and an unclamped radius',
          '    // would throw IndexSizeError and kill the render loop',
          '    const grow = easeOut(Math.max(0, Math.min((now - foodSpawnAt) / 250, 1)));',
        ].join('\n'),
      }),
      output: present(OUTCOME),
    })
  }

  it('lifts the echo\'s real line numbers into the card\'s gutters', () => {
    render(<ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'edit', calls: [snakeEdit()] })} />)
    fireEvent.click(screen.getByText('Edited'))
    // The removed line stood at 200, exactly where the echo says the span
    // begins; the five additions take 200 through 204.
    expect(screen.getAllByText('200').length).toBeGreaterThan(0)
    expect(screen.getByText('204')).toBeTruthy()
  })

  it('anchors a child of a run on the echo, as it anchors a chip', () => {
    // The same edit the chip anchors above, travelling inside a run: the
    // gutters must not depend on which row shape is showing the call.
    const run = runOf(
      'snake/script.js',
      call({
        toolCallId: 'e1',
        input: present({ path: 'snake/script.js', oldString: 'a', newString: 'a\nb' }),
        output: present('Edited snake/script.js'),
      }),
      snakeEdit(),
    )
    const view = render(<ToolGroups conversationId="conv" groups={[run]} />)
    fireEvent.click(screen.getByText('Edited'))
    // Opening the run shows the children; the second child is the snake
    // edit, and its card only exists once the child itself is opened.
    const buttons = view.container.querySelectorAll('button[aria-expanded]')
    if (buttons.length < 3) throw new Error(`expected the run and two children, got ${buttons.length}`)
    fireEvent.click(buttons[2] ?? view.container)
    expect(screen.getAllByText('200').length).toBeGreaterThan(0)
    expect(screen.getByText('204')).toBeTruthy()
  })

  it('does not print the echoed span again under the card', () => {
    render(<ToolGroups conversationId="conv" groups={groupsOf({ toolName: 'edit', calls: [snakeEdit()] })} />)
    fireEvent.click(screen.getByText('Edited'))
    // `function drawFood` exists only in the echo -- the strings the model
    // sent never mention it -- so finding it would mean the slab is back.
    expect(screen.queryByText(/function drawFood/)).toBeNull()
    // The harness's sentence is its own, and stays.
    expect(screen.getByText('Edited snake/script.js')).toBeTruthy()
  })

  it('keeps the write sentence, whose second line carries a fact the card does not', () => {
    render(
      <ToolGroups conversationId="conv"
        groups={groupsOf({
          toolName: 'write',
          calls: [
            writeCall({
              input: present({ path: 'snake/index.html', content: '<html>\n</html>' }),
              output: present('Created snake/index.html\nCreated directory snake, which did not exist.'),
            }),
          ],
        })}
      />,
    )
    fireEvent.click(screen.getByText('Wrote'))
    expect(screen.getByText(/Created directory snake, which did not exist\./)).toBeTruthy()
  })
})

/* -------------------------------------------------------------------------- */
/* The file run                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The run row: one row for a maximal line of same-file edits, its numbers
 * ticking in place while it receives, its expansion holding the net and the
 * full per-call log. The header's stat is the run's NET when the calls'
 * anchors prove one and the summed churn when they do not -- named in the
 * tooltip either way.
 */
describe('the file run', () => {
  function editCall(
    id: string,
    oldString: string,
    newString: string,
    overrides: Partial<ToolCallView> = {},
  ): ToolCallView {
    return call({
      toolCallId: id,
      input: present({ path: 'snake/script.js', oldString, newString }),
      output: present('Edited snake/script.js'),
      ...overrides,
    })
  }

  it('renders the run as one row, counted, with the net as the stat', () => {
    // Three edits that each rework the last one's line: the churn would read
    // +3 -3, the net is the truth, +2 -0.
    const run = runOf(
      'snake/script.js',
      editCall('e1', 'start', 'start\nmid'),
      editCall('e2', 'mid', 'mid\nmid2'),
      editCall('e3', 'mid2', 'final'),
    )
    const { container } = render(<ToolGroups conversationId="conv" groups={[run]} />)
    expect(screen.getByText('Edited')).toBeTruthy()
    expect(screen.getByText('3 edits')).toBeTruthy()
    const stat = screen.getByTitle('net lines changed')
    expect(stat.textContent).toBe('+2 -0')
    // One row: one disclosure button for the whole run.
    expect(container.querySelectorAll('button[aria-expanded]')).toHaveLength(1)
  })

  it('names the churn as churn when the anchors do not chain', () => {
    const run = runOf(
      'snake/script.js',
      editCall('e1', 'one', '1'),
      editCall('e2', 'unrelated', '2'),
    )
    render(<ToolGroups conversationId="conv" groups={[run]} />)
    const stat = screen.getByTitle('lines touched')
    // Two edits, two sides: the churn counts both directions.
    expect(stat.textContent).toBe('+2 -2')
  })

  it('expands to the net card and one child per call, each with its own count', () => {
    const run = runOf(
      'snake/script.js',
      editCall('e1', 'start', 'start\nmid'),
      editCall('e2', 'mid', 'mid\nend'),
    )
    const { container } = render(<ToolGroups conversationId="conv" groups={[run]} />)
    fireEvent.click(screen.getByText('Edited'))
    expect(screen.getByText(/net -- the file as the run's first call found it/)).toBeTruthy()
    // The group button plus one button per child.
    const buttons = container.querySelectorAll('button[aria-expanded]')
    expect(buttons).toHaveLength(3)
  })

  it('keeps a failed call as a child with a word instead of a count', () => {
    const run = runOf(
      'snake/script.js',
      editCall('e1', 'a', 'a\nb'),
      editCall('e2', 'zzz', 'yy', { errorText: 'anchor not found' }),
    )
    render(<ToolGroups conversationId="conv" groups={[run]} />)
    fireEvent.click(screen.getByText('Edited'))
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('keeps a single mutating call a chip, never a run of one', () => {
    const single = runOf('snake/script.js', editCall('e1', 'a', 'a\nb'))
    const { container } = render(<ToolGroups conversationId="conv" groups={[single]} />)
    // One call is one chip: no count line, no net header, nothing to expand
    // into. The run row exists for calls that arrive together, and a run of
    // one is a chip wearing a group's clothes.
    expect(screen.queryByText(/1 edit/)).toBeNull()
    expect(container.querySelector('[title="net lines changed"]')).toBeNull()
  })

  it('closes the run when a single mutating call lands on another file', () => {
    const run = runOf('snake/script.js', editCall('e1', 'a', 'a\nb'), editCall('e2', 'b', 'b\nc'))
    // One edit to another file is a chip, but it still happened after the
    // run: the log moved on, and a closed run must not sit there expanded
    // and shimmering as if it were still the event in progress.
    const trailing = runOf(
      'other.ts',
      call({
        toolCallId: 'o1',
        input: present({ path: 'other.ts', oldString: 'x', newString: 'y' }),
        output: present('Edited other.ts'),
      }),
    )
    const view = render(<ToolGroups conversationId="conv" groups={[run, trailing]} live />)
    // The first disclosure button in document order is the run's.
    expect(view.container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('is open while receiving, closed by the next run, and the hand wins over both', () => {
    const run = runOf('snake/script.js', editCall('e1', 'a', 'a\nb'), editCall('e2', 'b', 'b\nc'))
    const view = render(<ToolGroups conversationId="conv" groups={[run]} live />)
    // The segment's last file run is the one receiving: open, children in view.
    expect(view.container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true')
    // A different file's mutation lands after it: the run closes by itself.
    const interruption = runOf(
      'other.ts',
      call({
        toolCallId: 'o1',
        input: present({ path: 'other.ts', oldString: 'x', newString: 'y' }),
        output: present('Edited other.ts'),
      }),
      call({
        toolCallId: 'o2',
        input: present({ path: 'other.ts', oldString: 'y', newString: 'z' }),
        output: present('Edited other.ts'),
      }),
    )
    view.rerender(<ToolGroups conversationId="conv" groups={[run, interruption]} live />)
    expect(view.container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false')
    // The reader opens it; no auto-state may close it again.
    fireEvent.click(view.container.querySelector('button[aria-expanded]') ?? view.container)
    expect(view.container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true')
    view.rerender(<ToolGroups conversationId="conv" groups={[run]} live />)
    expect(view.container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true')
    // And the hand can shut a receiving run, which stays shut.
    fireEvent.click(view.container.querySelector('button[aria-expanded]') ?? view.container)
    expect(view.container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false')
  })
})

/**
 * The ticking count: a live number that rises climbs FROM the number on
 * screen, not from nothing -- the whole point of a row that mutates in place
 * instead of respawning.
 */
describe('the count ticking in place', () => {
  it('climbs from the standing number when a live count rises', () => {
    vi.useFakeTimers()
    const view = render(<RollingCount value={5} live />)
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(view.container.textContent).toBe('5')
    view.rerender(<RollingCount value={9} live />)
    act(() => {
      vi.advanceTimersByTime(STEP_MS)
    })
    // One tick of the new ramp: up from five, not restarted at zero.
    expect(view.container.textContent).toBe('7')
  })
})
