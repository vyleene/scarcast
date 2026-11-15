import { opticalDateLabel, opticalEventOffset, opticalTimeline } from '../../services/corroborationData'
import type { EvidenceSelection } from '../../services/corroborationData'

export default function OpticalAcquisitionNote({ selection }: { selection: EvidenceSelection }) {
  const scene = opticalTimeline?.scenes.find(item => item.id === selection.opticalScene)
  return <div className="atlas-optical-date-control" aria-live="polite">
    <p className="atlas-optical-date-label">{scene ? <time dateTime={scene.date}>{opticalDateLabel(scene)}</time> : 'No matching optical scene'}</p>
    <p className="atlas-timeline-baseline">Follows the main timeline.{scene && <> Nearest usable image on the same side of the event.<br />{opticalEventOffset(scene)}. Gray pixels masked.</>}</p>
  </div>
}
