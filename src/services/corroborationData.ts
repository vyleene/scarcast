import type { LatLngBoundsLiteral } from 'leaflet'

export type EvidenceZone = 'mountain' | 'downstream' | 'study'
export interface EvidenceSelection {
  zone: EvidenceZone; drainage: boolean; optical: boolean; opticalOpacity: number
  screen: boolean; reportedPlaces: boolean; opticalScene?: string; selectedPlace?: string
}
export const initialEvidenceSelection: EvidenceSelection = {
  zone: 'mountain', drainage: true, optical: false, opticalOpacity: .8, screen: true, reportedPlaces: true,
}
export const evidenceZoneLabels: Record<EvidenceZone, string> = {
  mountain: 'Mountain study area', downstream: 'Outside the mountain clip', study: 'Full study area',
}
interface Overlay { file: string; bounds: LatLngBoundsLiteral }
export interface OpticalScene {
  id: string; date: string; sensor: string; source_urls: string[]
  clear_fraction: Record<EvidenceZone, number>; overlay: Overlay
}
interface OpticalTimeline {
  event_date: string; resolution_m: number; method: string; scenes: OpticalScene[]
  excluded: { id: string; date: string; reason: string; clear_fraction: Record<EvidenceZone, number> }[]
}
export const opticalTimeline = Object.values(import.meta.glob<OpticalTimeline>('../../data/balikabok_downstream/evidence/optical-timeline.json', { eager: true, import: 'default' }))[0] as OpticalTimeline | undefined
export function selectedOpticalScene(id?: string) {
  const scenes = opticalTimeline?.scenes ?? []
  return scenes.find(scene => scene.id === id) ?? scenes.find(scene => scene.date.slice(0, 10) >= (opticalTimeline?.event_date ?? '2026-08-30')) ?? scenes[0]
}
/** Match the main timeline without crossing the reported event boundary. */
export function opticalSceneAt(time: number, scenes: readonly OpticalScene[] = opticalTimeline?.scenes ?? [], eventDate = opticalTimeline?.event_date ?? '2026-08-30') {
  if (!Number.isFinite(time) || !scenes.length) return undefined
  const afterEvent = time >= Date.parse(eventDate)
  const sameSide = scenes.filter(scene => (Date.parse(scene.date.slice(0, 10)) >= Date.parse(eventDate)) === afterEvent)
  if (!sameSide.length) return undefined
  return sameSide.reduce((closest, scene) => Math.abs(Date.parse(scene.date) - time) < Math.abs(Date.parse(closest.date) - time) ? scene : closest)
}
export function opticalDateLabel(scene: OpticalScene) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(scene.date))
}
export function opticalEventOffset(scene: OpticalScene) {
  const days = Math.round((Date.parse(scene.date.slice(0, 10)) - Date.parse(opticalTimeline?.event_date ?? '2026-08-30')) / 86400000)
  return days === 0 ? 'Acquired on the reported landslide date' : `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ${days < 0 ? 'before' : 'after'} the reported landslide`
}
export interface InvestigationStats {
  radar_candidate_ha: number; optical_evaluable_candidate_ha: number; optical_supported_ha: number
  candidate_near_drainage_ha: number; radar_valid_ha: number
}
export interface InvestigationComparison {
  start: string; end: string; screen_file: string
  zones: Record<EvidenceZone, InvestigationStats>; places: Record<string, InvestigationStats>
}
interface Investigation {
  method: string; boundary_source: string | null; optical_interval: [string, string]; comparisons: InvestigationComparison[]
}
export const investigation = Object.values(import.meta.glob<Investigation>('../../data/balikabok_downstream/evidence/investigation.json', { eager: true, import: 'default' }))[0] as Investigation | undefined
export function selectedInvestigation(start?: string, end?: string) {
  const comparisons = investigation?.comparisons ?? []
  return comparisons.find(item => item.start === start?.slice(0, 10) && item.end === end?.slice(0, 10))
    ?? (!end ? comparisons.find(item => item.end === start?.slice(0, 10)) : undefined)
    ?? comparisons.find(item => item.start < '2026-08-30' && item.end > '2026-08-30')
}
export const screenUrls = import.meta.glob<string>('../../data/balikabok_downstream/evidence/nisar-screen-*.geojson', { eager: true, query: '?url', import: 'default' })
export function screenUrl(file: string) { return screenUrls[`../../data/balikabok_downstream/evidence/${file}`] }
export const reportedPlacesUrl = Object.values(import.meta.glob<string>('../../data/balikabok_downstream/evidence/reported-places.geojson', { eager: true, query: '?url', import: 'default' }))[0]
export interface ReportedPlace {
  type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { brgy_name: string; city_name: string; report_source: string; location_source: string; location_kind: string; status: string }
}
export const reportedPlaces = Object.values(import.meta.glob<{ features: ReportedPlace[] }>('../../data/balikabok_downstream/evidence/reported-place-references.json', { eager: true, import: 'default' }))[0]?.features ?? []
export interface RadarChange {
  start: string; end: string; highlighted_ha: number; valid_ha: number; highlighted_fraction: number | null
}
interface EvidenceSummary {
  generated_at: string
  bbox: [number, number, number, number]
  terrain: {
    source_id: string; source_url: string; resolution_m: number; acquisition_period: string; method: string; overlay: Overlay
    zones: Record<EvidenceZone, { median_slope_degrees: number }>
  }
  optical: {
    start: string; end: string; method: string; overlay: Overlay
    scenes: { id: string; date: string; source_urls: string[]; zones: Record<EvidenceZone, { valid_fraction: number }> }[]
    zones: Record<EvidenceZone, { valid_fraction: number; median_ndvi_change: number | null; vegetation_loss_ha: number }>
  }
  radar: Record<EvidenceZone, {
    observations: { date: string; median_db: number; valid_pixels: number }[]
    changes: RadarChange[]
  }>
  rainfall?: {
    product: string; units: string; method: string; source_url: string
    days: { date: string; mm: number | null; rolling3_mm: number | null; rolling7_mm: number | null }[]
  }
}
const summaries = import.meta.glob<EvidenceSummary>('../../data/balikabok_downstream/evidence/summary.json', { eager: true, import: 'default' })
export const corroboration = Object.values(summaries)[0] as EvidenceSummary | undefined
const images = import.meta.glob<string>('../../data/balikabok_downstream/evidence/*.png', { eager: true, query: '?url', import: 'default' })
export function evidenceImage(file: string) { return images[`../../data/balikabok_downstream/evidence/${file}`] }
export const drainageUrl = Object.values(import.meta.glob<string>('../../data/balikabok_downstream/evidence/drainage.geojson', { eager: true, query: '?url', import: 'default' }))[0]
export const evidenceSummaryUrl = Object.values(import.meta.glob<string>('../../data/balikabok_downstream/evidence/summary.json', { eager: true, query: '?url', import: 'default' }))[0]
export const evidenceCatalogUrl = Object.values(import.meta.glob<string>('../../data/balikabok_downstream/evidence/catalog.json', { eager: true, query: '?url', import: 'default' }))[0]

