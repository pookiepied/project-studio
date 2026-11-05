import { useState } from 'react'
import { Button, MenuItem, Popover, Segmented, Tooltip } from '@/components/primitives'
import { Pane, Row } from '@/features/settings/panes/Pane'
import { Section } from './Section'

/** Constrained specimens exercise real layout roles without a harness or user data. */
export function LayoutSection() {
  const [choice, setChoice] = useState('system')
  const [open, setOpen] = useState(false)
  return (
    <Section title="Responsive layout" note="Compare the same settings rows in narrow and wide panes. Text preferences above apply to both.">
      <div className="flex flex-col gap-6">
        {(['22.5rem', '36rem'] as const).map((width) => (
          <div key={width} data-layout-specimen={width} className="w-full rounded-lg border p-3" style={{ maxWidth: width }}>
            <Pane title="Appearance" description="The control stays with its label as the pane narrows.">
              <Row label="Theme" hint="Use the system appearance or choose a palette.">
                <Segmented ariaLabel={`Specimen theme ${width}`} layoutId={`specimen-theme-${width}`}
                  value={choice} onChange={setChoice}
                  options={['system', 'light', 'dark'].map((id) => ({ id, label: id }))} />
              </Row>
              <Row label="Window" hint="Long explanations should wrap without squeezing the action.">
                <Button variant="secondary" size="sm">Reset to default size</Button>
              </Row>
            </Pane>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Popover open={open} onOpenChange={setOpen} maxHeight="28rem"
            trigger={<Button onClick={() => setOpen(!open)}>Open tall menu</Button>}>
            {Array.from({ length: 24 }, (_, index) => (
              <MenuItem key={index} onSelect={() => setOpen(false)}>Option {index + 1}</MenuItem>
            ))}
          </Popover>
          <Tooltip label="This deliberately long explanation must wrap and remain inside the available viewport when text size or window dimensions change.">
            <Button variant="secondary">Long tooltip</Button>
          </Tooltip>
        </div>
      </div>
    </Section>
  )
}
