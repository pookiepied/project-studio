import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { StudioMark } from '@/components/brand'
import { Button, TextField } from '@/components/primitives'
import { SHELL } from '@/design/tokens'
import { readPairingState } from '@/platform/harness'
import { isTauri } from '@/platform/tauri'

/**
 * The gate a browser passes through before it is Studio, and the pairing
 * screen an unpaired one is shown instead.
 *
 * ---- Why it sits above the provider stack ----------------------------------
 *
 * The listener in Rust is the real wall: every request an unpaired device
 * makes under `/api` and `/agents` is refused before it is forwarded, so
 * nothing leaks however the page renders. What this component decides is what
 * that device *sees*. Without it, an unpaired browser would mount the whole
 * workspace — a sidebar, a composer, a transcript — whose every request comes
 * back refused: technically empty, and experientially a broken Studio. So the
 * gate asks the listener's state route once, before any of that mounts, and
 * shows the pairing screen or the app. It sits above the provider stack for
 * the same reason `DiagnosticWindow` does: a page whose whole subject is that
 * the app is not open yet must not reach for the stores the app would hold.
 *
 * ---- What each answer means ------------------------------------------------
 *
 * The listener answers `{"paired":true|false}` and nothing else does. `false`
 * is the pairing screen. `true` is the app, whose own address resolution then
 * finds the listener as its origin. Anything that is not the listener's
 * answer — a fetch that failed, a 404 from `vite dev` or a static host — is
 * the page being served by something other than Studio's listener, and the
 * app renders exactly as it always has. That fail-open direction is safe
 * because it only ever shows an empty shell: the wall stays in Rust, and this
 * screen is the face of it, not the gate itself.
 *
 * Tauri passes through untouched, before anything is asked: the desktop is
 * the host machine, never a device to pair, and its windows must not spend a
 * round trip learning that.
 */

/** The listener's answer, or the absence of one. */
type Answer =
  | { kind: 'asking' }
  /** The page was served by Studio's listener, paired or not. */
  | { kind: 'listener'; paired: boolean; refusal?: string }
  /** The page was served by something else: `vite dev`, a static host. */
  | { kind: 'elsewhere' }

export function PairingGate({ children }: { children: ReactNode }) {
  if (isTauri()) return <>{children}</>
  return <BrowserGate>{children}</BrowserGate>
}

