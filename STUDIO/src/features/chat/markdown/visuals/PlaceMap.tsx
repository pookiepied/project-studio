import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Icons } from '@/components/icons'
import { Arrive } from '@/components/motion/Arrive'
import { Button, Dialog, IconButton } from '@/components/primitives'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { cn } from '@/lib/cn'
import { openExternalUrl } from '@/platform/tauri/external'
import { MarkdownLink } from '../MarkdownLink'
import type { MapPlace, MapRoute, MapVisual, RouteMetrics } from './parse'
import './place-map.css'

const MapCanvas = lazy(() => import('./PlaceMapCanvas').catch(() => ({ default: UnavailableBasemap })))

function UnavailableBasemap() {
  return <MapStatus>Basemap unavailable. Places are listed below.</MapStatus>
}

function MapStatus({ children }: { children: string }) {
  return <span role="status" className="absolute bottom-3 left-3 max-w-[85%] rounded-full bg-surface-raised px-3 py-1.5 text-caption text-muted-foreground shadow-raised">{children}</span>
}

function Attribution({ walking }: { walking: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-muted-foreground">
      {walking ? <>
        <MarkdownLink href="https://openrouteservice.org/">© openrouteservice.org by HeiGIT</MarkdownLink>
        <span aria-hidden>·</span>
      </> : null}
      <MarkdownLink href="https://openfreemap.org/">OpenFreeMap</MarkdownLink>
      <span aria-hidden>·</span>
      <MarkdownLink href="https://openmaptiles.org/">© OpenMapTiles</MarkdownLink>
      <span aria-hidden>·</span>
      <MarkdownLink href="https://www.openstreetmap.org/copyright">{walking ? '© OpenStreetMap contributors' : '© OpenStreetMap'}</MarkdownLink>
    </div>
  )
}

function formatWalking({ distanceMeters, durationSeconds }: RouteMetrics): string {
  const distance = distanceMeters >= 1000
    ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(distanceMeters / 1000)} km`
    : `${Math.round(distanceMeters)} m`
  const minutes = Math.round(durationSeconds / 60)
  const time = durationSeconds < 60 ? `${Math.round(durationSeconds)} sec`
    : minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
  return `${distance} · est. ${time}`
}

function RouteStops({ route, places, selected, onSelect }: {
  route: MapRoute; places: readonly MapPlace[]; selected: number; onSelect: (index: number) => void
}) {
  return (
    <ol aria-label="Walking stops" className="!m-0 flex list-none flex-col gap-1 !p-0">
      {places.map((stop, index) => (
        <li key={index} className="!m-0">
          <Button fullWidth size="sm" variant="ghost" pressed={index === selected} onClick={() => onSelect(index)}
            className={cn('!h-auto min-h-[var(--button-sm)] justify-start py-1 text-left whitespace-normal [&>span]:w-full [&>span]:min-w-0',
              index === selected && 'bg-accent-wash text-accent-wash-foreground')}>
            <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-tint tabular-nums">{index + 1}</span>
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-2">
              <span className="min-w-0 break-words">{stop.name}</span>
              <span className="text-micro tabular-nums text-muted-foreground">
                {index === 0 ? 'Start' : formatWalking(route.legs[index - 1])}
              </span>
            </span>
          </Button>
        </li>
      ))}
    </ol>
  )
}

function PlaceMapBody({ places, selected, onSelect, expanded = false, route }: {
  places: readonly MapPlace[]
  selected: number
  onSelect: (index: number) => void
  expanded?: boolean
  route?: MapRoute
}) {
  const [near, setNear] = useState(false)
  const [linkFailed, setLinkFailed] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const place = places[selected] ?? places[0]
  useEffect(() => {
    const element = viewport.current
    if (element === null) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setNear(true); observer.disconnect() }
    }, { rootMargin: '180px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  function openGoogleMaps() {
    const address = new URL('https://www.google.com/maps/search/')
    address.searchParams.set('api', '1')
    address.searchParams.set('query', `${place.lat},${place.lng}`)
    setLinkFailed(false)
    void openExternalUrl(address.href).catch(() => setLinkFailed(true))
  }

  return (
    <>
      <div ref={viewport} className={cn('studio-map-viewport relative isolate overflow-hidden bg-surface-sunken',
        expanded ? 'h-[clamp(15rem,48vh,28rem)] rounded-xl' : 'h-[clamp(13rem,42vw,20rem)]')}>
        {near ? <Suspense fallback={<MapStatus>Loading basemap…</MapStatus>}>
          <MapCanvas places={places} selected={selected} onSelect={onSelect} route={route} />
        </Suspense> : null}
      </div>
      <div className={cn('flex min-w-0 flex-col gap-3', expanded ? 'pt-4' : 'px-4 py-3.5')}>
        {route !== undefined ? <RouteStops route={route} places={places} selected={selected} onSelect={onSelect} /> : places.length > 1 ? <div className="flex flex-wrap gap-1.5" role="group" aria-label="Places">
          {places.map((item, index) => (
            <Button key={index} size="xs" variant={index === selected ? 'secondary' : 'ghost'}
              className={cn('min-w-0 max-w-full [&>span]:min-w-0', index === selected && 'bg-accent-wash text-accent-wash-foreground')}
              pressed={index === selected} onClick={() => onSelect(index)}>
              <span className="shrink-0 tabular-nums text-muted-foreground" aria-hidden>{index + 1}</span>
              <span className="truncate">{item.name}</span>
            </Button>
          ))}
        </div> : null}
        <div className="flex flex-wrap items-start justify-between gap-2" aria-live="polite">
          {route === undefined ? <motion.div key={selected} className="min-w-0 flex-1 basis-40"
            initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}>
            <div className="break-words text-body font-medium text-foreground">{place.name}</div>
            {place.detail ? <div className="mt-0.5 break-words text-caption text-muted-foreground">{place.detail}</div> : null}
          </motion.div> : null}
          <Button size="xs" variant="secondary" onClick={openGoogleMaps}>
            {route === undefined ? 'Open in Google Maps' : 'Open stop in Google Maps'} <Icons.openLink size="xs" />
          </Button>
        </div>
        {linkFailed ? <div role="alert" className="text-caption text-danger">Could not open Google Maps in your browser.</div> : null}
        <Attribution walking={route !== undefined} />
      </div>
    </>
  )
}

export function PlaceMap({ visual }: { visual: MapVisual }) {
  const [selected, setSelected] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const title = visual.title ?? (visual.places.length === 1 ? 'Place on the map' : 'Places on the map')
  const subtitle = visual.route === undefined ? visual.subtitle : formatWalking(visual.route)
  return (
    <Arrive className="my-5 min-w-0">
      <figure className="!m-0 overflow-hidden rounded-2xl bg-surface-raised shadow-raised">
        <figcaption className="flex items-start gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="studio-heading break-words text-foreground">{title}</div>
            {subtitle ? <div className="mt-0.5 break-words text-caption text-muted-foreground">{subtitle}</div> : null}
          </div>
          <IconButton size="sm" label="Expand map" onClick={() => setExpanded(true)}><Icons.expand size="sm" /></IconButton>
        </figcaption>
        <PlaceMapBody places={visual.places} selected={selected} onSelect={setSelected} route={visual.route} />
      </figure>
      <Dialog open={expanded} onClose={() => setExpanded(false)} title={title} width="58rem">
        {visual.route !== undefined ? <p className="mb-2 text-caption text-muted-foreground">{subtitle}</p> : null}
        <PlaceMapBody places={visual.places} selected={selected} onSelect={setSelected} route={visual.route} expanded />
      </Dialog>
    </Arrive>
  )
}
