import { describe, expect, it } from 'vitest'

import { questionFromRecord } from './question'
import type { PendingApprovalRecord } from '@/platform/harness'

/**
 * The sentence is the part a person actually reads, so the mapping is judged
 * against the register the product writes everything else in: what is being
 * asked, in words, with the thing being touched named exactly - and never the
 * capability id, which is the kernel's name for the request, not ours.
 */

function record(overrides: Partial<PendingApprovalRecord> = {}): PendingApprovalRecord {
  return {
    id: 'q_1',
    createdAt: 1_000,
    capabilityNamespace: 'native',
    capabilityName: 'write',
    capabilityTitle: 'Write file',
    resource: 'C:\\home\\conversations\\cnv_1\\workspace\\index.html',
    conversationId: 'conversation:cnv_1',
    agentId: 'studio',
    scopes: [
      { id: 'this-file', label: 'Just this file', detail: 'index.html', pattern: null },
      {
        id: 'this-folder',
        label: 'This folder',
        detail: 'Everything in workspace',
        pattern: 'C:/home/conversations/cnv_1/workspace/**',
      },
    ],
    source: 'default',
    reason: 'native/write has not been approved yet.',
    ...overrides,
  }
}

/** Flattens the sentence for assertion: code parts in brackets. */
function flat(question: { readonly sentence: readonly { kind: string; text: string }[] }) {
  return question.sentence
    .map((part) => (part.kind === 'code' ? `[${part.text}]` : part.text))
    .join('')
}

describe('the question sentence', () => {
  it('names the file and the workspace for a write', () => {
    expect(flat(questionFromRecord(record()))).toBe(
      'Write [index.html] in this conversation\'s workspace.',
    )
  })

  it("says in this project for a project conversation, not the conversation's workspace", () => {
    // The working directory of a project conversation is the person's own
    // folder; naming it as the conversation's paints it as scratch space.
    expect(flat(questionFromRecord(record(), { hasProject: true }))).toBe(
      'Write [index.html] in this project.',
    )
  })

  it('says where in the workspace the file is, not only its name', () => {
    // Two files called index.html in one project produce two questions that
    // read identically if only the name is shown, and a consent prompt that
    // cannot identify what it is asking about is not consent.
    expect(
      flat(
        questionFromRecord(
          record({ resource: 'C:\\home\\conversations\\cnv_1\\workspace\\src\\index.html' }),
        ),
      ),
    ).toBe("Write [src/index.html] in this conversation's workspace.")
  })

  it('names the folder when the path is outside the workspace', () => {
    // A folder the model asked for and the person granted (ADR 0057). The
    // kernel offers the project rung anyway, so the workspace root is known,
    // and the path is not under it: the sentence must not call it the
    // conversation's workspace.
    expect(
      flat(
        questionFromRecord(
          record({
            resource: 'C:\\Users\\me\\Downloads\\model.bin',
            scopes: [
              { id: 'this-file', label: 'Just this file', detail: 'model.bin', pattern: null },
              {
                id: 'this-project',
                label: 'This project',
                detail: 'Everything in workspace',
                pattern: 'C:/home/conversations/cnv_1/workspace/**',
              },
            ],
          }),
        ),
      ),
    ).toBe('Write [model.bin] in [C:\\Users\\me\\Downloads].')
  })

  it('falls back to the file name when the kernel offered no folder rule', () => {
    expect(
      flat(
        questionFromRecord(
          record({
            scopes: [
              { id: 'this-file', label: 'Just this file', detail: 'index.html', pattern: null },
            ],
          }),
        ),
      ),
    ).toBe("Write [index.html] in this conversation's workspace.")
  })

  it('offers the folder rung for a lasting answer, so it is not pinned to one file', () => {
    // A grant stored against the single file the run happened to name first
    // makes "this conversation" ask again about the very next file, in the
    // conversation the person just said yes to.
    expect(questionFromRecord(record()).lastingScopeId).toBe('this-folder')
  })

  it('offers no wider rung when the kernel did not', () => {
    // A command is already approved by program name, and `this-capability` -
    // every use of the tool anywhere - must never be chosen on someone's
    // behalf just because they picked a duration.
    expect(
      questionFromRecord(
        record({
          capabilityName: 'shell',
          resource: 'shell:npm',
          scopes: [
            { id: 'this-command', label: 'This command', detail: 'shell:npm', pattern: null },
            { id: 'this-capability', label: 'This tool', detail: 'Every use', pattern: null },
          ],
        }),
      ).lastingScopeId,
    ).toBeNull()
  })

  it('says edit for an edit, not write', () => {
    expect(flat(questionFromRecord(record({ capabilityName: 'edit' })))).toBe(
      'Edit [index.html] in this conversation\'s workspace.',
    )
  })

  it('approves a program by name, never by the path it was resolved to', () => {
    const sentence = flat(
      questionFromRecord(
        record({
          capabilityName: 'shell',
          capabilityTitle: 'Run a command line',
          resource: 'shell:npm',
          scopes: [
              { id: 'this-command', label: 'This command', detail: 'shell:npm', pattern: null },
            ],
        }),
      ),
    )
    expect(sentence).toBe('Run [npm].')
    expect(sentence).not.toContain('workspace')
  })

  it('says a git subcommand the way git spells it', () => {
    expect(
      flat(
        questionFromRecord(
          record({
            capabilityName: 'git',
            capabilityTitle: 'Run git',
            resource: 'git:push',
            scopes: [
              { id: 'this-command', label: 'This command', detail: 'git:push', pattern: null },
            ],
          }),
        ),
      ),
    ).toBe('Run [git push].')
  })

  it('falls back to the harness title for a capability the table has not met', () => {
    expect(
      flat(
        questionFromRecord(
          record({
            capabilityNamespace: 'mcp:github',
            capabilityName: 'create_issue',
            capabilityTitle: 'Create issue',
            resource: null,
            scopes: [
              { id: 'this-capability', label: 'This tool', detail: 'Every use of it', pattern: null },
            ],
          }),
        ),
      ),
    ).toBe('Use Create issue.')
  })

  it('shows the kernel reason only when a policy - not a default - did the asking', () => {
    expect(questionFromRecord(record()).reason).toBeNull()
    const policy = questionFromRecord(
      record({
        source: 'policy',
        reason: 'Git reaching the network always needs approval.',
      }),
    )
    expect(policy.reason).toBe('Git reaching the network always needs approval.')
  })
})
