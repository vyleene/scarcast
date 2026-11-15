import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import 'leaflet/dist/leaflet.css'
import '../assets/styles/dashboard/index.css'
import { gcovManifest } from '../services/processGCOVData'
import { createGCOVLayerCache } from '../services/gcovLayerCache'
import type { GCOVLayerCache } from '../services/gcovLayerCache'
import { createGUNWDataCache, getGUNWAcquisitions, gunwManifest } from '../services/processGUNWData'
import type { GUNWDataCache } from '../services/gunwTypes'
import { locationViewOptions, nameFor } from '../components/dashboard/dashboardUtils'
import { dashboardObservations } from '../components/dashboard/dashboardData'
import type { MapDataMode } from '../components/dashboard/dashboardData'
import type { DataTab, RasterState } from '../components/dashboard/dashboardUtils'
import DashboardMap from '../components/dashboard/DashboardMap'
import DashboardMotion from '../components/dashboard/DashboardMotion'
import MapHeader from '../components/dashboard/MapHeader'
import LocationIndex from '../components/dashboard/LocationIndex'
import MapLayerControls from '../components/dashboard/MapLayerControls'
import RasterStatus from '../components/dashboard/RasterStatus'
import ObservationTimeline from '../components/dashboard/ObservationTimeline'
import LocationPanel from '../components/dashboard/LocationPanel'
import { observationBlend } from '../components/dashboard/observationBlend'
import { clearBackscatterChangeCache } from '../services/processBackscatterChange'
import { initialEvidenceSelection, opticalSceneAt } from '../services/corroborationData'
import type { EvidenceSelection } from '../services/corroborationData'
const DebrisTerrainView = lazy(() => import('../components/dashboard/DebrisTerrainView'))

const emptyBackscatter: NonNullable<typeof gcovManifest[string]> = []
const emptyPairs: ReturnType<typeof getGUNWAcquisitions> = []

