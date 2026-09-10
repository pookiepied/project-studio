import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { Icons } from '@/components/icons'
import { Button, IconButton, Segmented, TextField } from '@/components/primitives'
import { Pane, Row } from '@/features/settings/panes/Pane'
import { copyText } from '@/lib/clipboard'
import type { PairedDevice, RemoteAddresses } from '@/platform/remote-access'
import { isTauri } from '@/platform/tauri'
import { QrCode } from '@/features/settings/devices/QrCode'
import { useRemoteAccess } from '@/features/settings/devices/useRemoteAccess'

/**
 * Other devices: the same Studio, opened in a browser somewhere else.
 *
 * The screen is the switch, then — only while it is on — the three things a
 * person needs in the order they need them: the address (a QR code and the
 * addresses written out, labelled for home and away), the pairing code the
 * other device is asked for, and the list of devices that have paired.
 *
 * Two addresses are shown and named rather than one implied to work
 * everywhere (ADR 0050 §3.6): `studio.local` is the name at home, where mDNS
 * reaches; the Tailscale name is the one away, where it does not. The QR code
 * carries a raw home address rather than the name, because a phone camera
 * has to resolve what it scans and Android's `.local` support is what the
 * plan calls unreliable.
 *
 * A browser tab is a device, not the machine that holds the switch, so off
 * the desktop the pane says where the switch is and nothing else.
 */
export function DevicesPane() {
  if (!isTauri()) return <BrowserNote />
  return <DesktopPane />
}

function BrowserNote() {
  return (
    <Pane title="Other devices" description={DESCRIPTION}>
      <div className="py-4">
        <p className="max-w-[60ch] text-ui text-muted-foreground">
          This is one of the devices. Pairing more, removing one, and turning the feature off
          are done from Studio on the PC, under Settings and Other devices.
        </p>
      </div>
    </Pane>
  )
}

const DESCRIPTION =
  'Open this same Studio in a browser on your phone, tablet or laptop while this PC is running.'

function DesktopPane() {
  const remote = useRemoteAccess()
  const on = remote.reach === 'on'

  return (
    <Pane title="Other devices" description={DESCRIPTION}>
      <Row label="Open on other devices" hint={switchHint(remote.reach)}>
        <Segmented
          layoutId="settings-other-devices"
          ariaLabel="Open on other devices"
          value={on ? 'on' : 'off'}
          onChange={(value) => {
            if (remote.switching) return
            void (value === 'on' ? remote.turnOn() : remote.turnOff())
          }}
          options={[
            { id: 'off', label: 'Off' },
            { id: 'on', label: 'On' },
          ]}
        />
      </Row>

      {/* The desktop's own sentence, verbatim: it writes refusals in the
          app's voice, and a second wording here would be two sources of one
          truth. */}
      {remote.failure !== null ? (
        <p className="py-3 text-ui text-danger">{remote.failure}</p>
      ) : null}

      {on ? (
        <>
          <AddressSection addresses={remote.addresses} />
          <CodeSection code={remote.code} onNewCode={() => void remote.newCode()} />
          <DevicesSection
            devices={remote.devices}
            onRename={(id, name) => void remote.rename(id, name)}
            onRemove={(id) => void remote.remove(id)}
            onRemoveAll={() => void remote.removeAll()}
          />
        </>
      ) : null}
    </Pane>
  )
}

/**
 * What the switch row says under its label.
 *
 * The firewall sentence is under the off state and only on Windows, because
 * that is the moment and the platform where a system dialog would otherwise
 * appear out of nowhere (ADR 0050 §3.8). Someone reading it before they flip
 * the switch knows what is coming and what to choose.
 */
function switchHint(reach: 'unknown' | 'off' | 'on'): string {
  if (reach === 'on') {
    return 'Other devices can open Studio while this PC is running. Turning this off closes the door and drops every device at once.'
  }
  const firewall = onWindows()
    ? ' The first time, Windows asks whether to allow Studio through the firewall; choose Allow.'
    : ''
  return `Nothing is reachable until this is on.${firewall}`
}

function onWindows(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
}

