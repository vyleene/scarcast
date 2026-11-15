import type { GCOVAcquisition } from '../../services/processGCOVData'
import type { GUNWAcquisition, GUNWProcessOptions } from '../../services/gunwTypes'
import { dateFor, dateFormatter, shortDateFormatter } from './dashboardUtils'
import { backscatterChangeManifest } from '../../services/processBackscatterChange'
import type { BackscatterChangeAcquisition } from '../../services/processBackscatterChange'

export type MapDataMode = 'backscatter' | 'backscatterChange' | 'phase' | 'coherence' | 'coherenceChange'
export const dataModeLabels: Record<MapDataMode, string> = {
  backscatter: 'Backscatter', backscatterChange: 'Surface change heatmap', phase: 'Unwrapped phase', coherence: 'Coherence', coherenceChange: 'Coherence change',
}
export interface TimelineItem {
  key: string
  startAt: string
  endAt?: string
  label: string
  shortLabel: string
  baselineLabel?: string
}
interface BackscatterObservation extends TimelineItem { kind: 'backscatter'; acquisition: GCOVAcquisition }
export interface BackscatterChangeObservation extends TimelineItem { kind: 'backscatterChange'; acquisition: BackscatterChangeAcquisition }
export interface GUNWObservation extends TimelineItem {
  kind: 'gunw'
  mode: 'phase' | 'coherence' | 'coherenceChange'
  acquisition: GUNWAcquisition
  /** Earlier baseline; acquisition is always the later pair in change mode. */
  baseline?: GUNWAcquisition
  options: GUNWProcessOptions
}
export type DashboardObservation = BackscatterObservation | BackscatterChangeObservation | GUNWObservation

export function pairLabel(pair: GUNWAcquisition, short = false) {
  const formatter = short ? shortDateFormatter : dateFormatter
  return `${formatter.format(dateFor(pair.referenceAt))} – ${formatter.format(dateFor(pair.secondaryAt))}`
}

function layerKey(pair: GUNWAcquisition, mode: MapDataMode) {
  const candidates = Object.values(pair.layers)
  if (mode === 'phase') return candidates.find(layer => layer.name === 'unwrappedPhase'
    && pair.layers[`${layer.grid}/${layer.polarization}/phase_valid_mask`])?.key
  return (candidates.find(layer => layer.name === 'coherenceMagnitude' && layer.grid === 'wrappedInterferogram')
    ?? candidates.find(layer => layer.name === 'coherenceMagnitude'))?.key
}

export function dashboardObservations(backscatter: readonly GCOVAcquisition[], pairs: readonly GUNWAcquisition[], mode: MapDataMode): DashboardObservation[] {
  if (mode === 'backscatter') return backscatter.map(acquisition => ({
    kind: 'backscatter', key: acquisition.id, acquisition, startAt: acquisition.acquiredAt,
    label: dateFormatter.format(dateFor(acquisition.acquiredAt)), shortLabel: shortDateFormatter.format(dateFor(acquisition.acquiredAt)),
  }))
  if (mode === 'backscatterChange') {
    const available = new Set(backscatter.map(item => item.id))
    return (backscatterChangeManifest[backscatter[0]?.location] ?? []).filter(item => available.has(item.metadata.before_id) && available.has(item.metadata.after_id)).map(acquisition => {
      const startAt = acquisition.metadata.start_at, endAt = acquisition.metadata.end_at
      return { kind: 'backscatterChange', acquisition, key: `backscatterChange/${acquisition.location}/${acquisition.id}`, startAt, endAt,
        label: `${dateFormatter.format(dateFor(startAt))} – ${dateFormatter.format(dateFor(endAt))}`,
        shortLabel: `${shortDateFormatter.format(dateFor(startAt))} – ${shortDateFormatter.format(dateFor(endAt))}` }
    })
  }
  // A shared stretch makes colours comparable across pairs (phase itself remains unreferenced).
  const phaseLimit = Math.max(1, ...pairs.flatMap(pair => Object.values(pair.layers)
    .filter(layer => layer.name === 'unwrappedPhase').flatMap(layer => [Math.abs(layer.metadata.visualization?.min ?? 0), Math.abs(layer.metadata.visualization?.max ?? 0)])))
  return pairs.flatMap((acquisition, index) => {
    const key = layerKey(acquisition, mode)
    if (!key) return []
    const baseline = mode === 'coherenceChange' ? pairs[index - 1] : undefined
    if (mode === 'coherenceChange') {
      if (!baseline?.layers[key] || baseline.frequency !== acquisition.frequency
        || Date.parse(baseline.secondaryAt) > Date.parse(acquisition.referenceAt)) return []
      const identity = ['trackNumber', 'frameNumber', 'orbitPassDirection', 'lookDirection']
      if (identity.some(name => baseline.metadata.identification[name] !== acquisition.metadata.identification[name])) return []
      const duration = (pair: GUNWAcquisition) => Date.parse(pair.secondaryAt) - Date.parse(pair.referenceAt)
      if (Math.abs(duration(baseline) - duration(acquisition)) > 60000) return []
      const a = baseline.layers[key].gridMetadata, b = acquisition.layers[key].gridMetadata
      if (a.source_crs !== b.source_crs || JSON.stringify(a.shape) !== JSON.stringify(b.shape) || JSON.stringify(a.transform) !== JSON.stringify(b.transform)) return []
    }
    return [{
      kind: 'gunw', mode, acquisition, baseline, key: `${acquisition.location}/${acquisition.id}/${acquisition.frequency}/${mode}/${key}/${baseline?.id ?? ''}`,
      options: { layer: key, ...(mode === 'phase' ? { displayMin: -phaseLimit, displayMax: phaseLimit } : {}) },
      startAt: acquisition.referenceAt, endAt: acquisition.secondaryAt,
      label: pairLabel(acquisition), shortLabel: pairLabel(acquisition, true),
      baselineLabel: baseline ? pairLabel(baseline) : undefined,
    }]
  })
}
