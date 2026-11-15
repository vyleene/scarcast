import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";

// EarthGlobe.tsx lives in landing/components; images live in landing/globe.
import earthMap from "../../assets/images/globe/earth.jpg"
import earthTopology from "../../assets/images/globe/topology.png";
import earthClouds from "../../assets/images/globe/clouds.png";

type Arc = {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
};

const CONNECTIONS: Arc[] = [
  { startLat: 14.6, startLng: 121.0, endLat: 35.7, endLng: 139.7, color: "#F65927" },
  { startLat: 14.6, startLng: 121.0, endLat: 1.35, endLng: 103.8, color: "#90a5b0" },
  { startLat: 14.6, startLng: 121.0, endLat: -33.9, endLng: 151.2, color: "#F65927" },
  { startLat: 35.7, startLng: 139.7, endLat: 37.8, endLng: -122.4, color: "#90a5b0" },
  { startLat: 1.35, startLng: 103.8, endLat: 51.5, endLng: -0.1, color: "#F65927" },
  { startLat: 40.7, startLng: -74.0, endLat: 51.5, endLng: -0.1, color: "#90a5b0" },
];

export default function EarthGlobe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [width, setWidth] = useState(560);
  const [ready, setReady] = useState(false);

  // React-globe.gl accepts the MATERIAL as a prop, not as globeRef.globeMaterial().
  const globeMaterial = useMemo(() => {
    return new THREE.MeshPhongMaterial({
      bumpScale: 4, // Controls topology lighting; does not physically displace terrain.
      shininess: 7,
      specular: new THREE.Color("#273a43"),
    });
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(280, Math.floor(entry.contentRect.width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ready || !globeRef.current) return;
    const globe = globeRef.current;
    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.45;
    controls.enableZoom = false;
    controls.enablePan = false;
    globe.pointOfView({ lat: 12, lng: 110, altitude: 2.1 }, 0);

    let disposed = false;
    let animationFrame: number | undefined;
    let cloudMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | undefined;

    const loader = new THREE.TextureLoader();
    loader.load(
      earthClouds,
      (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        // alphaMap makes white cloud pixels visible and dark background transparent.
        // Also works for mostly white clouds on an already transparent PNG.
        const cloudMaterial = new THREE.MeshBasicMaterial({
          map: texture,
          alphaMap: texture,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          side: THREE.FrontSide,
        });
        const geometry = new THREE.SphereGeometry(globe.getGlobeRadius() * 1.025, 96, 96);
        cloudMesh = new THREE.Mesh(geometry, cloudMaterial);
        cloudMesh.renderOrder = 2;
        globe.scene().add(cloudMesh);

        const start = performance.now();
        const animate = (now: number) => {
          if (disposed || !cloudMesh) return;
          const elapsed = (now - start) / 1000;
          cloudMesh.rotation.y = elapsed * 0.012;
          // Gentle breathing/rising effect above Earth's surface.
          const scale = 1 + 0.003 * (1 + Math.sin(elapsed * 0.8));
          cloudMesh.scale.setScalar(scale);
          animationFrame = requestAnimationFrame(animate);
        };
        animationFrame = requestAnimationFrame(animate);
      },
      undefined,
      (error) => console.error("Could not load cloud image", error)
    );

    return () => {
      disposed = true;
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      if (cloudMesh) {
        globe.scene().remove(cloudMesh);
        cloudMesh.geometry.dispose();
        cloudMesh.material.map?.dispose();
        cloudMesh.material.dispose();
      }
    };
  }, [ready]);

  return (
    <div
      ref={containerRef}
      className="relative aspect-square w-full overflow-hidden"
      aria-label="Rotating 3D Earth with clouds, terrain shading, and global connection arcs"
    >
      
      <Globe
        ref={globeRef}
        width={width}
        height={width}
        onGlobeReady={() => setReady(true)}
        globeImageUrl={earthMap}
        bumpImageUrl={earthTopology}
        globeMaterial={globeMaterial}
        backgroundColor="rgba(0,0,0,0)"
        showAtmosphere
        atmosphereColor="#658d9e"
        atmosphereAltitude={0.11}
        arcsData={CONNECTIONS}
        arcColor="color"
        arcStroke={0.22}
        arcAltitudeAutoScale={0.3}
        arcDashLength={0.35}
        arcDashGap={0.8}
        arcDashAnimateTime={3200}
        arcsTransitionDuration={0}
      />
    </div>
  );
}
