import type { BackscatterChangeObservation } from './dashboardData'

export default function BackscatterChangeInfo({ observation }: { observation?: BackscatterChangeObservation }) {
  if (!observation) return <p className="atlas-body-copy">No compatible backscatter comparison is available.</p>
  const metadata = observation.acquisition.metadata
  return <>
    <p className="atlas-body-copy">Yellow-to-red patches highlight stronger, spatially consistent radar changes. Weak changes and small isolated patches are hidden so the landscape remains visible.</p>
    <div className="atlas-signal-legend">
      <div><span>Lower change strength</span><span>Higher change strength</span></div>
      <div className="atlas-gunw-scale atlas-gunw-scale--hotspots" aria-hidden="true" />
      <div><strong>{metadata.hotspots.threshold_db} dB</strong><strong>{metadata.hotspots.maximum_db}+ dB</strong></div>
      <p>Absolute change in locally averaged HH radar return. Same filters and scale across intervals. Background imagery is context and may be from a different date.</p>
    </div>
    <dl className="atlas-metadata">
      <div><dt>Comparison interval</dt><dd>{observation.label}</dd></div>
      <div><dt>Mission / product</dt><dd>NISAR / GCOV difference</dd></div>
      <div><dt>Polarization / units</dt><dd>HH / dB</dd></div>
      <div><dt>Compared pixels</dt><dd>{metadata.valid_pixel_count.toLocaleString()}</dd></div>
      <div><dt>Validity</dt><dd>Both dates’ quality masks</dd></div>
      <div><dt>Highlighted screening area</dt><dd>{(metadata.hotspots.highlighted_pixel_count / 100).toFixed(1)} ha</dd></div>
    </dl>
    <details><summary>How this heatmap is calculated</summary><p className="atlas-body-copy">Average linear radar intensities within a {metadata.hotspots.window_m} m neighborhood before comparing dates. Show changes of at least {metadata.hotspots.threshold_db} dB in connected patches of at least {metadata.hotspots.minimum_patch_m2 / 10000} ha. Neighborhoods require 90% valid coverage. Filtering reduces fine detail; these are exploratory display thresholds.</p></details>
    {!metadata.hotspots.highlighted_pixel_count && <p className="atlas-body-copy">No areas meet these display filters for this interval. That does not establish that no change occurred.</p>}
    <p className="atlas-caveat">This highlights radar surface-change evidence, not displacement in metres or confirmed landslides. Moisture, vegetation and land use can also produce hotspots. Highlighted area is not a measured landslide extent.</p>
    {metadata.sources.map((url,index) => <a className="atlas-source-link" key={url} href={url} target="_blank" rel="noreferrer">{index === 0 ? 'Earlier source acquisition' : 'Later source acquisition'} ↗</a>)}
  </>
}
