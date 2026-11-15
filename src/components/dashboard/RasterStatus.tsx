import { dataModeLabels } from './dashboardData'
import type { MapDataMode } from './dashboardData'
import type { RasterState } from './dashboardUtils'

export default function RasterStatus({ visible, mode, status, onRetry }: {
  visible: boolean
  mode: MapDataMode
  status: RasterState | null
  onRetry: () => void
}) {
  return (
    <div className="atlas-raster-status" role="status" aria-live="polite">
      {!visible ? 'Base map · observation hidden' : status?.status === 'error' ? <>
        <span>Observation could not load.</span><button onClick={onRetry} title={status.message}>Try again ↻</button>
      </> : status?.status === 'ready' ? <><span className="atlas-live-dot" /> {dataModeLabels[mode]} · {mode === 'backscatter' ? 'HHHH · dB' : mode === 'backscatterChange' ? 'HH · ΔdB' : mode === 'phase' ? 'radians' : mode === 'coherence' ? '0–1' : 'later − baseline'}</> : <><span className="atlas-loading-dot" /> Loading observation…</>}
    </div>
  )
}
