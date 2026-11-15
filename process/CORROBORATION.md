Independent evidence for Balikabok
================================

3D source-connected corridor
---------------------------

`node process/build_debris_corridor.mjs path/to/n14e120.hgt` produces
`evidence/debris-corridor.json` from the cached historical NASADEM tile and
existing local GCOV change rasters. It does not download or modify those inputs.
Figures 5–6 of the supplied NOAH report inform the source-to-downstream viewing
concept; their illustrated footprint is not traced or presented as NISAR data.

The seed is the highest historical-elevation vertex on the largest
optical-supported event-interval NISAR patch centered within the mountain clip.
This is a radar-supported source candidate, not the surveyed landslide head.
Routing uses 60 m terrain cells buffered beyond the study rectangle, steepest
D8 descent on a priority-flood-filled surface and acyclic receiver-tree routing
on flats. The path stops at the study boundary, not the observed debris terminus.
Historical terrain cannot represent event-created blockages. Lowland routing is
especially uncertain; path distance is not measured event runout.

For each existing NISAR interval, sample the original hotspot peak and signed
backscatter change within 100 m of each route station at 20 m spacing. Preserve
valid-sample fractions and null hotspot results separately. The terrain viewer
drapes the actual dated hotspot PNG and nearest same-side optical image using
their Web Mercator bounds, and supplies an along-route inspection slider.
The terrain mesh uses 181 × 141 historical elevation samples with ×2 vertical
exaggeration; its geometry is geographic context, not post-slide topography.
Arrows show inferred drainage direction. No animated flow, speed, water depth,
transport timing, displacement in metres or causal flood attribution is inferred
from NISAR. All source acquisition links and actual imagery dates remain visible.

Run `python process/fetch_corroboration.py --inventory` to query NASA CMR.
Run `python process/fetch_corroboration.py --extract` to reproduce the exports.
Use the environment containing `process/requirements.txt` and an existing Earthdata
login in environment variables or `.netrc` / `_netrc`. Nothing is committed by the
extractor. Original GCOV and GUNW exports are read only.

Outputs live in `data/balikabok_downstream/evidence/`. `catalog.json` records NASA
granule IDs, acquisition times and canonical unsigned source URLs. `summary.json`
records processing methods, selected-area statistics and display bounds.
Downloads are cached outside the checkout under the OS temporary directory in
`scarcast-corroboration-inputs`; no credentials are written there.

Retrieved and processed:

- NASADEM_HGT_n14e120, 1 arc-second historical elevation. Bilinear reprojection to
  EPSG:32651 at 30 m; terrain-derived drainage uses a priority-flood tree on an area
  buffered by 0.025 degrees. At least 1 km² contributing area is required to draw
  a line. The boundary truncates catchments; routing is a contextual guide and is
  not observed channel geometry, post-slide topography or a runout/flood model.
- HLS S30 v2 tile 51PTS, April 6, August 16 and September 13, 2026, B04/B8A/Fmask.
  Shared clear pixels from April 6 and September 13 produce an NDVI-loss screen
  at 0.20. Cloud, cirrus, adjacent cloud, shadow, snow, fill and high aerosol are
  excluded. August 16 is virtually entirely obscured. The long optical interval
  includes seasonal and unrelated changes. A numerical resemblance to PhilSA's
  approximately 110 ha estimate does not validate our threshold or footprint.
- Existing NISAR GCOV HH exports, analysis-valid masks and hotspot outputs. Area
  summaries retain the existing >=3 dB, 90 m averaging, >=1 ha patch screen. They
  quantify radar change, not affected people or confirmed damaged hectares.

The mountain zone is the original extraction polygon, not the landslide scar.
The outside zone is the study rectangle minus that polygon, not a watershed.

Located but not retrieved:

- IMERG Final daily had no records for August 1–September 28 in this catalog query.
  Late daily V07C had 59 records. The cloud download returned HTTP 403, legacy
  data access returned HTTP 401, and authenticated legacy OPeNDAP redirected to
  the GES DISC website rather than returning numerical values. The app therefore
  uses explicitly attributed Abucay gauge totals from the NOAH report, and does
  not fabricate an IMERG time series or imply a rainfall threshold.
- PhilSA's high-resolution map link resolves to SharePoint; an authoritative
  downloadable scar vector was not obtained. Report text is cited separately
  from computed optical/radar layers. No image was traced into a fake boundary.

Report provenance:

- https://philsa.gov.ph/news/satellite-data-shows-august-30-landslide-in-subic-zambales-following-prolonged-rains/
- https://zenodo.org/records/22803827
- https://bataan.gov.ph/news/downstream-communities-urged-to-remain-alert-amid-continuing-risk/
- https://bataan.gov.ph/news/sp-declares-bataan-in-state-of-calamity/?p=1461095

Flooding was reported before August 30. The app preserves this chronology and
does not attribute all regional monsoon damage to the landslide.

Dated optical map
-----------------

Run `python process/build_optical_timeline.py --inventory --extract` to query
additional Landsat candidates and build the dated RGB sequence. This is separate
from the NDVI comparison, so the existing summary is left intact.

The initial export contains April 6, September 13, September 18 and September 25
Sentinel-2 HLS scenes. August 27 and September 4 Landsat candidates, and several
other dates, are cloud-obscured over the mountain. Scenes with less than 15%
clear coverage in the mountain clip are excluded and recorded in
`optical-timeline.json`; `optical-catalog.json` retains all candidate provenance.
September 13 is the first usable post-event acquisition in this set, 14 days
after August 30. There is no August 30 optical frame in this sequence.

RGB uses B04/B03/B02 reflectance with the same fixed 0–0.30 stretch and gamma 2.2
for every scene. The HLS Fmask excludes clouds/cirrus/adjacency/shadow/snow/high
aerosol and fill; invalid reflectance is also masked. Cloud/invalid pixels are
opaque gray within the AOI, preventing undated basemap imagery from appearing
to fill gaps in the dated scene. Outside the AOI remains transparent. The map
date slider selects actual acquisitions and performs no temporal interpolation.

Combined investigation
----------------------

`python process/build_investigation.py` joins existing NISAR hotspot candidates
with the independently computed HLS vegetation-loss mask. Output categorical
GeoJSON screens have two classes: NISAR change with coincident optical vegetation
loss, and NISAR change with absent/unavailable optical support. This is a spatial
cross-check using different temporal intervals, not a landslide classifier.
Statistics retain optical evaluability separately from support.

Waterway proximity uses a 100 m buffer of historical terrain-derived drainage.
It is a contextual measurement, not a debris route or forecast. Raw elevation,
standalone optical-loss heatmaps and duplicate radar comparison charts have been
removed from Analysis. Dated RGB imagery toggles over the selected radar map,
with opacity controls in the map controls. Its acquisition now follows the main
radar timeline automatically; there is no separate optical date slider. Pair
views use the pair end time, interpolated when blending adjacent pairs. The
nearest usable optical scene on the same side of August 30 is selected. The
actual optical date remains visible; dates are not presented as coincident.

PhilSA reports downstream flooding in Pita, Dalao and Pagalanggang. Their
approximate reference coordinates are sourced individually from PhilAtlas in
`reported-place-references.json`. Government PSA boundary queries timed out, so
the app uses points, not invented barangay polygons or flood extents. No area,
population or affected-person statistics are inferred from these points.

`investigation.json` stores screen intervals, zone statistics and provenance.
NISAR candidate areas near waterways or reported communities remain candidates;
report evidence and satellite evidence are deliberately labeled separately.
