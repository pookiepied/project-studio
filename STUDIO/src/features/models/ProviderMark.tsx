import { useEffect, useState } from 'react'
import { ICON_STEP, type IconSize } from '@/design/tokens'
import { resolveProviderIcon } from '@/domain/providers/icons'
import { cn } from '@/lib/cn'
import claude from './marks/claude.svg'
import deepseek from './marks/deepseek.svg'
import google from './marks/google.svg'
import mistral from './marks/mistral.svg'
import openai from './marks/openai.svg'
import openrouterGrape from './marks/openrouter-grape.svg'
import openrouterVolt from './marks/openrouter-volt.svg'
import perplexity from './marks/perplexity.svg'
import qwen from './marks/qwen.svg'
import together from './marks/together.svg'

// OpenRouter publishes its Grape and Volt marks at openrouter.ai/brand.
// The other local assets are from LobeHub Icons. A missing color asset keeps
// the existing catalog logo and theme contrast.
const COLOR_MARKS = new Map([
  ['anthropic', claude],
  ['claude', claude],
  ['deepseek', deepseek],
  ['google', google],
  ['google-vertex', google],
  ['mistral', mistral],
  ['mistralai', mistral],
  ['openrouter', openrouterGrape],
  ['perplexity', perplexity],
  ['qwen', qwen],
  ['together', together],
  ['togetherai', together],
  ['together-ai', together],
])

function useProviderIconDataUri(provider: string | null): string | null {
  const [result, setResult] = useState<{ provider: string; uri: string } | null>(null)

  useEffect(() => {
    if (provider === null || provider === '') return
    let live = true
    void resolveProviderIcon(provider).then((uri) => {
      if (live && uri !== null) setResult({ provider, uri })
    })
    return () => { live = false }
  }, [provider])

  return result?.provider === provider ? result.uri : null
}

export function ProviderMark({
  provider,
  size = 'text',
  className,
  bare = false,
}: {
  provider: string
  size?: IconSize
  className?: string
  bare?: boolean
}) {
  const mark = size === 'text' ? 'var(--provider-mark)' : ICON_STEP[size]
  const tile = size === 'text' ? 'var(--provider-tile)' : `calc(${ICON_STEP[size]} * 1.32)`
  const color = COLOR_MARKS.get(provider)
  const dark = provider === 'openrouter' ? openrouterVolt : undefined
  const localMask = provider === 'openai' || provider === 'openai-codex' ? openai : null
  const resolved = useProviderIconDataUri(color !== undefined || localMask !== null ? null : provider)
  const mask = localMask ?? resolved

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md',
        !bare && 'bg-tint',
        className,
      )}
      style={{ width: tile, height: tile }}
    >
      {color !== undefined ? (
        <>
          <img
            alt=""
            draggable={false}
            data-provider={provider}
            data-mark="logo"
            src={color}
            className={cn('studio-icon shrink-0 object-contain', dark !== undefined && 'dark:hidden')}
            style={{ width: mark, height: mark }}
          />
          {dark === undefined ? null : (
            <img
              alt=""
              draggable={false}
              data-provider={provider}
              data-mark="logo"
              src={dark}
              className="studio-icon hidden shrink-0 object-contain dark:block"
              style={{ width: mark, height: mark }}
            />
          )}
        </>
      ) : mask !== null ? (
        <span
          data-provider={provider}
          data-mark="logo"
          className="studio-icon shrink-0"
          style={{
            width: mark,
            height: mark,
            backgroundColor: 'currentColor',
            mask: `url("${mask}") center / contain no-repeat`,
            maskImage: `url("${mask}")`,
          }}
        />
      ) : (
        <Fallback provider={provider} mark={mark} />
      )}
    </span>
  )
}

function Fallback({ provider, mark }: { provider: string; mark: string }) {
  const letter = provider.match(/[a-z0-9]/i)?.[0].toUpperCase()
  if (letter !== undefined) {
    return (
      <span
        data-provider={provider}
        data-mark="monogram"
        className="studio-icon inline-flex shrink-0 items-center justify-center font-medium leading-none tracking-tight select-none"
        style={{ width: mark, height: mark, fontSize: mark }}
      >
        {letter}
      </span>
    )
  }

  return (
    <svg
      style={{ width: mark, height: mark }}
      viewBox="0 0 24 24"
      data-provider={provider}
      data-mark="unnamed"
      shapeRendering="geometricPrecision"
      className="studio-icon shrink-0"
    >
      <rect x="4" y="4" width="16" height="16" rx="4.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}
