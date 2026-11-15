import type { ImageOverlay, LatLngBoundsLiteral } from 'leaflet'
import type { GCOVMetadata } from './processGCOVData'

export interface BackscatterChangeMetadata {
  product: 'GCOV_CHANGE'
  aoi: GCOVMetadata['aoi']
  identification: GCOVMetadata['identification']
  before_id: string
  after_id: string
  start_at: string
  end_at: string
  sources: string[]
  bounds: LatLngBoundsLiteral
  units: 'dB'
  polarization: 'HH'
  display_min: number
  display_max: number
  valid_pixel_count: number
  method: string
  hotspots: {
    file: string
    bounds: LatLngBoundsLiteral
    threshold_db: number
    maximum_db: number
    window_pixels: number
    window_m: number
    minimum_patch_m2: number
    highlighted_pixel_count: number
    method: string
  }
}
export interface BackscatterChangeAcquisition {
  id: string
  location: string
  url: string
  bounds: LatLngBoundsLiteral
  metadata: BackscatterChangeMetadata
}
const files = import.meta.glob<BackscatterChangeMetadata>('../../data/*/gcov_change/*/metadata.json', { eager: true, import: 'default' })
const urls = import.meta.glob<string>('../../data/*/gcov_change/*/hotspots.png', { eager: true, query: '?url', import: 'default' })
export const backscatterChangeManifest = Object.entries(files).reduce<Record<string, BackscatterChangeAcquisition[]>>((manifest, [path, metadata]) => {
  const match = path.match(/\/data\/([^/]+)\/gcov_change\/([^/]+)\/metadata.json$/)
  if (!match) return manifest
  const [, location, id] = match
  const url = urls[path.replace('metadata.json', 'hotspots.png')]
  if (!url || metadata.product !== 'GCOV_CHANGE' || metadata.units !== 'dB') throw new Error(`Invalid backscatter change export: ${path}`)
  ;(manifest[location] ??= []).push({ id, location, metadata, url, bounds: metadata.bounds })
  manifest[location].sort((a,b) => a.metadata.start_at.localeCompare(b.metadata.start_at))
  return manifest
}, Object.create(null))

const layers = new Map<string, Promise<ImageOverlay>>()
let controller = new AbortController()
export function clearBackscatterChangeCache() {
  controller.abort()
  for (const pending of layers.values()) void pending.then(layer => layer.remove(), () => {})
  layers.clear()
  controller = new AbortController()
}
export function createBackscatterChangeLayer(acquisition: BackscatterChangeAcquisition): Promise<ImageOverlay> {
  const key = `${acquisition.location}/${acquisition.id}`
  const cached = layers.get(key)
  if (cached) return cached
  const signal = controller.signal
  const pending = (async () => {
    signal.throwIfAborted()
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { image.onload = null; image.onerror = null; signal.removeEventListener('abort', aborted) }
      const aborted = () => { cleanup(); image.src = ''; reject(signal.reason) }
      image.onload = () => { cleanup(); resolve() }
      image.onerror = () => { cleanup(); reject(new Error('Unable to load the surface-change heatmap.')) }
      signal.addEventListener('abort', aborted, { once: true })
      image.src = acquisition.url
    })
    signal.throwIfAborted()
    const { imageOverlay } = await import('leaflet')
    signal.throwIfAborted()
    const layer = imageOverlay(acquisition.url, acquisition.metadata.hotspots.bounds, { opacity: 0.8, interactive: false })
    return layer
  })().catch(error => { if (layers.get(key) === pending) layers.delete(key); throw error })
  layers.set(key, pending)
  return pending
}
