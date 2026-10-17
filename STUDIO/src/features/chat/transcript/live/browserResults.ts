import type { ToolCallView } from '@/features/chat/transcript/projection'
import type { BrowserFrame, BrowserStep } from '@/domain/browser/steps'
import { webUrl } from '@/platform/tauri/external'
import { browserStepOf, readBrowserCall } from './browserCall'
import { resultState } from './toolResult'

export interface BrowserResultView {
  readonly url: string
  readonly title: string
  readonly frame: BrowserFrame | null
  readonly steps: readonly BrowserStep[]
}

/** A recorded page preview, isolated from both newer tabs and other URLs. */
export function browserResults(calls: readonly ToolCallView[]): BrowserResultView[] {
  const tabs = new Map<string, BrowserResultView>()
  for (const call of calls) {
    if (!call.output?.present || resultState(call) !== 'success') continue
    const page = readBrowserCall(call.toolName, call.output.value, call.errorText)
    if (page === null) continue
    const previous = page.tab === null ? undefined : tabs.get(page.tab)
    const url = page.url === null ? previous?.url ?? null : webUrl(page.url)
    if (url === null) continue
    const key = page.tab ?? url
    const earlier = previous ?? tabs.get(key)
    const samePage = earlier?.url === url ? earlier : undefined
    const step = browserStepOf(call)
    tabs.set(key, {
      url, title: page.title || samePage?.title || new URL(url).host,
      frame: page.frame ?? samePage?.frame ?? null,
      steps: [...(samePage?.steps ?? []), ...(step === null ? [] : [step])],
    })
  }
  return [...new Map([...tabs.values()].map((page) => [page.url, page])).values()]
}
