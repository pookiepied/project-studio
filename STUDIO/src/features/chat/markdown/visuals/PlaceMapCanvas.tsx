import { useEffect, useRef, useState } from 'react'
import { addProtocol, Map as LibreMap, Marker, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { DURATION } from '@/design/tokens'
import { StudioError } from '@/lib/errors'
import { readHarnessBytes } from '@/platform/harness/attachments'
import { MAP_PROTOCOL, studioBasemap } from './mapStyle'
import type { MapPlace, MapRoute } from './parse'

setWorkerUrl(workerUrl)
addProtocol(MAP_PROTOCOL, async ({ url }, { signal }) => {
  const resource = new URL(url)
  if (resource.protocol !== `${MAP_PROTOCOL}:` || resource.search || resource.hash ||
    (resource.hostname !== 'tiles' && resource.hostname !== 'glyphs')) {
    throw new StudioError('map_resource', 'That map resource is invalid.')
  }
  const path = resource.hostname === 'glyphs' ? /^\/Noto%20Sans%20Regular\/(\d+-\d+\.pbf)$/.exec(resource.pathname)?.[1] : undefined
  if (resource.hostname === 'glyphs' && path === undefined) throw new StudioError('map_resource', 'That map font is invalid.')
  const asset = path === undefined ? resource.pathname : `/${path}`
  return { data: await readHarnessBytes(`/api/maps/${resource.hostname}${asset}`, signal) }
})

function fitPlaces(map: LibreMap, places: readonly MapPlace[], duration: number, route?: MapRoute) {
  if (places.length === 1) {
    map.easeTo({ center: [places[0].lng, places[0].lat], zoom: 13, duration })
    return
  }
  // The largest gap is outside the bounds. This keeps locations on opposite
  // sides of the date line in one view.
  const points = [...places.map(({ lng, lat }) => [lng, lat] as const), ...(route?.coordinates ?? [])]
  const longitudes = points.map(([lng]) => lng).sort((a, b) => a - b)
  let start = longitudes[0]
  let gap = start + 360 - longitudes[longitudes.length - 1]
  longitudes.slice(1).forEach((next, index) => {
    const distance = next - longitudes[index]
    if (distance > gap) { gap = distance; start = next }
  })
  const lats = points.map(([, lat]) => lat)
  map.fitBounds([[start, Math.min(...lats)], [start + 360 - gap, Math.max(...lats)]],
    { padding: 38, maxZoom: 14, duration })
}

interface CanvasProps {
  readonly places: readonly MapPlace[]
  readonly selected: number
  readonly onSelect: (index: number) => void
  readonly route?: MapRoute
}

export default function PlaceMapCanvas({ places, selected, onSelect, route }: CanvasProps) {
  const container = useRef<HTMLDivElement>(null)
  const instance = useRef<LibreMap | null>(null)
  const pins = useRef<readonly HTMLButtonElement[]>([])
  const lastSelection = useRef(selected)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    const element = container.current
    if (element === null) return
    let map: LibreMap
    try {
      map = new LibreMap({
        container: element,
        style: studioBasemap(element, route),
        // Scrolling the transcript should keep scrolling the transcript.
        cooperativeGestures: true,
        dragRotate: false,
        touchPitch: false,
        attributionControl: false,
        maxZoom: 17,
        fadeDuration: DURATION.base * 1000,
      })
    } catch {
      setStatus('unavailable')
      return
    }
    instance.current = map
    fitPlaces(map, places, 0, route)
    let hasTiles = false
    map.on('sourcedata', (event) => {
      if (!hasTiles && event.sourceId === 'basemap' && event.coord) {
        hasTiles = true
        setStatus('ready')
      }
    })
    map.on('error', () => { if (!hasTiles) setStatus('unavailable') })
    map.on('webglcontextlost', () => { hasTiles = false; setStatus('unavailable') })
    const markers = places.map((place, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'studio-map-pin'
      button.setAttribute('aria-label', place.name)
      const number = document.createElement('span')
      number.textContent = String(index + 1)
      button.append(number)
      button.addEventListener('click', () => onSelect(index))
      return { button, marker: new Marker({ element: button }).setLngLat([place.lng, place.lat]).addTo(map) }
    })
    pins.current = markers.map(({ button }) => button)
    const theme = new MutationObserver(() => map.setStyle(studioBasemap(element, route)))
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      theme.disconnect()
      markers.forEach(({ marker }) => marker.remove())
      map.remove()
      instance.current = null
      pins.current = []
    }
  }, [places, onSelect, route])

  useEffect(() => {
    pins.current.forEach((pin, index) => pin.setAttribute('aria-pressed', String(index === selected)))
    const place = places[selected]
    if (selected !== lastSelection.current && place !== undefined) {
      // MapLibre itself removes camera motion for reduced-motion preferences.
      instance.current?.easeTo({ center: [place.lng, place.lat], duration: DURATION.slow * 1000 })
    }
    lastSelection.current = selected
  }, [places, selected])

  return (
    <>
      <div className="absolute inset-0">
        <div ref={container} className="size-full" aria-label={route === undefined ? 'Map of places' : 'Walking route map'} role="region" />
      </div>
      {status !== 'ready' ? <p role="status" className="absolute bottom-3 left-3 !m-0 rounded-full bg-surface-raised px-3 py-1.5 text-caption text-muted-foreground shadow-raised">
        {status === 'loading' ? 'Loading basemap…' : 'Basemap unavailable. Places are listed below.'}
      </p> : null}
      {status !== 'unavailable' ? <div className="absolute right-3 top-3 flex gap-0.5 rounded-full bg-surface-raised/95 p-0.5 shadow-raised" aria-label="Map controls" role="group">
        <IconButton size="sm" label="Zoom in" onClick={() => instance.current?.zoomIn({ duration: DURATION.base * 1000 })}><Icons.add size="xs" /></IconButton>
        <IconButton size="sm" label="Zoom out" onClick={() => instance.current?.zoomOut({ duration: DURATION.base * 1000 })}><Icons.subtract size="xs" /></IconButton>
        <IconButton size="sm" label={route === undefined ? 'Fit all places' : 'Fit walking route'} onClick={() => { if (instance.current) fitPlaces(instance.current, places, DURATION.slow * 1000, route) }}><Icons.fitMap size="xs" /></IconButton>
      </div> : null}
    </>
  )
}
