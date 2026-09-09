import { describe, expect, it } from 'vitest'
import {
  browserAction,
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

  it('finds the frame an acting call returned', () => {
    const view = readBrowserCall('studio_browser_click', RESULT, null)
    expect(view?.frame).toEqual({ data: 'AAAA', mimeType: 'image/jpeg' })
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