export const evidenceSources = {
  philsa: 'https://philsa.gov.ph/news/satellite-data-shows-august-30-landslide-in-subic-zambales-following-prolonged-rains/',
  noah: 'https://zenodo.org/records/22803827',
  continuingRisk: 'https://bataan.gov.ph/news/downstream-communities-urged-to-remain-alert-amid-continuing-risk/',
  earlierFlooding: 'https://bataan.gov.ph/news/sp-declares-bataan-in-state-of-calamity/?p=1461095',
  hls: 'https://hls.gsfc.nasa.gov/data-products/',
  imerg: 'https://gpm.nasa.gov/data/imerg',
}

export const reportedEvents = [
  { date: '2026-08-20', label: 'Flooding before the landslide', detail: 'Bataan declared a state of calamity during the monsoon. Earlier flood damage cannot be attributed to the August 30 landslide.', source: evidenceSources.earlierFlooding },
  { date: '2026-08-30', label: 'Reported landslide', detail: 'PhilSA reports approximately 110 ha and sediment transport at least 10 km toward Pita, Dalao and Pagalanggang. Its mapping is subject to ground validation.', source: evidenceSources.philsa },
  { date: '2026-09-03', label: 'First post-event radar observation', detail: 'Our first post-event GCOV scene is four days later. Short-lived floodwater may have receded.', source: null },
  { date: '2026-09-13', label: 'Optical comparison', detail: 'PhilSA used April 6 and September 13 Sentinel-2 imagery. Our HLS vegetation-loss layer independently compares the same dates.', source: evidenceSources.philsa },
  { date: '2026-09-17', label: 'Continuing downstream concern', detail: 'The provincial government reports remaining debris in slopes and drainage channels that could be remobilized by further rain.', source: evidenceSources.continuingRisk },
]
