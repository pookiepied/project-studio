import { useState } from 'react'
import { SETTINGS_SECTIONS, type SettingsSection } from '@/features/settings/settingsNav'
import { AppearanceSection } from '@/features/settings/components/AppearanceSection'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>('appearance')

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl gap-10 overflow-y-auto p-8 pt-14">
      <aside className="w-44 shrink-0">
        <h1 className="studio-display text-3xl">Settings</h1>
        <nav className="mt-6 flex flex-col gap-0.5" aria-label="Settings categories">
          {SETTINGS_SECTIONS.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              disabled={!item.ready}
              onClick={() => setSection(item.id)}
              className={cn(
                'justify-start',
                section === item.id && 'bg-muted text-foreground',
                !item.ready && 'opacity-40',
              )}
            >
              {item.label}
            </Button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        {section === 'appearance' && <AppearanceSection />}
      </div>
    </div>
  )
}
