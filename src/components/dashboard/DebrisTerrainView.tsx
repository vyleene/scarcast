import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import corridor from '../../../data/balikabok_downstream/evidence/debris-corridor.json'
import { backscatterChangeManifest } from '../../services/processBackscatterChange'
import { evidenceImage, opticalSceneAt } from '../../services/corroborationData'

const exaggeration = 2
const date = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const lon0 = (corridor.bbox[0] + corridor.bbox[2]) / 2
const lat0 = (corridor.bbox[1] + corridor.bbox[3]) / 2
function position(lon: number, lat: number, elevation: number, lift = 0) {
  return new THREE.Vector3((lon-lon0)*111320*Math.cos(lat0*Math.PI/180), elevation*exaggeration+lift, (lat0-lat)*111320)
}
const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))

export default function DebrisTerrainView({ onClose }: { onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const marker = useRef<THREE.Mesh | null>(null)
  const focusStation = useRef<((point: number[]) => void) | null>(null)
  const invalidateScene = useRef<(() => void) | null>(null)
  const [toolsOpen, setToolsOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 700)
  const [interval, setInterval] = useState(1)
  const [distanceIndex, setDistanceIndex] = useState(0)
  const [optical, setOptical] = useState(true)
  const [failure, setFailure] = useState<string | null>(null)
  const comparison = corridor.comparisons[interval]
  const point = corridor.route[distanceIndex]
  const sample = comparison.samples[distanceIndex]
  const scene = opticalSceneAt(Date.parse(`${comparison.end.slice(0,10)}T12:00:00Z`))
  const raster = backscatterChangeManifest.balikabok_downstream?.find(item => item.metadata.start_at === comparison.start)

  useEffect(() => {
    const host = container.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true }) }
    catch { queueMicrotask(() => setFailure('3D terrain needs WebGL. Return to the map to inspect the original radar layers.')); return }
    let alive = true, frame = 0, needsRender = true
    const invalidate = () => { needsRender = true }
    invalidateScene.current = invalidate
    const disposables: { dispose: () => void }[] = []
    const world = new THREE.Scene()
    world.background = new THREE.Color('#101719')
    const camera = new THREE.PerspectiveCamera(43, 1, 10, 150000)
    camera.position.set(13500,14500,18000)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    host.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.addEventListener('change', invalidate)
    controls.target.copy(position(120.435,14.901,100))
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI*.48
    controls.minDistance = 700; controls.maxDistance = 65000
    focusStation.current = point => {
      const target = position(point[0], point[1], point[2])
      controls.target.copy(target)
      camera.position.copy(target.clone().add(new THREE.Vector3(1800, 2400, 3200)))
      controls.update()
    }
    world.add(new THREE.HemisphereLight('#e4f3f3','#283128',2))
    const sun = new THREE.DirectionalLight('#fff1d5',2.2)
    sun.position.set(-10000,18000,8000); world.add(sun)
    const { width, height, heights } = corridor.mesh
    function terrainGeometry(bounds?: [[number,number],[number,number]]) {
      const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = []
      const [[south,west],[north,east]] = bounds ?? [[corridor.bbox[1],corridor.bbox[0]],[corridor.bbox[3],corridor.bbox[2]]]
      for(let r=0;r<height;r++)for(let c=0;c<width;c++){
        const lon=corridor.bbox[0]+c/(width-1)*(corridor.bbox[2]-corridor.bbox[0])
        const lat=corridor.bbox[3]-r/(height-1)*(corridor.bbox[3]-corridor.bbox[1]),z=heights[r*width+c]
        positions.push(...position(lon,lat,z).toArray())
        uvs.push((lon-west)/(east-west),(mercatorY(lat)-mercatorY(south))/(mercatorY(north)-mercatorY(south)))
        const color=new THREE.Color('#385347').lerp(new THREE.Color('#b7ae8a'),Math.min(1,Math.max(0,z)/1100))
        colors.push(color.r,color.g,color.b)
        if(r<height-1&&c<width-1){const a=r*width+c;indices.push(a,a+width,a+1,a+1,a+width,a+width+1)}
      }
      const geometry=new THREE.BufferGeometry()
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
      geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2))
      geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3))
      geometry.setIndex(indices);geometry.computeVertexNormals();disposables.push(geometry)
      return geometry
    }
    const baseMaterial=new THREE.MeshStandardMaterial({ vertexColors:true,side:THREE.DoubleSide,roughness:1 })
    disposables.push(baseMaterial)
    world.add(new THREE.Mesh(terrainGeometry(),baseMaterial))
    function drape(url: string, bounds: [[number,number],[number,number]], opacity: number, offset: number) {
      const material=new THREE.MeshBasicMaterial({ transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-offset,polygonOffsetUnits:-offset })
      disposables.push(material)
      const mesh=new THREE.Mesh(terrainGeometry(bounds),material);mesh.renderOrder=offset;world.add(mesh)
      new THREE.TextureLoader().load(url,texture=>{
        if(!alive){texture.dispose();return}
        texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping
        material.map=texture;material.needsUpdate=true;disposables.push(texture);invalidate()
      },undefined,()=>{if(alive)setFailure('An imagery layer could not load. Close and reopen the terrain view to retry.')})
    }
    if(optical && scene){const url=evidenceImage(scene.overlay.file);if(url)drape(url,scene.overlay.bounds as [[number,number],[number,number]],1,1)}
    if(raster)drape(raster.url,raster.bounds as [[number,number],[number,number]],.9,2)
    // The line follows historical terrain. Its arrows indicate inferred downhill direction only.
    const routePoints=corridor.route.map(p=>position(p[0],p[1],p[2],35))
    const routeGeometry=new THREE.BufferGeometry().setFromPoints(routePoints)
    const routeMaterial=new THREE.LineBasicMaterial({color:'#d9f0f2',transparent:true,opacity:.9})
    disposables.push(routeGeometry,routeMaterial);world.add(new THREE.Line(routeGeometry,routeMaterial))
    routePoints.forEach((p,i)=>{
      if(i%22 || i>=routePoints.length-1)return
      const direction=routePoints[Math.min(i+3,routePoints.length-1)].clone().sub(p).normalize()
      const arrow=new THREE.ArrowHelper(direction,p,220,'#b5eaf0',85,55)
      world.add(arrow);disposables.push(arrow.line.geometry,arrow.cone.geometry)
      for(const material of [arrow.line.material,arrow.cone.material].flat())disposables.push(material)
    })
    const evidencePoints: THREE.Vector3[]=[]
    comparison.samples.forEach((s,i)=>{if(s.peak_db!==null)evidencePoints.push(routePoints[i].clone().add(new THREE.Vector3(0,18,0)))})
    const evidenceGeometry=new THREE.BufferGeometry().setFromPoints(evidencePoints)
    const evidenceMaterial=new THREE.PointsMaterial({color:'#F65927',size:65,sizeAttenuation:true})
    disposables.push(evidenceGeometry,evidenceMaterial);world.add(new THREE.Points(evidenceGeometry,evidenceMaterial))
    function label(text: string, at: THREE.Vector3) {
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=80
      const context=canvas.getContext('2d')
      if(!context)return
      context.fillStyle='#10201de6';context.fillRect(0,0,512,80)
      context.fillStyle='#e6e4dc';context.font='26px sans-serif';context.textAlign='center';context.fillText(text,256,50)
      const texture=new THREE.CanvasTexture(canvas),material=new THREE.SpriteMaterial({map:texture,depthTest:false})
      const sprite=new THREE.Sprite(material);sprite.position.copy(at);sprite.scale.set(2700,420,1)
      disposables.push(texture,material);world.add(sprite)
    }
    label('Radar-supported source candidate',routePoints[0].clone().add(new THREE.Vector3(0,500,0)))
    label('Inferred downstream direction',routePoints[Math.floor(routePoints.length*.35)].clone().add(new THREE.Vector3(0,500,0)))
    const markerGeometry=new THREE.SphereGeometry(80,16,12),markerMaterial=new THREE.MeshBasicMaterial({color:'#ffffff'})
    disposables.push(markerGeometry,markerMaterial)
    const inspectMarker=new THREE.Mesh(markerGeometry,markerMaterial)
    // Its position is set separately so inspecting a station never rebuilds the terrain.
    marker.current=inspectMarker;inspectMarker.visible=false;world.add(inspectMarker)
    const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();invalidate()}
    const observer=new ResizeObserver(resize);observer.observe(host);resize()
    const draw=()=>{frame=requestAnimationFrame(draw);controls.update();if(needsRender){renderer.render(world,camera);needsRender=false}};draw()
    return()=>{alive=false;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();marker.current=null;focusStation.current=null;invalidateScene.current=null;disposables.forEach(item=>item.dispose());renderer.dispose();renderer.domElement.remove()}
  }, [comparison, optical, raster, scene])

  useEffect(()=>{const active=marker.current;if(active){active.position.copy(position(point[0],point[1],point[2],130));active.visible=true;invalidateScene.current?.()}},[point,comparison,optical])

  return <section className="atlas-terrain-view" aria-label="3D debris corridor investigation">
    <div ref={container} className="atlas-terrain-canvas" />
    <header><div><span className="atlas-eyebrow">Balikabok / source to downstream</span><h2>Debris corridor in 3D</h2></div><button onClick={onClose}>Return to map ↗</button></header>
    <div className="atlas-terrain-tools">
      <button className="atlas-terrain-tools-toggle" aria-expanded={toolsOpen} onClick={() => setToolsOpen(value => !value)}>{toolsOpen ? 'Hide' : 'Show'} layers &amp; legend</button>
      {toolsOpen && <>
      <label htmlFor="terrain-interval">NISAR change interval · 2026</label>
      <select id="terrain-interval" value={interval} onChange={event=>{setInterval(Number(event.target.value));setFailure(null)}}>{corridor.comparisons.map((item,index)=><option key={item.start} value={index}>{date(item.start)} – {date(item.end)}{index===1?' · spans reported landslide':''}</option>)}</select>
      <label><input type="checkbox" checked={optical} onChange={event=>{setOptical(event.target.checked);setFailure(null)}} /> Dated optical surface{optical&&scene?` · ${date(scene.date)}`:''}</label>
      <p><i className="atlas-terrain-radar-key" /> Orange points: NISAR hotspots within 100 m of the route. Heatmap: original NISAR surface-change screen.</p>
      <p><i className="atlas-terrain-route-key" /> Pale line and arrows: terrain-derived drainage from a radar/optical-supported source candidate.</p>
      <p>Drag to orbit · scroll to zoom · right-drag to pan. Elevation exaggerated ×{exaggeration}.</p>
      </>}
    </div>
    <div className="atlas-terrain-station">
      <label htmlFor="terrain-station">Inspect along the terrain route <strong>{(point[3]/1000).toFixed(2)} km</strong></label>
      <input id="terrain-station" type="range" min={0} max={corridor.route.length-1} value={distanceIndex} onChange={event=>setDistanceIndex(Number(event.target.value))} />
      <p>{point[1].toFixed(5)}° N, {point[0].toFixed(5)}° E · historical elevation {point[2].toFixed(0)} m</p>
      <p>{sample.peak_db===null?'No ≥3 dB hotspot in this buffer':`Nearby hotspot peak: ${sample.peak_db.toFixed(1)} dB`} · valid radar samples: {Math.round(sample.valid_fraction*100)}%</p>
      <button className="atlas-terrain-focus" onClick={() => focusStation.current?.(point)}>Focus on this station</button>
      <details className="atlas-terrain-limit"><summary>Inferred route · methods and limits</summary><p>This traces a possible terrain pathway, not a satellite-measured flow trajectory. NISAR supplies dated surface-change evidence, not flow speed, travel time or water depth. Historical terrain cannot resolve new blockages; the route is uncertain on the lowland flats.</p></details>
      <a href={corridor.provenance.report} target="_blank" rel="noreferrer">Cascade report</a>{comparison.sources.map((source,i)=><a key={source} href={source} target="_blank" rel="noreferrer">{i===0?'Earlier':'Later'} NISAR source</a>)}
    </div>
    {failure&&<p className="atlas-terrain-error" role="status">{failure}</p>}
  </section>
}