export default function DashboardPage() {
  const [location, setLocation] = useState<string | null>(null)
  const [terrainOpen, setTerrainOpen] = useState(false)
  const [dateIndex, setDateIndex] = useState(0)
  const [pairIndex, setPairIndex] = useState(0)
  const [comparisonIndex, setComparisonIndex] = useState(0)
  const [backscatterChangeIndex, setBackscatterChangeIndex] = useState(0)
  const [mode, setMode] = useState<MapDataMode>('backscatter')
  const [tab, setTab] = useState<DataTab>('backscatter')
  const [evidenceSelection, setEvidenceSelection] = useState<EvidenceSelection>(initialEvidenceSelection)
  const [visible, setVisible] = useState(true)
  const [rasterState, setRasterState] = useState<RasterState | null>(null)
  const [attempt, setAttempt] = useState(0)
  const cachedLayers = useRef<GCOVLayerCache | null>(null)
  const gunwCache = useRef<GUNWDataCache | null>(null)
  const dashboard = useRef<HTMLElement>(null)
  const acquisitions = (location && gcovManifest[location]) || emptyBackscatter
  const pairs = (location && gunwManifest[location]) || emptyPairs
  const views = useMemo(() => ({
    backscatter: dashboardObservations(acquisitions, pairs, 'backscatter'),
    backscatterChange: dashboardObservations(acquisitions, pairs, 'backscatterChange'),
    phase: dashboardObservations(acquisitions, pairs, 'phase'),
    coherence: dashboardObservations(acquisitions, pairs, 'coherence'),
    coherenceChange: dashboardObservations(acquisitions, pairs, 'coherenceChange'),
  }), [acquisitions, pairs])
  const modes = useMemo(() => (Object.keys(views) as MapDataMode[]).filter(value => views[value].length > 0), [views])
  const observations = views[mode]
  const activeIndex = Math.min(mode === 'backscatter' ? dateIndex : mode === 'backscatterChange' ? backscatterChangeIndex : mode === 'coherenceChange' ? comparisonIndex : pairIndex, Math.max(0, observations.length - 1))
  const blend = observationBlend(activeIndex, observations.length)
  const observation = observations[blend.index]
  const nextObservation = blend.nextIndex !== blend.index ? observations[blend.nextIndex] : undefined
  const observationTime = observation ? Date.parse(observation.endAt ?? observation.startAt) : NaN
  const nextTime = nextObservation ? Date.parse(nextObservation.endAt ?? nextObservation.startAt) : observationTime
  const opticalScene = opticalSceneAt(observationTime + (nextTime - observationTime) * blend.fraction)
  const syncedEvidenceSelection = { ...evidenceSelection, opticalScene: opticalScene?.id }
  const detailObservation = observation?.kind !== 'backscatter' ? observation : undefined
  const acquisition = acquisitions[Math.floor(dateIndex)]
  const status = rasterState?.id === observation?.key ? rasterState : null
  const evidenceActive = location === 'balikabok_downstream' && tab === 'analysis'
  const backToWorld = useCallback(() => setLocation(null), [])
  const onMovingChange = useCallback((moving: boolean) => {
    cachedLayers.current?.setMoving(moving)
    gunwCache.current?.setMoving(moving)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const mobile = window.matchMedia('(max-width: 700px)').matches
    const width = dashboard.current?.clientWidth ?? window.innerWidth
    const height = mobile ? Math.max(420, window.innerHeight * 0.58)
      : dashboard.current?.clientHeight ?? window.innerHeight
    const cache = createGCOVLayerCache(controller.signal, {
      width: mobile ? width : width / 2,
      height,
      fitOptions: locationViewOptions(height),
    })
    cachedLayers.current = cache
    const gunw = createGUNWDataCache()
    gunwCache.current = gunw
    // Keep the existing backscatter startup work first; warm GUNW data sequentially.
    void cache.preload(Object.values(gcovManifest).flat()).then(async () => {
      for (const observations of Object.values(gunwManifest)) {
        for (const pair of observations) {
          if (controller.signal.aborted) return
          const keys = [...new Set(['phase', 'coherence'].flatMap(value =>
            dashboardObservations([], [pair], value as MapDataMode).flatMap(item => item.kind === 'gunw' && item.options.layer ? [item.options.layer] : [])))]
          await gunw.preload([pair], keys, controller.signal)
        }
      }
    }).catch(() => { /* Selected layers retry preload failures through the cache. */ })
    return () => {
      controller.abort()
      gunw.clear()
      clearBackscatterChangeCache()
      if (gunwCache.current === gunw) gunwCache.current = null
      if (cachedLayers.current === cache) cachedLayers.current = null
    }
  }, [])

  const selectLocation = useCallback((slug: string) => {
    setTerrainOpen(false)
    setEvidenceSelection(initialEvidenceSelection)
    setComparisonIndex(0)
    const nextBackscatter = gcovManifest[slug] ?? emptyBackscatter
    const nextPairs = getGUNWAcquisitions(slug)
    setBackscatterChangeIndex(Math.max(0, dashboardObservations(nextBackscatter, nextPairs, 'backscatterChange').findIndex(item => item.startAt.startsWith('2026-08-22') && item.endAt?.startsWith('2026-09-03'))))
    setDateIndex(slug === 'balikabok_downstream'
      ? Math.max(0, nextBackscatter.findIndex(item => item.acquiredAt.startsWith('2026-09-03'))) : 0)
    setPairIndex(slug === 'balikabok_downstream'
      ? Math.max(0, nextPairs.findIndex(item => item.referenceAt.startsWith('2026-08-22') && item.secondaryAt.startsWith('2026-09-03'))) : 0)
    const firstMode = (['backscatter', 'phase', 'coherence'] as const).find(value => dashboardObservations(nextBackscatter, nextPairs, value).length) ?? 'backscatter'
    setMode(firstMode)
    setTab(firstMode === 'backscatter' ? 'backscatter' : 'deformation')
    setVisible(true)
    setRasterState(null)
    setLocation(slug)
  }, [])

  const onModeChange = useCallback((value: MapDataMode) => {
    if (!modes.includes(value)) return
    setMode(value)
    setTab(current => current === 'analysis' ? current : value === 'backscatter' ? 'backscatter' : 'deformation')
    setVisible(true)
    setRasterState(null)
  }, [modes])

  function onTabChange(value: DataTab) {
    if (value === 'backscatter') { onModeChange('backscatter'); setTab(value) }
    else if (value === 'deformation' && mode === 'backscatter') {
      const next = modes.find(candidate => candidate !== 'backscatter')
      if (next) onModeChange(next)
      setTab(value)
    } else setTab(value)
  }

  function onDateChange(index: number) {
    if (index < 0 || index >= observations.length) return
    if (mode === 'backscatter') setDateIndex(index)
    else if (mode === 'backscatterChange') setBackscatterChangeIndex(index)
    else if (mode === 'coherenceChange') setComparisonIndex(index)
    else setPairIndex(index)
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (terrainOpen) setTerrainOpen(false)
        else backToWorld()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [backToWorld, terrainOpen])

  return (
    <DashboardMotion>
      <main ref={dashboard} className={`atlas${location ? ' atlas--focused' : ''}`}>
        <section className="atlas-map-stage" aria-label={location ? `Map of ${nameFor(location)}` : 'World study map'}>
          <DashboardMap location={location} observation={observation} cachedLayers={cachedLayers} gunwCache={gunwCache}
            evidenceSelection={evidenceActive ? syncedEvidenceSelection : undefined}
            opticalSelection={location === 'balikabok_downstream' ? syncedEvidenceSelection : undefined}
            onSelectPlace={name => setEvidenceSelection(value => ({ ...value, selectedPlace: name }))}
            nextObservation={nextObservation} blendFraction={blend.fraction}
            visible={visible} attempt={attempt} onMovingChange={onMovingChange}
            onSelectLocation={selectLocation} onRasterStatus={setRasterState} />
          <MapHeader location={location} onBack={backToWorld} />
          <AnimatePresence initial={false}>
            {!location && <LocationIndex key="locations" onSelectLocation={selectLocation} />}
            {observation && <MapLayerControls key="layer-controls" visible={visible} mode={mode} modes={modes} onModeChange={onModeChange}
              onOpenTerrain={location === 'balikabok_downstream' || location === 'mount_balikabok' ? () => setTerrainOpen(true) : undefined}
              evidence={location === 'balikabok_downstream' ? syncedEvidenceSelection : undefined} onEvidenceChange={setEvidenceSelection}
              onToggle={() => setVisible(value => !value)} />}
            {observation && <ObservationTimeline key="timeline" items={observations}
              heading={mode === 'backscatter' ? 'Observation date' : mode === 'backscatterChange' ? 'Backscatter comparison' : mode === 'coherenceChange' ? 'Coherence comparison' : 'Observation pair'}
              dateIndex={activeIndex} onDateChange={onDateChange}>
              <RasterStatus visible={visible} mode={mode} status={status}
                onRetry={() => { setRasterState(null); setAttempt(value => value + 1) }} />
            </ObservationTimeline>}
          </AnimatePresence>
          {terrainOpen && (location === 'balikabok_downstream' || location === 'mount_balikabok') && <Suspense fallback={<div className="atlas-terrain-view">Loading terrain…</div>}><DebrisTerrainView onClose={() => setTerrainOpen(false)} /></Suspense>}
        </section>
        <AnimatePresence>
          {location && <LocationPanel key={location} location={location} acquisition={acquisition} acquisitions={acquisitions}
            pairs={pairs} observation={detailObservation} observations={observations} mode={mode} modes={modes} status={status} onModeChange={onModeChange}
            evidenceSelection={syncedEvidenceSelection} onEvidenceSelectionChange={setEvidenceSelection}
            tab={tab} dateIndex={blend.index} onTabChange={onTabChange} onDateChange={onDateChange} />}
        </AnimatePresence>
      </main>
    </DashboardMotion>
  )
}