function BrowserGate({ children }: { children: ReactNode }) {
  const [answer, setAnswer] = useState<Answer>({ kind: 'asking' })
  const opening = useRef<Promise<Answer> | null>(null)

  useEffect(() => {
    let live = true
    // Keep one submission across StrictMode's effect replay: codes work once.
    opening.current ??= openBrowser()
    void opening.current.then((result) => {
      if (live) setAnswer(result)
    })
    return () => {
      live = false
    }
  }, [])

  const admitted = answer.kind === 'listener' && answer.paired
  useEffect(() => {
    if (!admitted) return
    let live = true
    const check = () => {
      void readPairingState().then((paired) => {
        if (live && paired === false) setAnswer({ kind: 'listener', paired: false })
      })
    }
    const timer = window.setInterval(check, 4_000)
    window.addEventListener('focus', check)
    return () => {
      live = false
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [admitted])

  /** Asked again once a pairing code is accepted, below. */
  const askAgain = () => {
    setAnswer({ kind: 'asking' })
    void readPairingState().then((paired) => {
      setAnswer(paired === true
        ? { kind: 'listener', paired: true }
        : { kind: 'listener', paired: false, refusal: 'Studio could not confirm pairing. Allow cookies and try a new code.' })
    })
  }

  if (answer.kind === 'asking') {
    // No entrance, deliberately: this state usually lasts one round trip, and
    // a mark caught mid-assembly and cut off reads as a glitch rather than a
    // greeting. The mark is simply there, and leaves when the answer comes.
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-surface">
        <StudioMark size={44} className="text-foreground" />
      </div>
    )
  }
  if (answer.kind === 'listener' && !answer.paired) {
    return <PairingScreen onPaired={askAgain} initialRefusal={answer.refusal} />
  }
  return <>{children}</>
}

function answerFrom(paired: boolean | null): Answer {
  return paired === null ? { kind: 'elsewhere' } : { kind: 'listener', paired }
}

async function openBrowser(): Promise<Answer> {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const code = fragment.get('pair')
  if (code !== null) {
    fragment.delete('pair')
    const rest = fragment.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ''}`)
  }
  const paired = await readPairingState()
  if (paired === null && code) return { kind: 'listener', paired: false, refusal: UNREACHABLE }
  if (paired !== false || !code) return answerFrom(paired)
  try {
    const response = await fetch(SUBMIT_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!response.ok) return { kind: 'listener', paired: false, refusal: await refusalOf(response) }
    if (await readPairingState() === true) return { kind: 'listener', paired: true }
    return { kind: 'listener', paired: false, refusal: 'Allow cookies for Studio, then scan a new code.' }
  } catch {
    return { kind: 'listener', paired: false, refusal: UNREACHABLE }
  }
}

/** The one route a device may pair itself through, on this page's origin. */
const SUBMIT_ROUTE = '/api/pairing'

/** What a browser that cannot reach the PC at all is told. */
const UNREACHABLE =
  'Studio could not be reached. Check that the PC is on and both devices are on the same network.'

/**
 * The pairing screen: the whole app while the browser is unpaired.
 *
 * The code comes from Studio on the PC, and the field carries whatever was
 * typed rather than pre-cleaning it — the listener normalises the code
 * (case, spaces) before comparing, so the client staying out of that is one
 * fewer place for the two ends to disagree.
 *
 * Success is not a reload: the cookie is already set, so the gate re-asks and
 * lets the app through, and everything below mounts for the first time as a
 * paired device. A reload would boot the same tree the long way round.
 */
function PairingScreen({ onPaired, initialRefusal }: { onPaired: () => void; initialRefusal?: string }) {
  const [code, setCode] = useState('')
  const [refusal, setRefusal] = useState<string | null>(initialRefusal ?? null)
  const [busy, setBusy] = useState(false)

  const submit = () => {
    if (busy) return
    setBusy(true)
    setRefusal(null)
    void fetch(SUBMIT_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then(async (response) => {
        if (response.ok) {
          onPaired()
          return
        }
        setRefusal(await refusalOf(response))
      })
      .catch(() => setRefusal(UNREACHABLE))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-surface px-6 text-center">
      <StudioMark entrance size={44} className="text-foreground" />

      <div className="flex flex-col items-center" style={{ maxWidth: SHELL.measure }}>
        <h1 className="studio-display text-foreground">Pair this device</h1>
        <p className="mt-3 text-ui text-muted-foreground">
          Open Studio on the PC to see the pairing code, then type it here.
        </p>
      </div>

      <form
        className="flex flex-col items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {/* Uppercase is the display, not the value: the listener normalises
            whatever arrives, so the field shows the code the way the PC
            shows it without deciding what was meant. */}
        <TextField
          value={code}
          onChange={setCode}
          ariaLabel="Pairing code"
          placeholder="······"
          autoCapitalize="characters"
          className="w-44 text-center font-mono uppercase tracking-[0.3em]"
        />
        <Button type="submit" variant="primary" size="sm" busy={busy} disabled={code.trim() === ''}>
          Pair
        </Button>
      </form>

      {/* The listener's own sentence, verbatim: it writes these in the app's
          voice, and a second wording here would make two sources of the one
          truth. */}
      {refusal !== null ? <p role="alert" className="max-w-[60ch] break-words text-ui text-danger">{refusal}</p> : null}
    </div>
  )
}

/** The refusal sentence from the listener's body, or a generic one. */
async function refusalOf(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null) {
      const error: unknown = (body as { error?: unknown }).error
      if (typeof error === 'string' && error !== '') return error
    }
  } catch {
    // Not JSON: the fallback below is the answer.
  }
  return 'That did not work. Check the code Studio is showing and try again.'
}
