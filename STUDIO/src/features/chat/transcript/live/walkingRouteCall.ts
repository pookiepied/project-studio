import type { MapPlace, MapRoute, MapVisual, RouteMetrics } from '@/features/chat/markdown/visuals/parse'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { isRecord } from '@/lib/guards'

export function isWalkingRoute(toolName: string): boolean {
  return toolName === 'walking_route' || toolName === 'native_walking_route'
}

function coordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
}

function metric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function readMetrics(value: unknown): RouteMetrics | null {
  if (!isRecord(value) || !metric(value.distanceMeters) || !metric(value.durationSeconds)) return null
  return { distanceMeters: value.distanceMeters, durationSeconds: value.durationSeconds }
}

export function readWalkingRoute(call: ToolCallView): MapVisual | null {
  if (!isWalkingRoute(call.toolName) || call.errorText !== null || !call.output?.present) return null
  const value = call.output.value
  if (!isRecord(value) || value.kind !== 'walking-route' || value.version !== 1) return null
  const totals = readMetrics(value)
  const { coordinates, stops, legs } = value
  if (totals === null || !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 4096 ||
    !Array.isArray(stops) || stops.length < 2 || stops.length > 5 ||
    !Array.isArray(legs) || legs.length !== stops.length - 1) return null

  const path: Array<[number, number]> = []
  for (const position of coordinates) {
    if (!Array.isArray(position) || position.length !== 2 || !coordinate(position[0], 180) || !coordinate(position[1], 85)) return null
    path.push([position[0], position[1]])
  }
  const places: MapPlace[] = []
  for (const stop of stops) {
    if (!isRecord(stop) || typeof stop.name !== 'string' || stop.name.trim() === '' || stop.name.length > 120 ||
      !coordinate(stop.lng, 180) || !coordinate(stop.lat, 85)) return null
    places.push({ name: stop.name, lng: stop.lng, lat: stop.lat })
  }
  const measured: RouteMetrics[] = []
  for (const leg of legs) {
    const metrics = readMetrics(leg)
    if (metrics === null) return null
    measured.push(metrics)
  }
  const route: MapRoute = { ...totals, coordinates: path, legs: measured }
  return { kind: 'map', title: places.length === 2 ? 'Walking route' : 'Walking itinerary', places, route }
}
