import { m, useIsPresent } from 'framer-motion'
import { dashboardFade } from './dashboardTransitions'
import { dataModeLabels } from './dashboardData'
import type { MapDataMode } from './dashboardData'
import { opticalTimeline } from '../../services/corroborationData'
import type { EvidenceSelection } from '../../services/corroborationData'
import OpticalAcquisitionNote from './OpticalAcquisitionNote'

export default function MapLayerControls({ visible, mode, modes, onModeChange, onToggle, evidence, onEvidenceChange, onOpenTerrain }: {
  onOpenTerrain?: () => void
  evidence?: EvidenceSelection
  onEvidenceChange?: (selection: EvidenceSelection) => void
  visible: boolean
  mode: MapDataMode
  modes: readonly MapDataMode[]
  onModeChange: (mode: MapDataMode) => void
  onToggle: () => void
}) {
  const isPresent = useIsPresent()
  return (
    <m.div {...dashboardFade} className="atlas-overlay-toggle" inert={!isPresent} aria-hidden={!isPresent}>
      <span className="atlas-eyebrow">Map layer</span>
      <select aria-label="Map data layer" value={mode} onChange={event => onModeChange(event.target.value as MapDataMode)}>
        {modes.map(value => <option key={value} value={value}>{dataModeLabels[value]}</option>)}
      </select>
      <button role="switch" aria-label={`Show ${dataModeLabels[mode]}`} aria-checked={visible} onClick={onToggle}>
        <span className="atlas-switch-track"><span /></span> {visible ? 'Visible' : 'Hidden'}
      </button>
      {evidence && onEvidenceChange && opticalTimeline && <div className="atlas-optical-map-toggle">
        <button role="switch" aria-label="Overlay dated optical image" aria-checked={evidence.optical} onClick={() => onEvidenceChange({ ...evidence, optical: !evidence.optical })}><span className="atlas-switch-track"><span /></span> Dated optical image</button>
        {evidence.optical && <>
          <OpticalAcquisitionNote selection={evidence} />
          <label>Optical opacity <span>{Math.round(evidence.opticalOpacity * 100)}%</span><input aria-label="Optical overlay opacity" type="range" min={0} max={1} step={.05} value={evidence.opticalOpacity} onChange={event => onEvidenceChange({ ...evidence, opticalOpacity: Number(event.target.value) })} /></label>
        </>}
      </div>}
      {onOpenTerrain && <button className="atlas-terrain-launch" onClick={onOpenTerrain}>Explore debris corridor in 3D ↗</button>}
    </m.div>
  )
}
