import type { MapDataMode, TimelineItem } from './dashboardData'
import { corroboration, evidenceSources, evidenceZoneLabels, initialEvidenceSelection, investigation, opticalDateLabel, opticalEventOffset, opticalTimeline, reportedPlaces, selectedInvestigation, selectedOpticalScene } from '../../services/corroborationData'
import type { EvidenceSelection, EvidenceZone } from '../../services/corroborationData'

const day = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
const number = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value)

export default function AnalysisInfo({ observations, dateIndex, onDateChange, location, selection = initialEvidenceSelection, onSelectionChange }: {
  observations: readonly TimelineItem[]; mode: MapDataMode; dateIndex: number; onDateChange: (index: number) => void
  location?: string | null; selection?: EvidenceSelection; onSelectionChange?: (selection: EvidenceSelection) => void
}) {
  if (location !== 'balikabok_downstream' || !corroboration) return <>
    <div className="atlas-section-heading"><h2>Observation dates</h2></div>
    {location === 'mount_balikabok' && <p className="atlas-body-copy">Open “Mount Balikabok and downstream area” for the combined investigation.</p>}
    <ol className="atlas-observation-list">{observations.map((item, index) => <li key={item.key}><button onClick={() => onDateChange(index)} aria-pressed={dateIndex === index}><span>{index + 1}</span><span>{item.label}</span><span>View ↗</span></button></li>)}</ol>
  </>
  const observation = observations[dateIndex]
  const comparison = selectedInvestigation(observation?.startAt, observation?.endAt)
  const stats = comparison?.zones[selection.zone]
  const optical = selection.opticalScene ? selectedOpticalScene(selection.opticalScene) : undefined
  const update = (patch: Partial<EvidenceSelection>) => onSelectionChange?.({ ...selection, ...patch })
  return <div className="atlas-investigation">
    <div className="atlas-section-heading"><h2>What happened downstream?</h2></div>
    <p className="atlas-body-copy">Prolonged rain preceded the August 30 slide. PhilSA reports that sediment entered streams, traveled at least 10 km and contributed to flooding in Pita, Dalao and Pagalanggang. Use the map to check the satellite evidence against these reports. <a href={evidenceSources.philsa} target="_blank" rel="noreferrer">Source ↗</a></p>

    <div className="atlas-analysis-overlays" aria-label="Investigation overlays">
      <label className="atlas-evidence-toggle"><input type="checkbox" checked={selection.optical} onChange={event => update({ optical: event.target.checked })} />Overlay dated optical imagery</label>
      <label className="atlas-evidence-toggle"><input type="checkbox" checked={selection.screen} onChange={event => update({ screen: event.target.checked })} />Check NISAR candidates against vegetation loss</label>
      <label className="atlas-evidence-toggle"><input type="checkbox" checked={selection.drainage} onChange={event => update({ drainage: event.target.checked })} /><span className="atlas-drainage-swatch" />Show terrain-derived waterways</label>
      <label className="atlas-evidence-toggle"><input type="checkbox" checked={selection.reportedPlaces} onChange={event => update({ reportedPlaces: event.target.checked })} />Show places with reported flooding</label>
    </div>
    {selection.optical && optical && <p className="atlas-evidence-note"><strong>Optical overlay: {opticalDateLabel(optical)}</strong> · {optical.sensor}, 30 m.<br />{opticalEventOffset(optical)}. Gray pixels are masked. The image follows the main timeline; its actual acquisition date is shown.</p>}
    <p className="atlas-evidence-note">Toggle optical imagery on the map and use the main slider to move through time. Adjust its opacity to compare it with the selected radar layer.</p>

    <section className="atlas-evidence-section" aria-labelledby="agreement-heading">
      <h3 id="agreement-heading">Do the observations agree?</h3>
      <label className="atlas-evidence-label" htmlFor="evidence-area">Summarize an area</label>
      <select id="evidence-area" value={selection.zone} onChange={event => update({ zone: event.target.value as EvidenceZone, selectedPlace: undefined })}>{Object.entries(evidenceZoneLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      {comparison && stats && <>
        <p className="atlas-evidence-note">NISAR screen: <strong>{day(comparison.start)}–{day(comparison.end)} 2026</strong><br />Optical vegetation check: <strong>6 Apr–13 Sept 2026</strong></p>
        <div className="atlas-screen-legend"><span><i className="atlas-screen-supported" />NISAR change + optical vegetation loss</span><span><i className="atlas-screen-only" />NISAR change; optical support absent or unavailable</span></div>
        <dl className="atlas-metadata"><div><dt>NISAR candidate area</dt><dd>{number(stats.radar_candidate_ha)} ha</dd></div><div><dt>Could be checked in clear optical pixels</dt><dd>{number(stats.optical_evaluable_candidate_ha)} ha</dd></div><div><dt>Also shows optical vegetation loss</dt><dd>{number(stats.optical_supported_ha)} ha</dd></div><div><dt>Candidates within 100 m of derived waterways</dt><dd>{number(stats.candidate_near_drainage_ha)} ha</dd></div></dl>
        <p className="atlas-evidence-note">Colored outlines are a NISAR disturbance screen checked against independent optical evidence. Spatial agreement is not confirmation of a landslide or its timing. Cloud gaps remain unknown.</p>
      </>}
      <p className="atlas-evidence-note">The mountain area is the original extraction clip, not the scar boundary. The surrounding study area is not a delineated watershed.</p>
    </section>

    <section className="atlas-evidence-section" aria-labelledby="consequences-heading">
      <h3 id="consequences-heading">Which places were reported affected?</h3>
      <p className="atlas-evidence-note">Select a barangay to locate it alongside the satellite screen and waterways.</p>
      <div className="atlas-reported-places">{reportedPlaces.map(place => <button key={place.properties.brgy_name} aria-pressed={selection.selectedPlace === place.properties.brgy_name} onClick={() => update({ selectedPlace: place.properties.brgy_name, reportedPlaces: true })}><strong>{place.properties.brgy_name}</strong><span>Dinalupihan · reported flooding</span><span aria-hidden="true">↗</span></button>)}</div>
      <p className="atlas-evidence-note">Pins are approximate barangay reference locations. PhilSA reports flooding in these barangays; neither the pins nor nearby radar change establish the flooded boundary, damaged homes or people affected.</p>
      <a className="atlas-evidence-source" href={evidenceSources.philsa} target="_blank" rel="noreferrer">PhilSA downstream impact report ↗</a>
      <p className="atlas-body-copy">Remaining debris in slopes and channels could be remobilized by further rain, according to the provincial assessment. The waterways layer helps inspect nearby change candidates; it does not simulate debris transport or predict flooding. <a href={evidenceSources.continuingRisk} target="_blank" rel="noreferrer">Assessment ↗</a></p>
    </section>

    <section className="atlas-evidence-section" aria-labelledby="rainfall-heading">
      <h3 id="rainfall-heading">How did the rainfall build up?</h3>
      <table><caption>Abucay gauge totals reported by UP NOAH / August 2026</caption><thead><tr><th>Period</th><th>Rainfall</th><th>Event context</th></tr></thead><tbody><tr><td>8–9 Aug</td><td>292.3 mm</td><td>Earlier wet period</td></tr><tr><td>17–19 Aug</td><td>347.1 mm</td><td>Further rainfall</td></tr><tr className="atlas-rain-event"><td>28–29 Aug</td><td>368.6 mm</td><td>Immediately before slide</td></tr><tr><td>Full August</td><td>2,210.4 mm</td><td>Monthly total</td></tr></tbody></table>
      <ol className="atlas-evidence-events"><li><time dateTime="2026-08-20">20 Aug</time><div><strong>Flooding already reported</strong><p>Bataan declared a state of calamity before the landslide. Earlier monsoon damage must be kept separate.</p><a href={evidenceSources.earlierFlooding} target="_blank" rel="noreferrer">Source ↗</a></div></li><li><time dateTime="2026-08-30">30 Aug</time><div><strong>Reported slope failure and downstream cascade</strong><p>The final rainfall pulse preceded the slide. The report connects the collapse, debris transport and downstream flooding.</p></div></li><li><time dateTime="2026-09-03">3 Sept</time><div><strong>First post-event radar observation</strong><p>Four days after the slide; short-lived floodwater may already have receded.</p></div></li></ol>
      <p className="atlas-evidence-note">Published gauge observations, not IMERG estimates. Abucay is not at the mountain, and these unequal-length totals are not a calibrated warning threshold.</p><a className="atlas-evidence-source" href={evidenceSources.noah} target="_blank" rel="noreferrer">UP NOAH rainfall and cascade report ↗</a>
    </section>

    <details className="atlas-evidence-section"><summary>Methods and evidence limits</summary><p>{investigation?.method}</p><p>Actual optical frames: {opticalTimeline?.scenes.map(scene => day(scene.date)).join(', ')} 2026. No usable August 30 frame is included. Radar, optical and rainfall observations have different dates and resolutions. Reports supply impact evidence; the satellite screen supplies candidate surface changes.</p><p>{opticalTimeline?.method}</p><p>Historical NASADEM is used to derive waterway context.</p></details>
  </div>
}
