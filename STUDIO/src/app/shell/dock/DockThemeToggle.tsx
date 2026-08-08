import { useTheme } from '@/app/theme/ThemeProvider'
import { Moon, Sun } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Light/dark switch in the dock. It flips between the two resolved themes
 * rather than cycling through `system`: the tri-state preference belongs in
 * Settings, where it can be labelled. This is the one-tap version.
 */
export function DockThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Switch to ${nextTheme} theme`}
            onClick={() => setTheme(nextTheme)}
            className="rounded-full text-muted-foreground hover:text-foreground"
          >
            {resolvedTheme === 'dark' ? <Moon size="sm" /> : <Sun size="sm" />}
          </Button>
        }
      />
      <TooltipContent side="bottom">Switch to {nextTheme} theme</TooltipContent>
    </Tooltip>
  )
}
