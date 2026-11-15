import { m, useIsPresent } from 'framer-motion'
import { dateFor, dateFormatter, locations, nameFor } from './dashboardUtils'
import { dashboardFade } from './dashboardTransitions'

export default function LocationIndex({ onSelectLocation }: { onSelectLocation: (slug: string) => void }) {
  const isPresent = useIsPresent()
  return (
    <>
      <m.div {...dashboardFade} className="atlas-world-index" inert={!isPresent} aria-hidden={!isPresent}>
        <span className="atlas-eyebrow">The observation index</span>
        {locations.map(([slug, observations], index) => <button key={slug} onClick={() => onSelectLocation(slug)}>
          <span className="atlas-index-number">{String(index + 1).padStart(2, '0')}</span>
          <span className="atlas-index-copy"><strong>{nameFor(slug)}</strong><small>{observations.length} acquisitions · {dateFormatter.format(dateFor(observations[0].acquiredAt))} — {dateFormatter.format(dateFor(observations.at(-1)!.acquiredAt))}</small></span>
          <span className="atlas-index-arrow" aria-hidden="true">↗</span>
        </button>)}
        {locations.length === 0 && <p>No study locations available yet.</p>}
      </m.div>
      <m.footer {...dashboardFade} className="atlas-world-footer" aria-hidden={!isPresent}><span>{String(locations.length).padStart(2, '0')} STUDY {locations.length === 1 ? 'LOCATION' : 'LOCATIONS'}</span><span>SELECT A MARKER TO EXPLORE</span></m.footer>
    </>
  )
}
