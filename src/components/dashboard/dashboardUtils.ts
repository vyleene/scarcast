import type { FitBoundsOptions, LatLngBoundsLiteral, LatLngTuple } from 'leaflet'
import { gcovManifest } from '../../services/processGCOVData'
import { gunwManifest } from '../../services/processGUNWData'
import type { ProcessedGUNWData } from '../../services/gunwTypes'

export const worldBounds: LatLngBoundsLiteral = [[-60, -180], [80, 180]]
export const worldViewOptions: FitBoundsOptions = {
  paddingTopLeft: [40, 65],
  paddingBottomRight: [40, 70],
  maxZoom: 2.5,
  duration: 1.1,
}

export const locations: [string, readonly { bounds: LatLngBoundsLiteral; acquiredAt: string }[]][] =
  [...new Set([...Object.keys(gcovManifest), ...Object.keys(gunwManifest)])].map(slug => [slug,
    gcovManifest[slug]?.length ? gcovManifest[slug] : (gunwManifest[slug] ?? []).map(pair => ({ bounds: pair.bounds, acquiredAt: pair.referenceAt })),
  ] as [string, readonly { bounds: LatLngBoundsLiteral; acquiredAt: string }[]]).filter(([, observations]) => observations.length > 0)
export const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
export const shortDateFormatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
export const nameFor = (slug: string) => slug === 'balikabok_downstream'
  ? 'Mount Balikabok and downstream area'
  : slug.split('_').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
export const dateFor = (date: string) => new Date(`${date.slice(0, 19)}Z`)
export const centerFor = (bounds: LatLngBoundsLiteral): LatLngTuple => [
  (bounds[0][0] + bounds[1][0]) / 2,
  (bounds[0][1] + bounds[1][1]) / 2,
]

export type RasterState = { id: string; status: 'ready' | 'error'; message?: string; data?: ProcessedGUNWData }
export type DataTab = 'backscatter' | 'deformation' | 'analysis'

export function locationViewOptions(height: number): FitBoundsOptions {
  return {
    paddingTopLeft: [40, 100],
    paddingBottomRight: [40, height < 550 ? 140 : 210],
    maxZoom: 14,
    duration: 1.35,
  }
}
