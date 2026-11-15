import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { GridLayer, ImageOverlay } from 'leaflet'
import { useMap } from 'react-leaflet'
import type { GCOVLayerCache } from '../../services/gcovLayerCache'
import type { GUNWDataCache } from '../../services/gunwTypes'
import type { DashboardObservation } from './dashboardData'
import type { RasterState } from './dashboardUtils'
import { observationBlend } from './observationBlend'
import { createBackscatterChangeLayer } from '../../services/processBackscatterChange'

type DisplayLayer = GridLayer | ImageOverlay
function paint(layers: DisplayLayer[], value: number) {
  const weights = observationBlend(value, 2)
  layers[0]?.setOpacity(layers.length === 1 ? 0.8 : weights.sourceOpacity)
  layers[1]?.setOpacity(weights.targetOpacity)
}

export default function RasterBlendOverlay({ observation, next, fraction, cachedLayers, gunwCache, attempt, onStatus }: {
  observation: DashboardObservation
  next?: DashboardObservation
  fraction: number
  cachedLayers: RefObject<GCOVLayerCache | null>
  gunwCache: RefObject<GUNWDataCache | null>
  attempt: number
  onStatus: (state: RasterState) => void
}) {
  const map = useMap()
  const active = useRef<{ layers: DisplayLayer[]; key: string } | null>(null)
  const position = useRef(fraction)
  const key = `${observation.key}/${next?.key ?? ''}`
  useLayoutEffect(() => {
    position.current = fraction
    if (active.current?.key === key) paint(active.current.layers, fraction)
  }, [fraction, key])
  useLayoutEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    async function load(item: DashboardObservation): Promise<{ layer: DisplayLayer; data?: RasterState['data'] }> {
      if (item.kind === 'backscatterChange') return { layer: await createBackscatterChangeLayer(item.acquisition) }
      if (item.kind === 'backscatter') {
        if (!cachedLayers.current) throw new Error('Backscatter cache is not initialized.')
        return { layer: await cachedLayers.current.get(item.acquisition) }
      }
      const cache = gunwCache.current
      if (!cache) throw new Error('GUNW cache is not initialized.')
      const { baseline, acquisition, options } = item
      const [layer, data] = await Promise.all(baseline
        ? [cache.getChangeLayer(baseline, acquisition, options, signal), cache.coherenceChange(baseline, acquisition, options, signal)]
        : [cache.getLayer(acquisition, options, signal), cache.process(acquisition, options, signal)])
      return { layer, data }
    }
    void Promise.all([load(observation), ...(next ? [load(next)] : [])]).then(results => {
      if (signal.aborted) return
      const layers = results.map(result => result.layer)
      const previous = active.current?.layers ?? []
      // Keep the previous view visible until both adjacent observations are ready.
      paint(layers, position.current)
      layers.forEach((layer, index) => { layer.setZIndex(5 + index); if (!map.hasLayer(layer)) layer.addTo(map) })
      previous.filter(layer => !layers.includes(layer)).forEach(layer => layer.remove())
      active.current = { layers, key }
      onStatus({ id: observation.key, status: 'ready', data: results[0].data })
    }).catch((error: unknown) => {
      if (!signal.aborted) onStatus({ id: observation.key, status: 'error', message: error instanceof Error ? error.message : 'Unable to load comparison.' })
    })
    return () => controller.abort()
  }, [map, observation, next, cachedLayers, gunwCache, attempt, onStatus, key])
  useLayoutEffect(() => () => {
    active.current?.layers.forEach(layer => { layer.remove(); layer.setOpacity(0.8) })
    active.current = null
  }, [])
  return null
}
