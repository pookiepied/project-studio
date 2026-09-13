import { describe, expect, it } from 'vitest'
import { present } from '@/platform/harness/contracts/chunks'
import {
  browserAction,
  browserStepOf,
  browserSubject,
  browserVerb,
  readBrowserCall,
} from '@/features/chat/transcript/live/browserCall'

/**
 * Reading a browser call out of the log.
 *
 * The card this feeds is the only face the browser has, and everything it
 * reads arrives as `unknown` from a process on the other side of two hops. So
 * the tests that matter here are not the happy path - they are the shapes that
 * would otherwise throw inside a transcript and take the whole conversation's
 * rendering down with them.
 */

const RESULT = {
  content: [
    { type: 'text', text: 'Content from an external MCP server is untrusted.' },
    {
      type: 'text',
      text: 'Clicked.\n\nTab: tab_1\nURL: https://example.com/pricing\nTitle: Pricing',
    },
    { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' },
  ],
}

describe('recognising one of our own browser calls', () => {
  it('reads the action out of the encoded model tool name', () => {
    // The wire name encodes the server id and the tool name together, and the
    // bare action is what the row actually needs.
    expect(browserAction('mcp__14_studio-browser__19_studio_browser_open')).toBe('open')
    expect(browserAction('mcp__14_studio-browser__24_studio_browser_read_text')).toBe(
      'read_text',
    )
  })

  it('leaves every other tool alone', () => {
    expect(browserAction('read')).toBeNull()
    expect(browserAction('mcp__8_deepwiki__13_ask_question')).toBeNull()
  })

  it('says what happened in words, in both tenses', () => {
    expect(browserVerb('open', true)).toBe('Opening')
    expect(browserVerb('open', false)).toBe('Opened')
    // An action nobody wrote a verb for still reads as English rather than as
    // an identifier, because a new tool must not produce "Read_texting".
    expect(browserVerb('some_new_thing', false)).toBe('some new thing')
  })
})

describe('what the card is given', () => {
  it('separates the place from the sentence, so neither is printed twice', () => {
    const view = readBrowserCall('studio_browser_click', RESULT, null)
    expect(view?.url).toBe('https://example.com/pricing')
    expect(view?.title).toBe('Pricing')
    expect(view?.tab).toBe('tab_1')
    expect(view?.said).toContain('Clicked.')
    expect(view?.said).not.toContain('URL:')
  })

  it('finds the frame an acting call returned, as an inline picture', () => {
    const view = readBrowserCall('studio_browser_click', RESULT, null)
    expect(view?.frame).toEqual({ kind: 'inline', data: 'AAAA', mimeType: 'image/jpeg' })
  })

  it('reads an attachment reference as the frame it usually is', () => {
    // The persistence layer stores every tool-result image in the attachment
    // store and leaves the transcript holding the address, not the bytes. Two
    // spellings carry that address - the raw attachment block a live chunk
    // forwards, and the image block whose data the history projection mapped
    // to the attachment's id - and both must read as the same frame, or one
    // path shows a picture and the other shows nothing.
    const live: unknown = {
      content: [
        {
          type: 'attachment',
          attachment: { id: 'att_msg_1_0', mimeType: 'image/jpeg' },
        },
      ],
    }
    const history: unknown = {
      content: [{ type: 'image', data: 'att_msg_1_0', mimeType: 'image/jpeg' }],
    }
    const fromLive = readBrowserCall('studio_browser_screenshot', live, null)
    const fromHistory = readBrowserCall('studio_browser_screenshot', history, null)
    expect(fromLive?.frame).toEqual({ kind: 'attachment', id: 'att_msg_1_0', mimeType: 'image/jpeg' })
    expect(fromHistory?.frame).toEqual(fromLive?.frame)
    // Base64 never begins with the attachment id's prefix, so an ordinary
    // inline picture cannot be mistaken for an address.
    expect(readBrowserCall('studio_browser_screenshot', RESULT, null)?.frame?.kind).toBe('inline')
  })

  it('turns one answered call into the step both report renderers share', () => {
    // `browserStepOf` is the mapping the transcript's report row and the
    // rail's step list both render from; pinning it here is what keeps the
    // two sizes of the report from drifting into two readings of the log.
    const view = readBrowserCall('studio_browser_click', RESULT, null)
    const step = browserStepOf({
      toolCallId: 'call_9',
      toolName: 'mcp__14_studio-browser__19_studio_browser_click',
      input: present({ ref: 'ref_12' }),
      output: present(RESULT),
      errorText: null,
    })
    expect(step).toEqual({
      id: 'call_9',
      action: 'click',
      verb: 'Clicked',
      subject: 'ref_12',
      url: view?.url ?? null,
      title: 'Pricing',
      failed: false,
      frame: view?.frame ?? null,
      settled: true,
    })
  })

  it('keeps a running call a step in the present tense, with no picture', () => {
    // A call the model has made but the harness has not answered is an event
    // happening now: the verb reads as ongoing and the subject comes from the
    // input, because that is all the log knows. Nothing is claimed about the
    // place or the picture the answer has not brought.
    const step = browserStepOf({
      toolCallId: 'call_10',
      toolName: 'studio_browser_open',
      input: present({ url: 'https://example.com' }),
      output: null,
      errorText: null,
    })
    expect(step).toMatchObject({
      id: 'call_10',
      action: 'open',
      verb: 'Opening',
      subject: 'https://example.com',
      url: null,
      title: null,
      failed: false,
      frame: null,
      // Not settled, which is the field the rail reads to know the call is
      // still going. It cannot be inferred from the other four: a read-only
      // call answers with no place and no picture either.
      settled: false,
    })
  })

  it('marks a failed call failed, and gives it no picture', () => {
    const step = browserStepOf({
      toolCallId: 'call_11',
      toolName: 'studio_browser_click',
      input: present({ ref: 'ref_3' }),
      output: present('Clicked.\n\nTab: tab_1\nURL: https://example.com'),
      errorText: 'the element was not there',
    })
    expect(step?.failed).toBe(true)
    expect(step?.frame).toBeNull()
    // Over, the other way. A call that failed is finished, and the rail has to
    // stop reporting it as still happening.
    expect(step?.settled).toBe(true)
  })

  it('is no step at all for a tool that is not ours', () => {
    expect(browserStepOf({
      toolCallId: 'call_12',
      toolName: 'read',
      input: present({ file_path: 'a.ts' }),
      output: present('ok'),
      errorText: null,
    })).toBeNull()
  })

  it('shows no frame for a call that failed', () => {
    // A picture beside a failure reads as though the failure worked. Whatever
    // the frame shows, it is not the result of what was asked.
    const view = readBrowserCall('studio_browser_click', RESULT, 'the element was not there')
    expect(view?.frame).toBeNull()
  })

  it('survives every shape it might be handed', () => {
    // Each of these has to render *something* rather than throw. A transcript
    // that crashes on an unexpected tool result loses the conversation, not
    // just the card.
    for (const output of [
      null,
      undefined,
      'a bare string',
      42,
      [],
      {},
      { content: 'not a list' },
      { content: [null, 7, { type: 'image' }] },
      { value: { content: [{ type: 'text', text: 'URL: https://a.example' }] } },
    ]) {
      const view = readBrowserCall('studio_browser_open', output, null)
      expect(view).not.toBeNull()
      expect(view?.action).toBe('open')
    }
    expect(
      readBrowserCall('studio_browser_open', {
        value: { content: [{ type: 'text', text: 'URL: https://a.example' }] },
      }, null)?.url,
    ).toBe('https://a.example')
  })

  it('is nothing at all for a tool that is not ours', () => {
    expect(readBrowserCall('read', RESULT, null)).toBeNull()
  })
})

describe('what a running row says before any answer', () => {
  it('names the address, because that is the fact a reader wants', () => {
    // Read from the input, since a call still loading a page has no output
    // yet and a row that says only "Opening" has withheld the one useful word.
    expect(browserSubject('open', { url: 'https://example.com' })).toBe('https://example.com')
    expect(browserSubject('find', { query: 'Sign in' })).toBe('Sign in')
    expect(browserSubject('viewport', { preset: 'mobile' })).toBe('mobile')
    expect(browserSubject('click', { ref: 'ref_12' })).toBe('ref_12')
  })

  it('says nothing rather than something wrong', () => {
    expect(browserSubject('open', null)).toBeNull()
    expect(browserSubject('open', {})).toBeNull()
    expect(browserSubject('quit', { url: 1 })).toBeNull()
  })
})
