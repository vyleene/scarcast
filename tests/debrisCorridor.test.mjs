import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const data=JSON.parse(readFileSync(new URL('../data/balikabok_downstream/evidence/debris-corridor.json',import.meta.url),'utf8'))
test('terrain route is bounded, connected and acyclic, with monotonic station distance',()=>{
  assert.equal(data.mesh.heights.length,data.mesh.width*data.mesh.height)
  assert.ok(data.mesh.heights.every(Number.isFinite))
  const unique=new Set()
  data.route.forEach((p,i)=>{
    const key=p.slice(0,2).join(',');assert.ok(!unique.has(key));unique.add(key)
    assert.ok(p[0]>=data.bbox[0]&&p[0]<=data.bbox[2]&&p[1]>=data.bbox[1]&&p[1]<=data.bbox[3])
    if(i){assert.ok(p[3]>data.route[i-1][3]);assert.ok(p[3]-data.route[i-1][3]<=86)}
  })
  assert.equal(data.route[0][3],0)
  assert.ok(data.provenance.route_method.includes('No observed flow direction'))
})
test('dated radar evidence has matched route stations and distinguishes valid coverage from hotspot absence',()=>{
  assert.equal(data.comparisons.length,4)
  for(const period of data.comparisons){
    assert.ok(period.start<period.end)
    assert.equal(period.samples.length,data.route.length)
    assert.equal(period.sources.length,2)
    assert.ok(period.sources.every(source=>source.startsWith('https://nisar.asf.earthdatacloud.nasa.gov/')))
    for(const sample of period.samples){
      assert.ok(sample.valid_fraction>=0&&sample.valid_fraction<=1)
      assert.ok(sample.peak_db===null||sample.peak_db>=3)
      assert.ok(sample.mean_change_db===null||Number.isFinite(sample.mean_change_db))
    }
  }
  assert.ok(data.comparisons[1].start.startsWith('2026-08-22'))
  assert.ok(data.comparisons[1].end.startsWith('2026-09-03'))
  assert.ok(data.comparisons[1].samples.some(sample=>sample.peak_db!==null))
  assert.ok(data.comparisons[1].samples.some(sample=>sample.peak_db===null&&sample.valid_fraction>0))
})
