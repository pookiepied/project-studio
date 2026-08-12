import { useState } from 'react'
import { useNavigation } from '@/app/navigation/NavigationProvider'
import { useTheme } from '@/app/theme/ThemeProvider'
import { Disclosure, Moon, Settings, SignOut, Sun } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * The navigator's bottom strip: who you are, and how the app is lit.
 *
 * It anchors the sidebar the way a Finder status bar or a Notion account row
 * does — the tree scrolls above it, this does not move. That fixed foot is
 * most of why the rail reads as a place rather than a list.
 */
export function SidebarFooter() {
  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-border p-2">
      <AccountMenu />
      <ThemeToggle />
    </div>
  )
}

function AccountMenu() {
  const { openSettings } = useNavigation()
  const [open, setOpen] = useState(false)

  const goToSettings = () => {
    setOpen(false)
    openSettings()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Account"
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-150',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring',
              open ? 'bg-muted' : 'hover:bg-muted',
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">
              P
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-tight font-medium">Pookie</span>
              <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                Local account
              </span>
            </span>
            <Disclosure size="xs" className="shrink-0 -rotate-90 text-muted-foreground" aria-hidden />
          </button>
        }
      />
      <PopoverContent side="top" align="start" className="w-52">
        <button
          type="button"
          onClick={goToSettings}
          className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors duration-150 hover:bg-muted"
        >
          <Settings size="sm" className="shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs">Settings…</span>
        </button>
        <button
          type="button"
          disabled
          className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left opacity-50"
        >
          <SignOut size="sm" className="shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs">Sign out</span>
          <span className="text-[10px] text-muted-foreground/70">soon</span>
        </button>
      </PopoverContent>
    </Popover>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Switch to ${nextTheme} theme`}
            onClick={() => setTheme(nextTheme)}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {resolvedTheme === 'dark' ? <Moon size="sm" /> : <Sun size="sm" />}
          </button>
        }
      />
      <TooltipContent side="top">Switch to {nextTheme} theme</TooltipContent>
    </Tooltip>
  )
}
