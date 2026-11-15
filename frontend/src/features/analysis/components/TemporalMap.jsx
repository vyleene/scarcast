import { useEffect } from "react";
import { Circle, CircleMarker, ImageOverlay, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const CURRENT_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ATTRIBUTION = 'Tiles &copy; Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const CAMERA_KEY = "scarcast.map.camera.v2";

function waybackUrl(item) {
  if (!item?.itemURL) return CURRENT_URL;
  return item.itemURL.replaceAll("{level}", "{z}").replaceAll("{row}", "{y}").replaceAll("{col}", "{x}");
}

function readView(fallbackCenter) {
  try {
    const camera = JSON.parse(sessionStorage.getItem(CAMERA_KEY) || "null");
    if (Array.isArray(camera?.center) && camera.center.length === 2 && camera.center.every(Number.isFinite) && Number.isFinite(camera.zoom)) return camera;
  } catch { /* Storage may be blocked. */ }
  return { center: fallbackCenter, zoom: 10 };
}

function MapLifecycle({ center }) {
  const map = useMapEvents({
    moveend() { save(); },
    zoomend() { save(); },
  });
  function save() {
    try {
      const c = map.getCenter();
      sessionStorage.setItem(CAMERA_KEY, JSON.stringify({ center: [c.lat, c.lng], zoom: map.getZoom() }));
    } catch { /* Ignore inaccessible storage. */ }
  }
  useEffect(() => {
    const container = map.getContainer();
    const resize = () => map.invalidateSize({ pan: false, debounceMoveend: true });
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => observer.disconnect();
  }, [map]);
  useEffect(() => { if (center) map.setView(center, map.getZoom(), { animate: false }); }, [map, center?.[0], center?.[1]]);
  return null;
}

export default function TemporalMap({ center, radius, release, compareRelease, compareOpacity, overlay, overlayOpacity }) {
  const initial = readView(center);
  return (
    <MapContainer center={initial.center} zoom={initial.zoom} minZoom={3} maxZoom={18} className="temporal-leaflet" scrollWheelZoom>
      <MapLifecycle center={center} />
      <TileLayer
        key={compareRelease ? `base-${compareRelease.releaseNum}` : `base-${release?.releaseNum || "current"}`}
        url={waybackUrl(compareRelease || release)}
        maxNativeZoom={16}
        maxZoom={18}
        attribution={ATTRIBUTION}
      />
      {compareRelease && release && (
        <TileLayer key={`compare-${release.releaseNum}`} url={waybackUrl(release)} opacity={compareOpacity} maxNativeZoom={16} maxZoom={18} attribution={ATTRIBUTION}/>
      )}
      {overlay?.layerUrl && overlay?.bounds && (
        <ImageOverlay key={overlay.id} url={overlay.layerUrl} bounds={overlay.bounds} opacity={overlayOpacity} zIndex={420} />
      )}
      {radius && (
        <>
          <Circle center={center} radius={radius} pathOptions={{ color: "#F65927", weight: 2, fillColor: "#F65927", fillOpacity: 0.06 }} interactive={false}/>
          <CircleMarker center={center} radius={4} pathOptions={{ color: "#fff0e3", weight: 2, fillColor: "#F65927", fillOpacity: 1 }} interactive={false}/>
        </>
      )}
    </MapContainer>
  );
}
