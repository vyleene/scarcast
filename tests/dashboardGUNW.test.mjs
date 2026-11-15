import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let server, model, gunw, gcov, Timeline, Info, Analysis, blendModel
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.cache/dashboard-tests', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  model = await server.ssrLoadModule('/src/components/dashboard/dashboardData.ts')
  blendModel = await server.ssrLoadModule('/src/components/dashboard/observationBlend.ts')
  gunw = await server.ssrLoadModule('/src/services/processGUNWData.ts')
  gcov = await server.ssrLoadModule('/src/services/processGCOVData.ts')
  ;({ default: Timeline } = await server.ssrLoadModule('/src/components/dashboard/ObservationTimeline.tsx'))
  ;({ default: Info } = await server.ssrLoadModule('/src/components/dashboard/DeformationInfo.tsx'))
  ;({ default: Analysis } = await server.ssrLoadModule('/src/components/dashboard/AnalysisInfo.tsx'))
})
after(async () => { await server?.close() })

test('offers native-pixel backscatter change with chronological intervals and clear dB units', () => {
  const items = model.dashboardObservations(gcov.getGCOVAcquisitions('balikabok_downstream'), [], 'backscatterChange')
  assert.equal(items.length,4)
  assert.equal(items[1].startAt.slice(0,10),'2026-08-22')
  assert.equal(items[1].endAt.slice(0,10),'2026-09-03')
  assert.ok(items.every(item => item.kind === 'backscatterChange'))
  const html = renderToStaticMarkup(createElement(Info,{observation:items[1],mode:'backscatterChange',modes:['backscatterChange','coherence'],status:null,onModeChange(){}}))
  assert.ok(html.includes('Surface change heatmap'))
  assert.ok(html.includes('HH / dB'))
  assert.ok(html.includes('Both dates'))
  assert.ok(html.includes('not displacement in metres'))
  assert.ok(html.includes('Weak changes and small isolated patches are hidden'))
  const metadata=items[1].acquisition.metadata.hotspots
  assert.equal(metadata.window_m,90)
  assert.equal(metadata.threshold_db,3)
  assert.equal(metadata.minimum_patch_m2,10000)
  assert.ok(items[1].acquisition.url.includes('.png'))
})

test('blends adjacent dates without changing endpoints or total display opacity', () => {
  for (const position of [0,0.25,0.5,0.99,1,1.5,2]) {
    const blend = blendModel.observationBlend(position,3)
    assert.equal(blend.index,Math.floor(position))
    assert.ok(Math.abs(blend.sourceOpacity * (1-blend.targetOpacity) + blend.targetOpacity - 0.8) < 1e-10)
  }
  assert.equal(blendModel.observationBlend(2,3).fraction,0)
  assert.equal(blendModel.observationBlend(99,3).index,2)
  assert.equal(blendModel.observationBlend(-1,3).index,0)
})

test('fractional slider positions label both observations and remain visually explicit', () => {
  const items = model.dashboardObservations(gcov.getGCOVAcquisitions('mount_balikabok'),[],'backscatter')
  const html = renderToStaticMarkup(createElement(Timeline,{items,heading:'Observation date',dateIndex:0.5,onDateChange(){}}))
  assert.ok(html.includes('step="0.01"'))
  assert.ok(html.includes('50% blend'))
  assert.ok(html.includes('not a measurement between dates'))
  assert.ok(html.includes(items[1].shortLabel))
})

test('keeps three GCOV dates, three GUNW pairs and two valid baseline comparisons separate', () => {
  const pairs = gunw.getGUNWAcquisitions('mount_balikabok')
  const backscatter = gcov.getGCOVAcquisitions('mount_balikabok')
  const views = Object.fromEntries(['backscatter', 'phase', 'coherence', 'coherenceChange'].map(mode => [mode, model.dashboardObservations(backscatter, pairs, mode)]))
  assert.deepEqual(Object.values(views).map(items => items.length), [3, 3, 3, 2])
  assert.equal(views.coherenceChange[0].baseline, pairs[0])
  assert.equal(views.coherenceChange[0].acquisition, pairs[1])
  assert.equal(views.coherenceChange[1].acquisition, pairs[2])
  assert.ok(views.coherence.every(item => item.options.layer.startsWith('wrappedInterferogram/')))
  assert.equal(views.backscatter[0].endAt, undefined)
  assert.equal(views.phase[2].endAt.slice(0, 10), '2026-09-27')
  assert.equal(new Set(Object.values(views).flat().map(item => item.key)).size, 11)
  assert.equal(new Set(views.phase.map(item => item.options.displayMin)).size, 1)
  assert.equal(new Set(views.phase.map(item => item.options.displayMax)).size, 1)
})

test('omits unavailable layers, invalid comparisons and empty locations', () => {
  const pairs = gunw.getGUNWAcquisitions('mount_balikabok')
  assert.deepEqual(model.dashboardObservations([], [], 'phase'), [])
  assert.deepEqual(model.dashboardObservations([], pairs.slice(0, 1), 'coherenceChange'), [])
  const incompatible = { ...pairs[1], frequency: 'B' }
  assert.deepEqual(model.dashboardObservations([], [pairs[0], incompatible], 'coherenceChange'), [])
  const noPhase = { ...pairs[0], layers: Object.fromEntries(Object.entries(pairs[0].layers).filter(([, layer]) => layer.name !== 'phase_valid_mask')) }
  assert.deepEqual(model.dashboardObservations([], [noPhase], 'phase'), [])
  assert.equal(model.dashboardObservations([], [noPhase], 'coherence').length, 1)
})

test('renders date-pair slider endpoints and the comparison baseline without single-date ambiguity', () => {
  const items = model.dashboardObservations([], gunw.getGUNWAcquisitions('mount_balikabok'), 'coherenceChange')
  const html = renderToStaticMarkup(createElement(Timeline, { items, heading: 'Coherence comparison', dateIndex: 0, onDateChange() {} }))
  assert.ok(html.includes('Coherence comparison'))
  assert.ok(html.includes('Baseline: ' + items[0].baselineLabel))
  assert.ok(html.toLowerCase().includes('datetime="' + items[0].startAt.toLowerCase() + '"'))
  assert.ok(html.toLowerCase().includes('datetime="' + items[0].endAt.toLowerCase() + '"'))
  assert.ok(html.includes('max="1"'))
})

test('renders scientific units and caveats for each GUNW view, with matching analysis links', () => {
  const pairs = gunw.getGUNWAcquisitions('mount_balikabok')
  for (const mode of ['phase', 'coherence', 'coherenceChange']) {
    const observations = model.dashboardObservations([], pairs, mode)
    const html = renderToStaticMarkup(createElement(Info, { observation: observations[0], mode, modes: ['phase', 'coherence', 'coherenceChange'], status: null, onModeChange() {} }))
    assert.ok(!html.includes('Coming next'))
    assert.ok(html.includes('NISAR / GUNW'))
    assert.ok(html.includes('View source pair'))
    if (mode === 'phase') { assert.ok(html.includes(' rad')); assert.ok(html.includes('Atmospheric corrections')) }
    if (mode === 'coherenceChange') { assert.ok(html.includes('Baseline pair')); assert.ok(html.includes('later minus baseline')) }
    const analysis = renderToStaticMarkup(createElement(Analysis, { observations, mode, dateIndex: 0, onDateChange() {} }))
    assert.ok(analysis.includes(observations[0].label))
  }
})
