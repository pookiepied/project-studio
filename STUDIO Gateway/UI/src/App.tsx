import { useState } from 'react'
import { MotionConfig } from 'framer-motion'
import { gatewayApi, getAdminToken, setAdminToken, ApiError } from '@/lib/api'
import { ThemeProvider } from '@/app/theme/ThemeProvider'
import { ChromeProvider } from '@/app/shell/ChromeProvider'
import { GatewayNavigationProvider } from '@/app/navigation/GatewayNavigation'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GatewayShell } from '@/app/shell/GatewayShell'
import { Button } from '@/components/ui/button'
import { StudioMark } from '@/components/brand/StudioMark'

const SESSION_KEY = 'studio-gateway-ui-session'

export default function App() {
  const [hasSession, setHasSession] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) === '1'
    } catch {
      return false
    }
  })

  if (!hasSession) {
    return <LoginPage onEnter={() => {
      try { sessionStorage.setItem(SESSION_KEY, '1') } catch {}
      setHasSession(true)
    }} />
  }

  function handleLogout() {
    try { sessionStorage.removeItem(SESSION_KEY) } catch {}
    setAdminToken('')
    setHasSession(false)
  }

  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <GatewayNavigationProvider>
          <ChromeProvider>
            <TooltipProvider delay={400}>
              <GatewayShell onLogout={handleLogout} />
            </TooltipProvider>
          </ChromeProvider>
        </GatewayNavigationProvider>
      </ThemeProvider>
    </MotionConfig>
  )
}

function LoginPage({ onEnter }: { onEnter: () => void }) {
  const [value, setValue] = useState(getAdminToken())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setAdminToken(value.trim())
    try {
      await gatewayApi.overview('30d')
      onEnter()
    } catch (reason) {
      if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) setError('That management token was not accepted.')
      else if (reason instanceof ApiError) setError(reason.message)
      else setError('The gateway could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  function localMode() {
    setAdminToken('')
    onEnter()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-sunken p-4 font-sans">
      <div className="studio-blur w-full max-w-[420px] rounded-xl border border-border p-6 shadow-lg">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <StudioMark size={16} className="text-primary-foreground" />
          </div>
          <div>
            <div className="text-sm font-medium tracking-tight">Studio</div>
            <div className="font-editorial text-xs leading-none text-muted-foreground">Gateway</div>
          </div>
        </div>
        <div className="mt-8">
          <p className="text-[11px] font-medium tracking-widest text-muted-foreground uppercase">CONTROL PLANE</p>
          <h1 className="font-display mt-2 text-[28px] leading-none tracking-tight">
            Operate the gateway <em className="font-normal not-italic text-muted-foreground">with clarity.</em>
          </h1>
          <p className="font-editorial mt-3 max-w-[320px] text-[13px] leading-relaxed text-muted-foreground">
            Model traffic, providers, costs, and production configuration in one quiet workspace.
          </p>
        </div>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          <label htmlFor="admin-token" className="text-xs font-medium">
            Management token
          </label>
          <input
            id="admin-token"
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="x-admin-token"
            autoComplete="off"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
          />
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          <Button type="submit" disabled={busy} className="mt-2 w-full">
            {busy ? 'Connecting…' : 'Enter workspace'}
          </Button>
        </form>
        <button type="button" className="mx-auto mt-4 block text-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={localMode}>
          Use local development mode
        </button>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="text-[11px]">Credentials stay in this browser session.</span>
        </p>
      </div>
    </div>
  )
}
