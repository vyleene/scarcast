import { useEffect, useRef } from 'react'
import { m, useIsPresent } from 'framer-motion'
import type { GCOVAcquisition } from '../../services/processGCOVData'
import type { GUNWAcquisition } from '../../services/gunwTypes'
import type { DashboardObservation, GUNWObservation, BackscatterChangeObservation, MapDataMode } from './dashboardData'
import { centerFor, locations, nameFor } from './dashboardUtils'
import type { DataTab, RasterState } from './dashboardUtils'
import BackscatterInfo from './BackscatterInfo'
import DeformationInfo from './DeformationInfo'
import AnalysisInfo from './AnalysisInfo'
import { dashboardFade } from './dashboardTransitions'
import type { EvidenceSelection } from '../../services/corroborationData'

export default function LocationPanel({ location, acquisition, acquisitions, pairs, observation, observations, mode, modes, status, tab, dateIndex, onTabChange, onDateChange, onModeChange, evidenceSelection, onEvidenceSelectionChange }: {
  evidenceSelection: EvidenceSelection
  onEvidenceSelectionChange: (selection: EvidenceSelection) => void
  location: string | null
  acquisition?: GCOVAcquisition
  acquisitions: readonly GCOVAcquisition[]
  pairs: readonly GUNWAcquisition[]
  observation?: GUNWObservation | BackscatterChangeObservation
  observations: readonly DashboardObservation[]
  mode: MapDataMode
  modes: readonly MapDataMode[]
  status: RasterState | null
  onModeChange: (mode: MapDataMode) => void
  tab: DataTab
  dateIndex: number
  onTabChange: (tab: DataTab) => void
  onDateChange: (index: number) => void
}) {
  const panelHeading = useRef<HTMLHeadingElement>(null)
  const isPresent = useIsPresent()
  const bounds = observation?.acquisition.bounds ?? acquisition?.bounds ?? pairs[0]?.bounds
  const center = bounds ? centerFor(bounds) : null

  useEffect(() => {
    if (location && isPresent) panelHeading.current?.focus({ preventScroll: true })
  }, [location, isPresent])

  return (
    <m.aside {...dashboardFade} className="atlas-detail-panel" aria-label="Study location information" inert={!isPresent} aria-hidden={!isPresent}>
      {center && <div className="atlas-detail-inner">
        <div className="atlas-panel-topline"><span className="atlas-eyebrow">Location</span><span>{String(locations.findIndex(([slug]) => slug === location) + 1).padStart(2, '0')} / {String(locations.length).padStart(2, '0')}</span></div>
        <p className="atlas-place-kicker">{location === 'mount_balikabok' || location === 'balikabok_downstream' ? 'Luzon, Philippines' : 'Earth observation study'}</p>
        <h1 ref={panelHeading} tabIndex={-1}>{nameFor(location!)}</h1>
        <p className="atlas-coordinates">{Math.abs(center[0]).toFixed(4)}° {center[0] >= 0 ? 'N' : 'S'} <span>/</span> {Math.abs(center[1]).toFixed(4)}° {center[1] >= 0 ? 'E' : 'W'}</p>
        <p className="atlas-location-intro">{location === 'balikabok_downstream'
          ? 'Includes the mountain study area outlined on the map and downstream parts of Dinalupihan and Hermosa. Compare August 22 with September 3 to examine changes across the August 30 landslide. These radar layers do not identify confirmed debris deposits or flooding.'
          : 'A place observed over time. Explore radar observations of this landscape, one acquisition at a time.'}</p>

        <nav className="atlas-data-tabs" aria-label="Location data">
          <button disabled={!acquisitions.length} aria-current={tab === 'backscatter' ? 'page' : undefined} onClick={() => onTabChange('backscatter')}>Backscatter</button>
          <button disabled={!pairs.length && !modes.includes('backscatterChange')} aria-current={tab === 'deformation' ? 'page' : undefined} onClick={() => onTabChange('deformation')}>Change</button>
          <button aria-current={tab === 'analysis' ? 'page' : undefined} onClick={() => onTabChange('analysis')}>Analysis</button>
        </nav>

        <m.div {...dashboardFade} className="atlas-tab-content" key={tab}>
          {tab === 'backscatter' && acquisition && <BackscatterInfo acquisition={acquisition} />}
          {tab === 'deformation' && <DeformationInfo observation={observation} mode={mode} modes={modes} status={status} onModeChange={onModeChange} />}
          {tab === 'analysis' && <AnalysisInfo location={location} observations={observations} mode={mode} dateIndex={dateIndex} onDateChange={onDateChange}
            selection={evidenceSelection} onSelectionChange={onEvidenceSelectionChange} />}
        </m.div>
        <footer className="atlas-dossier-footer"><span>SCARCAST / FIELD NOTES</span><span>NASA SPACE APPS</span></footer>
      </div>}
    </m.aside>
  )
}
