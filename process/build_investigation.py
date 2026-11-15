"""Join NISAR candidates, optical support, drainage and reported barangays.

Only the PSA boundary query uses the network. All satellite inputs already
exist locally; neither reported impact nor a shared satellite signal is treated
as a confirmed flood footprint or causal attribution.
"""
from datetime import datetime, timezone
import argparse
import json
from pathlib import Path

import numpy as np
import requests
import rasterio
from rasterio.features import geometry_mask, shapes
from rasterio.warp import reproject, transform_geom, Resampling
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

from corroboration import grid, read_to_grid, write_json, zones
from evidence_algorithms import hls_ndvi
from fetch_corroboration import OUT, ROOT

BOUNDARY_URL = "https://portal.georisk.gov.ph/arcgis/rest/services/PSA/Barangay/MapServer/4"
REPORT = "https://philsa.gov.ph/news/satellite-data-shows-august-30-landslide-in-subic-zambales-following-prolonged-rains/"


def boundaries(refresh=False):
    path = OUT / "reported-places.geojson"
    if path.exists():
        return json.loads(path.read_text())
    if not refresh:
        data = json.loads((OUT / "reported-place-references.json").read_text())
        write_json(path, data)
        return data
    response = requests.get(BOUNDARY_URL + "/query", params={
        "where": "1=1", "geometry": "120.34,14.80,120.57,14.97", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
        "outFields": "brgy_name,city_name,prov_name,brgy_code", "outSR": 4326, "f": "geojson",
    }, timeout=60)
    response.raise_for_status()
    data = response.json()
    data["features"] = [item for item in data.get("features", []) if item["properties"].get("city_name", "").upper() == "DINALUPIHAN" and item["properties"].get("brgy_name", "").upper() in {"PITA", "DALAO", "PAGALANGGANG"}]
    if {item["properties"]["brgy_name"].upper() for item in data.get("features", [])} != {"PITA", "DALAO", "PAGALANGGANG"}:
        raise RuntimeError("Expected all three reported Dinalupihan barangays; no boundary file published")
    for feature in data["features"]:
        props = feature["properties"]
        if props["prov_name"].upper() != "BATAAN":
            raise ValueError("Unexpected province")
        props.update({"report_source": REPORT, "boundary_source": BOUNDARY_URL,
                      "status": "Flooding reported by PhilSA; not an observed flood extent", "boundary_vintage": "PSA indicative June 2016 boundaries"})
    write_json(path, data)
    return data


def optical_loss():
    catalog = json.loads((OUT / "catalog.json").read_text())
    affine, shape_ = grid()
    values = []
    import tempfile
    cache = Path(tempfile.gettempdir()) / "scarcast-corroboration-inputs"
    for date in ("2026-04-06", "2026-09-13"):
        record = next(item for item in catalog["HLSS30"] if "T51PTS" in item["id"] and item["date"].startswith(date))
        bands = []
        for band in ("B04", "B8A", "Fmask"):
            url = next(url for url in record["links"] if url.endswith(f".{band}.tif"))
            bands.append(read_to_grid(cache / url.rsplit("/", 1)[-1], affine, shape_))
        values.append(hls_ndvi(bands[0], bands[1], np.nan_to_num(bands[2], nan=255).astype(np.uint8)))
    return np.where(np.isfinite(values[0]) & np.isfinite(values[1]), values[0] - values[1], np.nan), affine


