import { memo } from 'react'
import type { RefObject } from 'react'
import EvidenceMapOverlay from './EvidenceMapOverlay'
import OpticalSceneOverlay from './OpticalSceneOverlay'
import { selectedOpticalScene } from '../../services/corroborationData'
import type { EvidenceSelection } from '../../services/corroborationData'
import { divIcon } from 'leaflet'
import type { LatLngTuple } from 'leaflet'
import { MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip } from 'react-leaflet'
import type { GUNWDataCache } from '../../services/gunwTypes'
import type { DashboardObservation } from './dashboardData'
import type { GCOVLayerCache } from '../../services/gcovLayerCache'
import { centerFor, locations, nameFor, worldBounds, worldViewOptions } from './dashboardUtils'
import type { RasterState } from './dashboardUtils'
import MapViewport from './MapViewport'
import RasterBlendOverlay from './RasterBlendOverlay'
import { gcovManifest } from '../../services/processGCOVData'

const markerIcon = divIcon({
  className: 'atlas-location-marker',
  html: '<span class="atlas-marker-ring"></span><span class="atlas-marker-core"></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
})

export default memo(function DashboardMap({ location, observation, cachedLayers, gunwCache, visible, attempt, onMovingChange, onSelectLocation, onRasterStatus, nextObservation, blendFraction = 0, evidenceSelection, opticalSelection, onSelectPlace }: {
  opticalSelection?: EvidenceSelection
  onSelectPlace?: (name: string) => void
  evidenceSelection?: EvidenceSelection
  nextObservation?: DashboardObservation
  blendFraction?: number
  location: string | null
  observation?: DashboardObservation
  cachedLayers: RefObject<GCOVLayerCache | null>
  gunwCache: RefObject<GUNWDataCache | null>
  visible: boolean
  onMovingChange: (moving: boolean) => void
  attempt: number
  onSelectLocation: (slug: string) => void
  onRasterStatus: (state: RasterState) => void
}) {
  const imagery = observation?.kind === 'backscatterChange' || Boolean(evidenceSelection)
  const optical = opticalSelection?.optical && opticalSelection.opticalScene ? selectedOpticalScene(opticalSelection.opticalScene) : undefined
  return (
    <MapContainer className="atlas-map" bounds={worldBounds} boundsOptions={worldViewOptions}
      zoomControl={false} dragging={false} scrollWheelZoom={false} doubleClickZoom={false}
      touchZoom={false} boxZoom={false} keyboard={false} tapHold={false}
      minZoom={1} maxZoom={19} zoomSnap={0.25} worldCopyJump>
      <TileLayer key={imagery ? 'imagery' : 'street'} className={imagery ? 'atlas-imagery-basemap' : 'atlas-basemap'}
        url={imagery ? 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'}
        attribution={imagery ? 'Imagery &copy; Esri, Maxar, Earthstar Geographics, GIS User Community' : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'} maxZoom={19}
        updateWhenIdle updateWhenZooming />
      <MapViewport location={location} onMovingChange={onMovingChange} />
      {!location && <>
        {[-60, -30, 0, 30, 60].map(latitude => <Polyline key={`lat${latitude}`}
          positions={[[latitude, -180], [latitude, 180]]} pathOptions={{ color: '#b3a38a', weight: 0.5, opacity: 0.15, interactive: false }} />)}
        {[-120, -60, 0, 60, 120].map(longitude => <Polyline key={`lon${longitude}`}
          positions={[[-80, longitude], [80, longitude]]} pathOptions={{ color: '#b3a38a', weight: 0.5, opacity: 0.15, interactive: false }} />)}
        {locations.map(([slug, observations], index) => <Marker key={slug} icon={markerIcon}
          autoPanOnFocus={false}
          position={centerFor(observations[0].bounds)} title={`Explore ${nameFor(slug)}`} alt={`Explore ${nameFor(slug)}`}
          eventHandlers={{ click: () => onSelectLocation(slug) }}>
          <Tooltip permanent direction="left" offset={[-20, (index - (locations.length - 1) / 2) * 110]} className="atlas-location-label atlas-world-location-label">
            <span className="atlas-eyebrow">Study location</span>
            <strong>{nameFor(slug)} <span aria-hidden="true">↗</span></strong>
            <span>{observations.length} observations</span>
          </Tooltip>
        </Marker>)}
      </>}
      {observation && <>
        <Polygon positions={observation.acquisition.metadata.aoi.coordinates[0].map(([lon, lat]) => [lat, lon] as LatLngTuple)}
          pathOptions={{ color: '#F65927', weight: 1.5, opacity: 0.85, fill: false, dashArray: '5 6', interactive: false }} />
        {visible && <RasterBlendOverlay observation={observation} next={nextObservation} fraction={blendFraction}
          cachedLayers={cachedLayers} gunwCache={gunwCache} onStatus={onRasterStatus} attempt={attempt} />}
      </>}
      {optical && opticalSelection && <OpticalSceneOverlay key={optical.id} scene={optical} opacity={opticalSelection.opticalOpacity} />}
      {evidenceSelection && <EvidenceMapOverlay selection={evidenceSelection} observation={observation} onSelectPlace={onSelectPlace} />}
      {!evidenceSelection && location === 'balikabok_downstream' && gcovManifest.mount_balikabok?.[0] && <><Polygon
        positions={gcovManifest.mount_balikabok[0].metadata.aoi.coordinates[0].map(([lon, lat]) => [lat, lon] as LatLngTuple)}
        pathOptions={{ color: '#e6e4dc', weight: 2, fill: false, dashArray: '7 5' }} />
        <Tooltip permanent direction="top" offset={[0, -10]} className="atlas-location-label"
          position={[gcovManifest.mount_balikabok[0].bounds[1][0], centerFor(gcovManifest.mount_balikabok[0].bounds)[1]]}>
          <strong>Mount Balikabok study area</strong>
          <span>Original clip, not the landslide boundary</span>
        </Tooltip>
      </>}
    </MapContainer>
  )
})
