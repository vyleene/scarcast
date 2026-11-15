import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let server, evidence, Analysis, OpticalTimeline
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.cache/evidence-tests', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  evidence = await server.ssrLoadModule('/src/services/corroborationData.ts')
  ;({ default: Analysis } = await server.ssrLoadModule('/src/components/dashboard/AnalysisInfo.tsx'))
  ;({ default: OpticalTimeline } = await server.ssrLoadModule('/src/components/dashboard/OpticalAcquisitionNote.tsx'))
})
after(async () => { await server?.close() })

test('dated optical frames use actual chronological acquisitions and explicit event offsets', () => {
  const timeline = evidence.opticalTimeline
  assert.ok(timeline.scenes.length >= 2)
  assert.deepEqual(timeline.scenes.map(scene => scene.date), timeline.scenes.map(scene => scene.date).sort())
  const first = timeline.scenes[0]
  const after = evidence.selectedOpticalScene()
  assert.ok(first.date.slice(0, 10) < timeline.event_date)
  assert.ok(after.date.slice(0, 10) > timeline.event_date)
  assert.equal(evidence.selectedOpticalScene(first.id), first)
  for (const scene of timeline.scenes) {
    assert.ok(evidence.evidenceImage(scene.overlay.file))
    assert.ok(scene.clear_fraction.mountain >= .15)
  }
  const html = renderToStaticMarkup(createElement(OpticalTimeline, { selection: { ...evidence.initialEvidenceSelection, optical: true, opticalScene: after.id } }))
  assert.ok(!html.includes('type="range"'))
  assert.ok(html.includes(after.date))
  assert.ok(html.includes('14 days after the reported landslide'))
  assert.ok(html.includes('Follows the main timeline'))
  assert.ok(!html.includes('blend'))
})

test('main timeline dates select optical imagery without showing a post-event scene before the slide', () => {
  const at = date => evidence.opticalSceneAt(Date.parse(date))?.date.slice(0, 10)
  assert.equal(at('2026-08-22'), '2026-04-06')
  assert.equal(at('2026-09-03'), '2026-09-13')
  assert.equal(at('2026-09-15'), '2026-09-13')
  assert.equal(at('2026-09-27'), '2026-09-25')
  // Fractional radar positions supply interpolated times and update automatically.
  const first = Date.parse('2026-08-22'), next = Date.parse('2026-09-03')
  assert.equal(evidence.opticalSceneAt(first + (next-first)*.25).date.slice(0, 10), '2026-04-06')
  assert.equal(evidence.opticalSceneAt(first + (next-first)*.9).date.slice(0, 10), '2026-09-13')
  assert.equal(evidence.opticalSceneAt(NaN), undefined)
  assert.equal(evidence.opticalSceneAt(Date.parse('2026-08-22'), evidence.opticalTimeline.scenes.filter(scene => scene.date.startsWith('2026-09'))), undefined)
})

test('evidence exports have bounded coverage and reconcile highlighted hectares to fractions', () => {
  const data = evidence.corroboration
  assert.ok(data.terrain.source_id.includes('NASADEM'))
  assert.equal(data.optical.start, '2026-04-06')
  assert.equal(data.optical.end, '2026-09-13')
  for (const area of ['mountain', 'downstream', 'study']) {
    assert.ok(data.optical.zones[area].valid_fraction >= 0 && data.optical.zones[area].valid_fraction <= 1)
    assert.equal(data.radar[area].changes.length, 4)
    for (const row of data.radar[area].changes) {
      assert.ok(row.start < row.end)
      assert.ok(row.highlighted_ha <= row.valid_ha)
      assert.ok(Math.abs(row.highlighted_ha / row.valid_ha - row.highlighted_fraction) < .00001)
    }
  }
  for (const overlay of [data.optical.overlay, data.terrain.overlay]) {
    assert.ok(evidence.evidenceImage(overlay.file))
    assert.ok(overlay.bounds[0][0] < overlay.bounds[1][0])
    assert.ok(overlay.bounds[0][1] < overlay.bounds[1][1])
  }
  assert.ok(evidence.drainageUrl)
})

test('each area displays its own evidence and preserves report and observation distinctions', () => {
  for (const zone of ['mountain', 'downstream', 'study']) {
    const html = renderToStaticMarkup(createElement(Analysis, {
      location: 'balikabok_downstream', observations: [], mode: 'backscatterChange', dateIndex: 0,
      selection: { ...evidence.initialEvidenceSelection, zone }, onDateChange() {},
    }))
    assert.ok(html.includes('What happened downstream?'))
    assert.ok(html.includes('Could be checked in clear optical pixels'))
    assert.ok(html.includes('Flooding already reported'))
    assert.ok(html.includes('not confirmation of a landslide or its timing'))
    assert.ok(html.includes('Published gauge observations, not IMERG estimates'))
    assert.ok(html.includes(evidence.evidenceSources.philsa))
    assert.ok(html.includes('2,210.4 mm'))
    assert.ok(!html.includes('Observations before conclusions.'))
    assert.ok(!html.includes('When did radar change?'))
    assert.ok(!html.includes('Vegetation-loss candidates'))
    assert.ok(!html.includes('>Elevation</button>'))
    assert.ok(html.includes('Pita'))
    assert.ok(html.includes('Pagalanggang'))
  }
})

test('joined evidence preserves subset relations and does not turn reported places into flood footprints', () => {
  for (const comparison of evidence.investigation.comparisons) {
    assert.ok(evidence.screenUrl(comparison.screen_file))
    for (const stats of Object.values(comparison.zones)) {
      assert.ok(stats.optical_supported_ha <= stats.optical_evaluable_candidate_ha)
      assert.ok(stats.optical_evaluable_candidate_ha <= stats.radar_candidate_ha)
      assert.ok(stats.candidate_near_drainage_ha <= stats.radar_candidate_ha)
    }
    assert.deepEqual(comparison.places, {}) // Approximate pins have no affected-area statistics.
  }
  assert.equal(evidence.reportedPlaces.length, 3)
  for (const place of evidence.reportedPlaces) {
    assert.equal(place.geometry.type, 'Point')
    assert.ok(place.properties.report_source.includes('philsa.gov.ph'))
    assert.ok(place.properties.location_kind.includes('not an observed damage location'))
  }
  assert.equal(evidence.selectedInvestigation('2026-09-03T00:00:00Z').start, '2026-08-22')
})
