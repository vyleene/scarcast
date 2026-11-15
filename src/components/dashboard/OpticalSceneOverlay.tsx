import { useState } from 'react'
import { ImageOverlay, Pane, Rectangle } from 'react-leaflet'
import { corroboration, evidenceImage } from '../../services/corroborationData'
import type { OpticalScene } from '../../services/corroborationData'

export default function OpticalSceneOverlay({ scene, opacity }: { scene: OpticalScene; opacity: number }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  if (!corroboration) return null
  const [west, south, east, north] = corroboration.bbox
  const url = evidenceImage(scene.overlay.file)
  return <>
    <Pane name="optical-backdrop" style={{ zIndex: 420 }}>{status !== 'ready' && <Rectangle bounds={[[south, west], [north, east]]} pathOptions={{ fillColor: '#232725', fillOpacity: opacity, stroke: false, interactive: false }} />}</Pane>
    <Pane name="optical-imagery" style={{ zIndex: 430 }}>
      {url && <ImageOverlay key={`${scene.id}/${attempt}`} url={url} bounds={scene.overlay.bounds} opacity={opacity} interactive={false}
        eventHandlers={{ load: () => setStatus('ready'), error: () => setStatus('error') }} />}
    </Pane>
    {status !== 'ready' && <div className="atlas-evidence-map-error" role="status">{status === 'loading' ? 'Loading dated optical scene…' : <><span>Optical scene could not load. </span><button onClick={() => { setStatus('loading'); setAttempt(value => value + 1) }}>Retry</button></>}</div>}
  </>
}
