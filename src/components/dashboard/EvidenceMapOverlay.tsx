import { useEffect, useRef, useState } from 'react'
import { CircleMarker, GeoJSON, Pane, Polygon, Popup, Tooltip, useMap } from 'react-leaflet'
import type { GeoJsonObject } from 'geojson'
import type { LatLngTuple } from 'leaflet'
import { corroboration, drainageUrl, reportedPlaces, screenUrl, selectedInvestigation } from '../../services/corroborationData'
import type { EvidenceSelection } from '../../services/corroborationData'
import type { TimelineItem } from './dashboardData'
import { gcovManifest } from '../../services/processGCOVData'
import { locationViewOptions } from './dashboardUtils'

export default function EvidenceMapOverlay({ selection, observation, onSelectPlace }: { selection: EvidenceSelection; observation?: TimelineItem; onSelectPlace?: (name: string) => void }) {
  const map = useMap()
  const comparison = selectedInvestigation(observation?.startAt, observation?.endAt)
  const url = selection.screen && comparison ? screenUrl(comparison.screen_file) : undefined
  const [channels, setChannels] = useState<GeoJsonObject | null>(null)
  const [screen, setScreen] = useState<{ url: string; data: GeoJsonObject } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const previousZone = useRef(selection.zone)
  useEffect(() => {
    const place = reportedPlaces.find(item => item.properties.brgy_name === selection.selectedPlace)
    if (!place) return
    const [lon, lat] = place.geometry.coordinates
    map.setView([lat, lon], 14, { animate: false })
  }, [map, selection.selectedPlace])
  useEffect(() => {
    if (previousZone.current === selection.zone) return
    previousZone.current = selection.zone
    if (selection.selectedPlace || !corroboration) return
    const [west, south, east, north] = corroboration.bbox
    const bounds = selection.zone === 'mountain' ? gcovManifest.mount_balikabok?.[0]?.bounds : [[south, west], [north, east]] as [LatLngTuple, LatLngTuple]
    if (bounds) map.fitBounds(bounds, { ...locationViewOptions(map.getSize().y), animate: false })
  }, [map, selection.zone, selection.selectedPlace])
  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    const get = async (path: string) => {
      const response = await fetch(path, { signal: controller.signal })
      if (!response.ok) throw new Error('Investigation overlay could not load')
      return response.json() as Promise<GeoJsonObject>
    }
    const work = []
    if (selection.drainage && drainageUrl) work.push(get(drainageUrl).then(setChannels))
    if (url) work.push(get(url).then(data => setScreen({ url, data })))
    void Promise.all(work).catch(() => { if (!controller.signal.aborted) setError('An investigation overlay could not load. Toggle it to retry.') })
    return () => controller.abort()
  }, [selection.drainage, url])
  const mountain = gcovManifest.mount_balikabok?.[0]?.metadata.aoi.coordinates[0].map(([lon, lat]) => [lat, lon] as LatLngTuple)
  return <>
    <Pane name="investigation-screen" style={{ zIndex: 460 }}>
      {selection.screen && screen && screen.url === url && <GeoJSON key={url} data={screen.data} style={feature => ({ color: feature?.properties.category === 2 ? '#74dfb1' : '#efa365', weight: 1, fillOpacity: .18 })}
        onEachFeature={(feature, layer) => layer.bindTooltip(feature.properties.meaning)} />}
    </Pane>
    <Pane name="investigation-vectors" style={{ zIndex: 470 }}>
      {selection.drainage && channels && <GeoJSON data={channels} style={{ color: '#79d4e1', weight: 1.4, opacity: .8, interactive: false }} />}
      {mountain && <Polygon positions={mountain} pathOptions={{ color: '#d9d8bd', weight: 1.3, dashArray: '3 5', fill: false, interactive: false }} />}
      {selection.reportedPlaces && reportedPlaces.map(place => {
        const name = place.properties.brgy_name
        const [lon, lat] = place.geometry.coordinates
        const selected = selection.selectedPlace === name
        return <CircleMarker key={name} center={[lat, lon]} radius={selected ? 9 : 6} pathOptions={{ color: '#f2b8d8', fillColor: '#9f3d76', fillOpacity: .95, weight: 2 }} eventHandlers={{ click: () => onSelectPlace?.(name) }}>
          <Tooltip direction="top">{name} · reported flooding</Tooltip>
          <Popup><strong>{name}, Dinalupihan</strong><p>Flooding reported by PhilSA. This pin locates the barangay, not an observed damage location or flood extent.</p><p><a href={place.properties.report_source} target="_blank" rel="noreferrer">Impact report</a> · <a href={place.properties.location_source} target="_blank" rel="noreferrer">Reference location</a></p></Popup>
        </CircleMarker>
      })}
    </Pane>
    {error && <div className="atlas-evidence-map-error" role="status">{error}</div>}
  </>
}
