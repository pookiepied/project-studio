import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Sparkles, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const appWindow = getCurrentWindow()

export default function App() {
  useEffect(() => {
    // Startup contract: the window stays hidden until the first paint.
    void invoke('app_ready')
  }, [])

  return (
    <div className="dark">
      <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
        <header className="flex h-9 shrink-0 select-none items-stretch border-b border-border">
          <div data-tauri-drag-region className="flex flex-1 items-center pl-3">
            <span className="text-xs font-medium tracking-wide text-muted-foreground">STUDIO</span>
          </div>
          <div className="flex items-stretch">
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-full w-11 rounded-none"
              onClick={() => appWindow.minimize()}
            >
              <Minus />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-full w-11 rounded-none"
              onClick={() => appWindow.toggleMaximize()}
            >
              <Square />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-full w-11 rounded-none hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => appWindow.close()}
            >
              <X />
            </Button>
          </div>
        </header>
        <main className="flex flex-1 flex-col items-center justify-center gap-6">
          <h1 className="text-5xl font-semibold tracking-tight">STUDIO</h1>
          <p className="text-sm text-muted-foreground">
            Local-first agent workspace. Shell under construction.
          </p>
          <Button size="lg">
            <Sparkles data-icon="inline-start" />
            Get started
          </Button>
        </main>
      </div>
    </div>
  )
}
