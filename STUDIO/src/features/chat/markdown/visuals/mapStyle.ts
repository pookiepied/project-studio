import type { StyleSpecification } from 'maplibre-gl'
import type { MapRoute } from './parse'

export const MAP_PROTOCOL = 'studio-basemap'

/** MapLibre consumes sRGB strings. Studio's theme tokens can be OKLCH. */
export function studioBasemap(element: HTMLElement, route?: MapRoute): StyleSpecification {
  const style = getComputedStyle(element)
  const pixel = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  function color(token: string, accent = 0, contrast = 0) {
    const base = style.getPropertyValue(token).trim()
    if (pixel === null || base === '') return '#808080'
    const tint = accent === 0 ? base
      : `color-mix(in srgb, ${base}, ${style.getPropertyValue('--accent').trim()} ${accent}%)`
    pixel.fillStyle = contrast === 0 ? tint
      : `color-mix(in srgb, ${tint}, ${style.getPropertyValue('--foreground').trim()} ${contrast}%)`
    pixel.fillRect(0, 0, 1, 1)
    const [r, g, b] = pixel.getImageData(0, 0, 1, 1).data
    return `rgb(${r}, ${g}, ${b})`
  }

  const land = color('--surface-sunken')
  const road = color('--surface-raised')
  const spec: StyleSpecification = {
    version: 8,
    glyphs: `${MAP_PROTOCOL}://glyphs/{fontstack}/{range}.pbf`,
    sources: {
      basemap: { type: 'vector', maxzoom: 14, tiles: [`${MAP_PROTOCOL}://tiles/{z}/{x}/{y}.pbf`] },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': land } },
      { id: 'parks', type: 'fill', source: 'basemap', 'source-layer': 'park',
        paint: { 'fill-color': color('--surface-sunken', 5, 4) } },
      { id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water',
        paint: { 'fill-color': color('--surface-sunken', 16, 2) } },
      { id: 'boundaries', type: 'line', source: 'basemap', 'source-layer': 'boundary',
        paint: { 'line-color': color('--surface-sunken', 0, 23), 'line-dasharray': [2, 2] } },
      { id: 'buildings', type: 'fill', source: 'basemap', 'source-layer': 'building', minzoom: 14,
        paint: { 'fill-color': color('--surface-sunken', 0, 7) } },
      { id: 'road-edges', type: 'line', source: 'basemap', 'source-layer': 'transportation', minzoom: 6,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false],
        paint: { 'line-color': color('--surface-sunken', 0, 13), 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 12, 1.8, 16, 6] } },
      { id: 'roads', type: 'line', source: 'basemap', 'source-layer': 'transportation', minzoom: 6,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false],
        paint: { 'line-color': road, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.2, 12, 1, 16, 4.5] } },
      { id: 'places', type: 'symbol', source: 'basemap', 'source-layer': 'place',
        filter: ['step', ['zoom'], ['match', ['get', 'class'], ['country', 'state'], true, false], 6,
          ['match', ['get', 'class'], ['city', 'town', 'state'], true, false], 11, true],
        layout: { 'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 14, 13] },
        paint: { 'text-color': color('--muted-foreground'), 'text-halo-color': land, 'text-halo-width': 1.2 } },
      { id: 'street-labels', type: 'symbol', source: 'basemap', 'source-layer': 'transportation_name', minzoom: 13,
        layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'], 'text-size': 11 },
        paint: { 'text-color': color('--muted-foreground'), 'text-halo-color': road, 'text-halo-width': 1 } },
    ],
  }
  if (route !== undefined) {
    // Keep a segment crossing the date line in the same world as its neighbor.
    let previous = route.coordinates[0][0]
    const coordinates = route.coordinates.map(([lng, lat]) => {
      previous = lng + 360 * Math.round((previous - lng) / 360)
      return [previous, lat]
    })
    spec.sources.walking = {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      },
    }
    spec.layers.push(
      { id: 'walking-edge', type: 'line', source: 'walking',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': road, 'line-width': 8 } },
      { id: 'walking-path', type: 'line', source: 'walking',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color('--accent'), 'line-width': 5 } },
    )
  }
  return spec
}
