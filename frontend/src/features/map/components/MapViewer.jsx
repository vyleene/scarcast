import { useEffect, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const INITIAL_CENTER = [12.5, 122.5];
const VIEW_KEY = "scarcast.map.camera.v2";
const ESRI_CURRENT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ATTRIBUTION = 'Tiles &copy; Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

function readSavedView() {
  try {
    const value = JSON.parse(sessionStorage.getItem(VIEW_KEY) || "null");
    if (value && Array.isArray(value.center) && value.center.length === 2 &&
      value.center.every(Number.isFinite) && Number.isFinite(value.zoom)) return value;
  } catch { /* Browser storage may be disabled. */ }
  return { center: INITIAL_CENTER, zoom: 6 };
}

function CameraPersistence() {
  const map = useMapEvents({
    moveend() { save(); },
    zoomend() { save(); },
  });
  function save() {
    try {
      const center = map.getCenter();
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({
        center: [center.lat, center.lng], zoom: map.getZoom(),
      }));
    } catch { /* Ignore disabled browser storage. */ }
  }
  return null;
}

function toLeafletWaybackURL(release) {
  if (!release?.itemURL) return ESRI_CURRENT;
  // Official Esri Wayback itemURL is a WMTS URL template.
  return release.itemURL
    .replaceAll("{level}", "{z}")
    .replaceAll("{row}", "{y}")
    .replaceAll("{col}", "{x}");
}

function MapResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const updateSize = () => map.invalidateSize({ pan: false, debounceMoveend: true });
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    updateSize();
    return () => observer.disconnect();
  }, [map]);

  return null;
}

function MapInteractions({ mode, selectionActive, onMapClick, focusTarget }) {
  const map = useMapEvents({
    click(event) {
      if (mode === "explore" && selectionActive) {
        onMapClick([event.latlng.lat, event.latlng.lng]);
      }
    },
  });

  useEffect(() => {
    if (!focusTarget) return;
    map.flyTo(focusTarget.center, focusTarget.zoom ?? 11, { duration: 0.65 });
  }, [map, focusTarget]);

  return null;
}

export default function MapViewer({
  mode,
  selectionActive,
  studySites,
  selectedCaseId,
  onSelectCase,
  area,
  onSetCenter,
  focusTarget,
  historicalRelease,
}) {
  const [initialView] = useState(readSavedView);
  return (
    <MapContainer
      center={initialView.center}
      zoom={initialView.zoom}
      minZoom={3}
      maxZoom={18}
      scrollWheelZoom
      zoomControl
      className="scar-map-canvas"
    >
      <TileLayer
        key={historicalRelease ? `wayback-${historicalRelease.releaseNum}` : "current"}
        url={toLeafletWaybackURL(historicalRelease)}
        attribution={ATTRIBUTION}
        maxNativeZoom={16}
        maxZoom={18}
      />
      <MapResizeHandler />
      <CameraPersistence />
      <MapInteractions mode={mode} selectionActive={selectionActive} onMapClick={onSetCenter} focusTarget={focusTarget} />

      {area && (
        <>
          <Circle
            center={area.center}
            radius={area.radiusMeters}
            pathOptions={{ color: "#F65927", weight: 2, fillColor: "#F65927", fillOpacity: 0.12 }}
            interactive={false}
          />
          <CircleMarker
            center={area.center}
            radius={5}
            pathOptions={{ color: "#fff0e3", weight: 2, fillColor: "#F65927", fillOpacity: 1 }}
            interactive={false}
          />
        </>
      )}

      {mode === "cases" &&
        studySites.map((site) => (
          <CircleMarker
            key={site.id}
            center={site.center}
            radius={selectedCaseId === site.id ? 10 : 8}
            pathOptions={{
              color: selectedCaseId === site.id ? "#fff0e3" : "#101112",
              weight: 2,
              fillColor: "#F65927",
              fillOpacity: 0.95,
            }}
            eventHandlers={{ click: () => onSelectCase(site.id) }}
          >
            <Tooltip direction="top" offset={[0, -10]}>{site.name} · demo</Tooltip>
          </CircleMarker>
        ))}
    </MapContainer>
  );
}
