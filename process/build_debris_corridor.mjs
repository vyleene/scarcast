/** Reproduce the 3D corridor from cached historical NASADEM and existing NISAR exports.
 * Usage: node process/build_debris_corridor.mjs path/to/n14e120.hgt
 * No downloads, invented coordinates, flood classifier, or simulated travel times.
 */
import fs from 'node:fs'
import path from 'node:path'
import proj4 from 'proj4'
import { fromFile } from 'geotiff'

const demPath = process.argv[2]
if (!demPath) throw new Error('Supply the cached NASADEM n14e120.hgt file')
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'data/balikabok_downstream/evidence')
const dem = fs.readFileSync(demPath), side = Math.sqrt(dem.length / 2)
if (side !== 3601) throw new Error('Expected NASADEM n14e120, 3601 × 3601')
const utm = '+proj=utm +zone=51 +datum=WGS84 +units=m +no_defs'
const project = p => proj4('EPSG:4326', utm, p)
const geographic = p => proj4(utm, 'EPSG:4326', p)
function elevation(lon, lat) {
  const x = (lon - 120) * 3600, y = (15 - lat) * 3600
  const c = Math.floor(x), r = Math.floor(y), dx = x - c, dy = y - r
  if (c < 0 || r < 0 || c + 1 >= side || r + 1 >= side) throw new Error('DEM coverage missing')
  const at = (rr, cc) => dem.readInt16BE((rr * side + cc) * 2)
  const values = [at(r,c),at(r,c+1),at(r+1,c),at(r+1,c+1)]
  if (values.some(v => v === -32768)) throw new Error('DEM void encountered')
  return values[0]*(1-dx)*(1-dy)+values[1]*dx*(1-dy)+values[2]*(1-dx)*dy+values[3]*dx*dy
}
function inside(p, ring) {
  let result = false
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j]
    if ((a[1]>p[1]) !== (b[1]>p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) result=!result
  }
  return result
}
const event = JSON.parse(fs.readFileSync(path.join(out,'nisar-screen-2026-08-22_2026-09-03.geojson')))
const mountainDir=path.join(root,'data/mount_balikabok/gcov')
const mountain=JSON.parse(fs.readFileSync(path.join(mountainDir,fs.readdirSync(mountainDir)[0],'metadata.json'))).aoi.coordinates[0]
// Seed from the largest optical-supported NISAR patch whose centroid lies in the mountain clip.
const candidates=event.features.filter(f=>f.properties.category===2 && f.geometry.type==='Polygon').map(f=>{
  const ring=f.geometry.coordinates[0]
  let twiceArea=0,cx=0,cy=0
  for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1],cross=a[0]*b[1]-b[0]*a[1];twiceArea+=cross;cx+=(a[0]+b[0])*cross;cy+=(a[1]+b[1])*cross}
  return {ring,area:Math.abs(twiceArea),center:[cx/(3*twiceArea),cy/(3*twiceArea)]}
}).filter(p=>p.area>0 && inside(p.center,mountain)).sort((a,b)=>b.area-a.area)
if(!candidates.length) throw new Error('No supported mountain source candidate')
const sourcePatch=candidates[0]
// Highest vertex on that patch seeds an exploratory terrain route, not an observed flow origin.
const seed=sourcePatch.ring.reduce((best,p)=>elevation(...p)>elevation(...best)?p:best)
const step=60, min=project([120.315,14.775]), max=project([120.595,14.995])
const width=Math.ceil((max[0]-min[0])/step)+1,height=Math.ceil((max[1]-min[1])/step)+1
const z=new Float32Array(width*height),receiver=new Int32Array(z.length).fill(-1),seen=new Uint8Array(z.length)
const filled=new Float64Array(z.length)
const xy=i=>[min[0]+(i%width)*step,max[1]-Math.floor(i/width)*step]
for(let i=0;i<z.length;i++) z[i]=elevation(...geographic(xy(i)))
const heap=[]
function push(value){heap.push(value);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p][0]<=value[0])break;heap[i]=heap[p];i=p}heap[i]=value}
function pop(){const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(2*i+1<heap.length){let j=2*i+1;if(j+1<heap.length&&heap[j+1][0]<heap[j][0])j++;if(heap[j][0]>=last[0])break;heap[i]=heap[j];i=j}heap[i]=last}return first}
for(let r=0;r<height;r++)for(let c=0;c<width;c++)if(!r||!c||r===height-1||c===width-1){const i=r*width+c;seen[i]=1;push([z[i],i])}
while(heap.length){const [spill,i]=pop(),r=Math.floor(i/width),c=i%width;filled[i]=spill
  for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const rr=r+dr,cc=c+dc;if(rr<0||cc<0||rr>=height||cc>=width)continue;const j=rr*width+cc;if(seen[j])continue;seen[j]=1;receiver[j]=i;push([Math.max(spill,z[j]),j])}
}
// Follow steepest descent on the filled surface; retain the acyclic flood tree on flats.
for(let i=0;i<z.length;i++){
  const r=Math.floor(i/width),c=i%width;let steepest=0
  if(!r||!c||r===height-1||c===width-1)continue
  for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
    if(!dr&&!dc)continue
    const j=(r+dr)*width+c+dc,slope=(filled[i]-filled[j])/Math.hypot(dr,dc)
    if(slope>steepest){steepest=slope;receiver[i]=j}
  }
}
const seedXY=project(seed),seedIndex=Math.round((max[1]-seedXY[1])/step)*width+Math.round((seedXY[0]-min[0])/step)
const route=[],routeIndices=[]
let distance=0,previous=null
for(let i=seedIndex;i>=0;i=receiver[i]){
  const p=geographic(xy(i));if(p[0]<120.34||p[0]>120.57||p[1]<14.8||p[1]>14.97)break
  if(previous)distance+=Math.hypot(xy(i)[0]-previous[0],xy(i)[1]-previous[1])
  route.push([+p[0].toFixed(6),+p[1].toFixed(6),+z[i].toFixed(1),Math.round(distance)]);routeIndices.push(i);previous=xy(i)
}
if(route.length<5)throw new Error('No usable source-connected route')
const bbox=[120.34,14.8,120.57,14.97],meshWidth=181,meshHeight=141,heights=[]
for(let r=0;r<meshHeight;r++)for(let c=0;c<meshWidth;c++)heights.push(Math.round(elevation(bbox[0]+c/(meshWidth-1)*(bbox[2]-bbox[0]),bbox[3]-r/(meshHeight-1)*(bbox[3]-bbox[1]))))
const comparisons=[]
for(const folder of fs.readdirSync(path.join(root,'data/balikabok_downstream/gcov_change')).sort()){
  const dir=path.join(root,'data/balikabok_downstream/gcov_change',folder),meta=JSON.parse(fs.readFileSync(path.join(dir,'metadata.json')))
  const hot=await fromFile(path.join(dir,'hotspots.tif')),signed=await fromFile(path.join(dir,'change.tif'))
  const image=await hot.getImage(),hotRaster=await image.readRasters({interleave:true}),signedRaster=await (await signed.getImage()).readRasters({interleave:true})
  const [a,,left,,e,top]=meta.transform,cols=meta.shape[1],rows=meta.shape[0]
  function pixel(x,y){const c=Math.floor((x-left)/a),r=Math.floor((y-top)/e);return c>=0&&r>=0&&c<cols&&r<rows?r*cols+c:-1}
  const samples=routeIndices.map(i=>{
    const [x,y]=xy(i);let peak=null,valid=0,total=0,signedSum=0,signedCount=0
    // A fixed 100 m radius measures nearby evidence; it does not classify the route.
    for(let dx=-100;dx<=100;dx+=20)for(let dy=-100;dy<=100;dy+=20){if(dx*dx+dy*dy>10000)continue;total++;const k=pixel(x+dx,y+dy);if(k<0)continue;const v=Number(signedRaster[k]);if(Number.isFinite(v)&&Math.abs(v)<100){valid++;signedSum+=v;signedCount++}const h=Number(hotRaster[k]);if(Number.isFinite(h)&&h>=meta.hotspots.threshold_db&&h<100)peak=Math.max(peak??0,h)}
    return {peak_db:peak===null?null:+peak.toFixed(2),mean_change_db:signedCount?+(signedSum/signedCount).toFixed(2):null,valid_fraction:+(valid/total).toFixed(2)}
  })
  comparisons.push({start:meta.start_at,end:meta.end_at,sources:meta.sources,samples})
  await hot.close();await signed.close()
}
const result={bbox,mesh:{width:meshWidth,height:meshHeight,heights},route,source_patch:sourcePatch.ring,comparisons,
  provenance:{dem:'NASADEM_HGT_n14e120',dem_period:'2000-02-11 / 2000-02-21',route_resolution_m:step,radar_buffer_m:100,
    seed_method:'Highest historical-elevation vertex of the largest optical-supported NISAR event-change patch centered within the mountain extraction polygon.',
    route_method:'Steepest D8 descent on priority-flood-filled buffered historical terrain; acyclic flood-tree routing on flats. Terminates at study boundary. No observed flow direction, speed, flood depth, debris volume or event travel time is inferred.',
    radar_method:'Existing GCOV HH hotspot peaks and signed change sampled within 100 m of route vertices; 20 m sampling spacing. Null means no hotspot, not absence of debris. Valid coverage is separately retained.',
    report:'https://zenodo.org/records/22803827'}}
fs.writeFileSync(path.join(out,'debris-corridor.json'),JSON.stringify(result))
console.log(JSON.stringify({seed,route_vertices:route.length,route_km:distance/1000,end:route.at(-1),comparisons:comparisons.length}))
