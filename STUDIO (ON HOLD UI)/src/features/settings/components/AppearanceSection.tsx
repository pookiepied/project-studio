import { Monitor, Moon, Sun } from '@/components/icons'
import { useTheme } from '@/app/theme/ThemeProvider'
import type { Theme } from '@/app/theme/theme'
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control'
import { Separator } from '@/components/ui/separator'

const THEME_OPTIONS: ReadonlyArray<SegmentedControlOption<Theme>> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

export function AppearanceSection() {
  const { theme, resolvedTheme, setTheme } = useTheme()

  return (
    <section>
      <h2 className="studio-display text-2xl">Appearance</h2>
      <p className="mt-1 text-sm text-muted-foreground">How STUDIO looks on this device.</p>
      <Separator className="my-6" />

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Theme</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Currently showing {resolvedTheme}.
          </p>
        </div>
        <SegmentedControl
          options={THEME_OPTIONS}
          value={theme}
          onChange={setTheme}
          ariaLabel="Theme"
        />
      </div>
    </section>
  )
}