def main(refresh=False):
    places = boundaries(refresh)
    loss, optical_transform = optical_loss()
    drainage = json.loads((OUT / "drainage.geojson").read_text())
    channels = unary_union([shape(transform_geom("EPSG:4326", "EPSG:32651", item["geometry"])) for item in drainage["features"]]).buffer(100)
    result = {"generated_at": datetime.now(timezone.utc).isoformat(), "boundary_source": BOUNDARY_URL if places["features"][0]["geometry"]["type"] != "Point" else None,
              "location_sources": [feature["properties"].get("location_source", BOUNDARY_URL) for feature in places["features"]],
              "place_geometry": places["features"][0]["geometry"]["type"],
              "optical_interval": ["2026-04-06", "2026-09-13"], "comparisons": []}
    for path in sorted((ROOT / "data" / "balikabok_downstream" / "gcov_change").glob("*/metadata.json")):
        meta = json.loads(path.read_text())
        with rasterio.open(path.parent / "hotspots.tif") as source:
            hot = np.isfinite(source.read(1))
            affine, shape_ = source.transform, source.shape
        with rasterio.open(path.parent / "change.tif") as source:
            valid = np.isfinite(source.read(1))
        optical = np.full(shape_, np.nan, dtype=np.float32)
        reproject(loss, optical, src_transform=optical_transform, src_crs="EPSG:32651", src_nodata=np.nan,
                  dst_transform=affine, dst_crs="EPSG:32651", dst_nodata=np.nan, resampling=Resampling.nearest)
        evaluable = np.isfinite(optical)
        supported = hot & evaluable & (optical >= .2)
        near_channels = geometry_mask([mapping(channels)], out_shape=shape_, transform=affine, invert=True)
        start, end = meta["start_at"][:10], meta["end_at"][:10]
        # A categorical screen, never a second continuous heatmap.
        category = np.where(supported, 2, np.where(hot, 1, 0)).astype(np.uint8)
        features = []
        for geometry, code in shapes(category, mask=hot, transform=affine, connectivity=8):
            simplified = shape(geometry).simplify(10, preserve_topology=True)
            features.append({"type": "Feature", "properties": {"category": int(code), "start": start, "end": end,
                "meaning": "NISAR change with coincident optical vegetation loss" if code == 2 else "NISAR change; optical support absent or unavailable"},
                "geometry": transform_geom("EPSG:32651", "EPSG:4326", mapping(simplified), precision=6)})
        name = f"nisar-screen-{start}_{end}.geojson"
        write_json(OUT / name, {"type": "FeatureCollection", "features": features})
        def stats(area):
            return {"radar_candidate_ha": round(int((hot & area).sum()) * .01, 2),
                    "optical_evaluable_candidate_ha": round(int((hot & area & evaluable).sum()) * .01, 2),
                    "optical_supported_ha": round(int((supported & area).sum()) * .01, 2),
                    "candidate_near_drainage_ha": round(int((hot & area & near_channels).sum()) * .01, 2),
                    "radar_valid_ha": round(int((valid & area).sum()) * .01, 2)}
        rows = {}
        for feature in places["features"]:
            if feature["geometry"]["type"] == "Point":
                continue  # Never treat a reference point as an affected-area polygon.
            props = feature["properties"]
            geometry = transform_geom("EPSG:4326", "EPSG:32651", feature["geometry"])
            area = geometry_mask([geometry], out_shape=shape_, transform=affine, invert=True)
            rows[props["brgy_name"]] = stats(area)
        result["comparisons"].append({"start": start, "end": end, "screen_file": name,
             "zones": {key: stats(mask) for key, mask in zones(shape_, affine).items()}, "places": rows})
        print(f"Joined {start} – {end}: {len(features)} screen features", flush=True)
    result["method"] = "Existing NISAR >=3 dB hotspot screen intersected with shared-clear HLS April 6–September 13 NDVI decrease >=0.20. Optical support is spatial coincidence across a longer interval, not proof of landslide or event timing. Drainage proximity uses a 100 m buffer of historical terrain-derived drainage, not a modeled debris route. Approximate barangay reference points are sourced from PhilAtlas and have no area or affected-person statistics. Impact reports come independently from PhilSA. The PSA boundary endpoint timed out; no administrative polygons or flood extents are inferred."
    write_json(OUT / "investigation.json", result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh-boundaries", action="store_true")
    main(parser.parse_args().refresh_boundaries)