/** A titled block below the switch row, with the pane's own rhythm. */
function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="py-4">
      <p className="text-ui text-foreground">{title}</p>
      {hint ? <p className="mt-0.5 text-caption text-muted-foreground">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

// ---- The address ----------------------------------------------------------

function AddressSection({ addresses }: { addresses: RemoteAddresses | null }) {
  if (addresses === null) {
    return (
      <Section title="Address">
        <p className="text-caption text-muted-foreground">Reading this PC's addresses.</p>
      </Section>
    )
  }

  const home = addresses.home.map((address) => url(address, addresses.port))
  const scanned = scannedUrl(addresses)

  return (
    <Section title="Address" hint="Scan the code, or type one of these into the browser.">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        {scanned !== null ? (
          <div className="shrink-0 self-start rounded-lg border bg-white p-1.5">
            <QrCode value={scanned} label={`QR code for ${scanned}`} />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <AddressGroup
            title="At home"
            note="On the same network as this PC."
            addresses={[
              ...(addresses.homeName !== null ? [url(addresses.homeName, addresses.port)] : []),
              ...home,
            ]}
            empty="This PC is not on a home network right now."
          />
          <AddressGroup
            title="Away from home"
            note="Through Tailscale, with it running on both devices."
            addresses={
              addresses.away === null
                ? []
                : [
                    ...(addresses.away.name !== null
                      ? [url(addresses.away.name, addresses.port)]
                      : []),
                    url(addresses.away.address, addresses.port),
                  ]
            }
            empty="Tailscale is not running on this PC, so there is no away address."
          />
        </div>
      </div>
    </Section>
  )
}

/**
 * What the QR code carries: a raw home address first, because a camera has
 * to resolve what it scans and a number always resolves; the Tailscale
 * address when there is no home network; nothing when there is neither,
 * since a code for an address that cannot be reached is worse than no code.
 */
function scannedUrl(addresses: RemoteAddresses): string | null {
  const home = addresses.home[0]
  if (home !== undefined) return url(home, addresses.port)
  if (addresses.away !== null) return url(addresses.away.address, addresses.port)
  return null
}

function url(host: string, port: number): string {
  return `http://${host}:${port}`
}

function AddressGroup({
  title,
  note,
  addresses,
  empty,
}: {
  title: string
  note: string
  addresses: readonly string[]
  empty: string
}) {
  return (
    <div>
      <p className="text-caption text-foreground">{title}</p>
      <p className="text-caption text-muted-foreground">{note}</p>
      {addresses.length === 0 ? (
        <p className="mt-1.5 text-caption text-muted-foreground/80">{empty}</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1">
          {addresses.map((address) => (
            <li key={address} className="flex min-w-0 items-center gap-1">
              <code className="min-w-0 truncate font-mono text-ui text-foreground">{address}</code>
              <CopyButton text={address} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1_500)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <IconButton
      label={copied ? 'Copied' : `Copy ${text}`}
      size="sm"
      onClick={() => {
        void copyText(text).then((done) => setCopied(done))
      }}
    >
      {copied ? <Icons.check /> : <Icons.copy />}
    </IconButton>
  )
}

// ---- The pairing code -----------------------------------------------------

function CodeSection({ code, onNewCode }: { code: string | null; onNewCode: () => void }) {
  return (
    <Section
      title="Pairing code"
      hint="The other device asks for this after it opens the address. A code works once and expires after five minutes."
    >
      <div className="flex items-center gap-3">
        <code
          aria-label="Pairing code"
          className="rounded-md border bg-surface px-3 py-1.5 font-mono text-title tracking-[0.3em] text-foreground"
        >
          {code ?? '——————'}
        </code>
        <Button size="sm" onClick={onNewCode}>
          New code
        </Button>
      </div>
    </Section>
  )
}

// ---- The paired devices ---------------------------------------------------

function DevicesSection({
  devices,
  onRename,
  onRemove,
  onRemoveAll,
}: {
  devices: readonly PairedDevice[]
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onRemoveAll: () => void
}) {
  return (
    <Section
      title="Paired devices"
      hint="Removing a device signs it out at once; it has to pair again to get back in."
    >
      {devices.length === 0 ? (
        <p className="text-caption text-muted-foreground/80">
          No devices yet. Scan the code with your phone and enter the pairing code.
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y rounded-lg border">
            {devices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                onRename={(name) => onRename(device.id, name)}
                onRemove={() => onRemove(device.id)}
              />
            ))}
          </ul>
          {devices.length > 1 ? (
            <div className="mt-3">
              <Button size="sm" variant="danger" onClick={onRemoveAll}>
                Remove all
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Section>
  )
}

function DeviceRow({
  device,
  onRename,
  onRemove,
}: {
  device: PairedDevice
  onRename: (name: string) => void
  onRemove: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return
    const name = draft.trim()
    if (name !== '' && name !== device.name) onRename(name)
    setDraft(null)
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        {draft === null ? (
          <p className="truncate text-ui text-foreground">{device.name}</p>
        ) : (
          <TextField
            value={draft}
            onChange={setDraft}
            autoFocus
            ariaLabel="Device name"
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') setDraft(null)
            }}
          />
        )}
        <p className="mt-0.5 text-caption text-muted-foreground">
          Paired {calendarDay(device.pairedAtMs)} · Last seen {sinceThen(device.lastSeenMs)}
        </p>
      </div>
      {draft === null ? (
        <IconButton label="Rename" size="sm" onClick={() => setDraft(device.name)}>
          <Icons.edit />
        </IconButton>
      ) : (
        <Button size="xs" variant="primary" onClick={commit}>
          Save
        </Button>
      )}
      <Button size="xs" variant="ghost" onClick={onRemove}>
        Remove
      </Button>
    </li>
  )
}

/** `3 Sep`, or `3 Sep 2025` once the year is not this one. */
function calendarDay(ms: number, now = Date.now()): string {
  const date = new Date(ms)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * `just now`, `4 minutes ago`, `yesterday`: the coarse reading a person
 * wants from "when did my phone last use this". Coarser than a minute on
 * purpose — the desktop writes the time through at most once a minute, so a
 * finer reading would be precise about a number that is not.
 */
function sinceThen(ms: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000))
  if (seconds < 90) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return calendarDay(ms, now)
}
