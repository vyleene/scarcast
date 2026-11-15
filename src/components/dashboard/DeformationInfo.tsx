import { dataModeLabels } from './dashboardData'
import type { GUNWObservation, BackscatterChangeObservation, MapDataMode } from './dashboardData'
import BackscatterChangeInfo from './BackscatterChangeInfo'
import type { RasterState } from './dashboardUtils'

export default function DeformationInfo({ observation: selectedObservation, mode, modes, status, onModeChange }: {
  observation?: GUNWObservation | BackscatterChangeObservation
  mode: MapDataMode
  modes: readonly MapDataMode[]
  status: RasterState | null
  onModeChange: (mode: MapDataMode) => void
}) {
  const observation = selectedObservation?.kind === 'gunw' ? selectedObservation : undefined
  const controls = <div className="atlas-gunw-views" role="group" aria-label="Radar view">
    {modes.filter(value => value !== 'backscatter').map(value => <button key={value} aria-pressed={mode === value}
      onClick={() => onModeChange(value)}>{dataModeLabels[value]}</button>)}
  </div>
  if (mode === 'backscatterChange') return <>
    <div className="atlas-section-heading"><h2>Surface change heatmap</h2></div>
    {controls}
    <BackscatterChangeInfo observation={selectedObservation?.kind === 'backscatterChange' ? selectedObservation : undefined} />
  </>
  const data = status?.status === 'ready' ? status.data : undefined
  const descriptor = observation && observation.acquisition.layers[observation.options.layer!]
  const phase = mode === 'phase'
  const change = mode === 'coherenceChange'
  const min = data?.displayMin ?? observation?.options.displayMin ?? (change ? -1 : 0)
  const max = data?.displayMax ?? observation?.options.displayMax ?? 1
  const unit = phase ? ' rad' : ''
  return (
    <>
      <div className="atlas-section-heading"><span className="atlas-section-number">02</span><div><p className="atlas-eyebrow">Phase &amp; coherence</p><h2>Another view of change.</h2></div></div>
      {controls}
      {!observation || !descriptor ? <p className="atlas-body-copy">No GUNW observations are available for this view.</p> : <>
        <p className="atlas-body-copy">{phase
          ? 'Unwrapped phase captures differences in radar phase between two acquisitions. Only pixels passing the exported phase-quality mask are shown.'
          : change ? 'This view subtracts baseline coherence from the later pair. Red shows coherence loss; blue shows an increase. Only pixels valid in both pairs are compared.'
          : 'Coherence describes how consistently the radar signal matches between two acquisitions. Low-coherence areas remain visible because they may contain surface-change information.'}</p>
        <div className="atlas-signal-legend">
          <div><span>{phase ? 'Negative phase' : change ? 'Coherence loss' : 'Low coherence'}</span><span>{phase ? 'Positive phase' : change ? 'Coherence increase' : 'High coherence'}</span></div>
          <div className={`atlas-gunw-scale atlas-gunw-scale--${mode}`} aria-hidden="true" />
          <div><strong>{min.toFixed(2)}{unit}</strong>{(phase || change) && <strong>0{unit}</strong>}<strong>{max.toFixed(2)}{unit}</strong></div>
          <p>{phase ? 'A common display stretch is used across pairs. Separate connected components may have independent phase offsets.' : change ? 'Difference in coherence, later minus baseline. This is not a displacement or landslide probability.' : 'Normalized coherence from 0 to 1; this is not a landslide probability.'}</p>
        </div>
        <dl className="atlas-metadata">
          <div><dt>Selected pair</dt><dd>{observation.label}</dd></div>
          {observation.baselineLabel && <div><dt>Baseline pair</dt><dd>{observation.baselineLabel}</dd></div>}
          <div><dt>Mission / product</dt><dd>NISAR / GUNW</dd></div>
          <div><dt>Orbit direction</dt><dd>{observation.acquisition.metadata.identification.orbitPassDirection}</dd></div>
          <div><dt>Frequency / polarization</dt><dd>{observation.acquisition.frequency} / {descriptor.polarization}</dd></div>
          <div><dt>Grid posting</dt><dd>{Math.abs(descriptor.gridMetadata.transform[0])} × {Math.abs(descriptor.gridMetadata.transform[4])} m</dd></div>
          <div><dt>Raster dimensions</dt><dd>{descriptor.gridMetadata.shape[1]} × {descriptor.gridMetadata.shape[0]} px</dd></div>
          {phase && <div><dt>Phase quality mask</dt><dd>Applied · coherence ≥ {observation.acquisition.metadata.frequencies[observation.acquisition.frequency].coherence_threshold}</dd></div>}
        </dl>
        <p className="atlas-caveat">{phase ? 'Phase is in radians. Atmospheric corrections, a stable spatial reference and component-offset reconciliation are required before interpreting it as ground displacement.'
          : 'Coherence can change with vegetation, moisture and other surface disturbances. Check terrain and other observations before attributing a change to a landslide.'}</p>
        <a className="atlas-source-link" href={observation.acquisition.metadata.source} target="_blank" rel="noreferrer">View source pair <span aria-hidden="true">↗</span></a>
        {observation.baseline && <a className="atlas-source-link" href={observation.baseline.metadata.source} target="_blank" rel="noreferrer">View baseline pair <span aria-hidden="true">↗</span></a>}
      </>}
    </>
  )
}
