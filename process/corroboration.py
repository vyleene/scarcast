"""Build compact, source-traceable evidence products for the Analysis panel."""
from datetime import datetime, timezone
import json
from pathlib import Path
import struct
import zipfile
import zlib

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.transform import array_bounds, from_origin
from rasterio.warp import reproject, transform_bounds, transform_geom, Resampling
from shapely.geometry import LineString, box, mapping
from shapely.ops import linemerge, unary_union

from fetch_corroboration import BBOX, OUT, ROOT, cached_download
from evidence_algorithms import drainage, hls_ndvi


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def grid(resolution=30, buffer=0):
    west, south, east, north = BBOX
    bounds = transform_bounds("EPSG:4326", "EPSG:32651", west-buffer, south-buffer, east+buffer, north+buffer)
    left, bottom = np.floor(np.array(bounds[:2]) / resolution) * resolution
    right, top = np.ceil(np.array(bounds[2:]) / resolution) * resolution
    return from_origin(left, top, resolution, resolution), (round((top-bottom)/resolution), round((right-left)/resolution))


def zones(shape, affine):
    path = next((ROOT / "data" / "mount_balikabok" / "gcov").glob("*/metadata.json"))
    polygon = json.loads(path.read_text())["aoi"]
    mountain = geometry_mask([transform_geom("EPSG:4326", "EPSG:32651", polygon)], out_shape=shape, transform=affine, invert=True)
    study = geometry_mask([transform_geom("EPSG:4326", "EPSG:32651", mapping(box(*BBOX)))], out_shape=shape, transform=affine, invert=True)
    return {"mountain": mountain & study, "downstream": study & ~mountain, "study": study}


def read_to_grid(path, affine, shape, resampling=Resampling.nearest):
    output = np.full(shape, np.nan, dtype=np.float32)
    with rasterio.open(path) as src:
        reproject(rasterio.band(src, 1), output, src_transform=src.transform, src_crs=src.crs,
                  src_nodata=src.nodata, dst_transform=affine, dst_crs="EPSG:32651",
                  dst_nodata=np.nan, resampling=resampling)
    return output


def overlay(name, values, affine, colors, limits, minimum=None):
    """Export a Web Mercator PNG with transparent missing/filtered pixels."""
    bounds = array_bounds(*values.shape, affine)
    west, south, east, north = transform_bounds("EPSG:32651", "EPSG:3857", *bounds)
    resolution = 30
    width, height = int(np.ceil((east-west)/resolution)), int(np.ceil((north-south)/resolution))
    target = from_origin(west, north, (east-west)/width, (north-south)/height)
    display = np.full((height, width), np.nan, dtype=np.float32)
    reproject(values, display, src_transform=affine, src_crs="EPSG:32651", src_nodata=np.nan,
              dst_transform=target, dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=Resampling.nearest)
    valid = np.isfinite(display)
    if minimum is not None:
        valid &= display >= minimum
    fraction = np.clip((np.nan_to_num(display, nan=limits[0])-limits[0]) / (limits[1]-limits[0]), 0, 1)
    colors = np.asarray(colors)
    rgb = (colors[0] + fraction[..., None] * (colors[1]-colors[0])).astype(np.uint8)
    rgb[~valid] = 0
    rgba = np.dstack((rgb, np.where(valid, 190, 0).astype(np.uint8)))
    def chunk(kind, data):
        return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind+data) & 0xffffffff)
    rows = b"".join(b"\0" + row.tobytes() for row in rgba)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!2I5B", width, height, 8, 6, 0, 0, 0))
    (OUT / name).write_bytes(png + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))
    w, s, e, n = transform_bounds("EPSG:3857", "EPSG:4326", west, south, east, north)
    return {"file": name, "bounds": [[s, w], [n, e]]}


def terrain(catalog, client):
    source = catalog["NASADEM_HGT"][0]
    archive = cached_download(client, source["links"][0])
    affine, shape = grid(buffer=0.025)
    with zipfile.ZipFile(archive) as zip_file:
        member = next(name for name in zip_file.namelist() if name.endswith(".hgt"))
    # GDAL reads the HGT directly from the zip without an unmanaged extraction.
    dem = read_to_grid(f"/vsizip/{archive.as_posix()}/{member}", affine, shape, Resampling.bilinear)
    if not np.isfinite(dem).all():
        raise ValueError("NASADEM has missing elevations in the buffered study area")
    dy, dx = np.gradient(dem, 30)
    slope = np.degrees(np.arctan(np.hypot(dx, dy)))
    receiver, accumulation = drainage(dem)
    # This is a terrain-derived drainage guide, not an observed river/debris map.
    threshold = int(np.ceil(1_000_000 / 900))
    height, width = shape
    segments = []
    for row, col in zip(*np.where((accumulation >= threshold) & (receiver >= 0))):
        parent = int(receiver[row, col])
        r, c = divmod(parent, width)
        segments.append(LineString([affine * (col+.5, row+.5), affine * (c+.5, r+.5)]))
    merged = linemerge(unary_union(segments))
    clip = box(*transform_bounds("EPSG:4326", "EPSG:32651", *BBOX))
    lines = merged.intersection(clip).simplify(20)
    geometry = transform_geom("EPSG:32651", "EPSG:4326", mapping(lines), precision=6)
    write_json(OUT / "drainage.geojson", {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"kind": "terrain-derived drainage", "minimum_contributing_area_km2": 1}, "geometry": geometry}]})
    # Crop the contextual elevation to exactly the study grid.
    target, target_shape = grid()
    elevation = np.full(target_shape, np.nan, dtype=np.float32)
    reproject(dem, elevation, src_transform=affine, src_crs="EPSG:32651", dst_transform=target, dst_crs="EPSG:32651", resampling=Resampling.bilinear)
    cropped_slope = np.empty(target_shape, dtype=np.float32)
    reproject(slope, cropped_slope, src_transform=affine, src_crs="EPSG:32651", dst_transform=target, dst_crs="EPSG:32651", resampling=Resampling.bilinear)
    return {"source_id": source["id"], "source_url": source["links"][0], "resolution_m": 30,
            "acquisition_period": "2000-02-11 / 2000-02-21", "routing_buffer_degrees": 0.025,
            "method": "Priority-flood drainage tree with 8-neighbour routing, 1 km² minimum contributing area. Boundary catchments may be truncated. Historical terrain, not current channel conditions or a flood/runout model.",
            "overlay": overlay("elevation.png", elevation, target, [[26, 64, 60], [228, 218, 173]], [0, 1000]),
            "zones": {key: {"median_slope_degrees": round(float(np.median(cropped_slope[mask])), 1)} for key, mask in zones(target_shape, target).items()}}


def optical(catalog, client):
    affine, shape = grid()
    records = [item for item in catalog["HLSS30"] if "T51PTS" in item["id"] and item["date"][:10] in ("2026-04-06", "2026-08-16", "2026-09-13")]
    ndvis, scenes = {}, []
    for item in sorted(records, key=lambda item: item["date"]):
        bands = []
        for band in ("B04", "B8A", "Fmask"):
            url = next(url for url in item["links"] if url.endswith(f".{band}.tif"))
            print(f"Reading {item['date'][:10]} {band}", flush=True)
            path = cached_download(client, url)
            bands.append(read_to_grid(path, affine, shape))
        red, nir, mask = bands
        qa = np.nan_to_num(mask, nan=255).astype(np.uint8)
        values = hls_ndvi(red, nir, qa)
        ndvis[item["date"][:10]] = values
        scenes.append({"id": item["id"], "date": item["date"], "source_urls": item["links"],
                       "zones": {key: {"valid_fraction": round(float(np.isfinite(values[area]).mean()), 4)} for key, area in zones(shape, affine).items()}})
    if "2026-04-06" not in ndvis or "2026-09-13" not in ndvis:
        raise ValueError("The PhilSA comparison dates are not available in HLS")
    # Use the same dates as PhilSA, but keep this independent HLS computation distinct.
    before, after = ndvis["2026-04-06"], ndvis["2026-09-13"]
    valid = np.isfinite(before) & np.isfinite(after)
    loss = before - after
    rows = {}
    for key, area in zones(shape, affine).items():
        shared = area & valid
        rows[key] = {"valid_fraction": round(float(shared.sum()/area.sum()), 4),
                     "median_ndvi_change": round(float(np.median((after-before)[shared])), 4) if shared.any() else None,
                     "vegetation_loss_ha": round(float(((loss >= .2) & shared).sum() * .09), 2)}
    return {"scenes": scenes, "start": "2026-04-06", "end": "2026-09-13", "zones": rows,
            "method": "HLS S30 v2 B04 and B8A NDVI. Exclude Fmask fill, cloud, cirrus, cloud adjacency, shadow, snow and high aerosol. Display NDVI decrease ≥0.20 on shared clear pixels. Seasonal change and other disturbances can also cause vegetation loss; not a landslide classification.",
            "overlay": overlay("vegetation-loss.png", np.where(valid, loss, np.nan), affine, [[255, 215, 90], [191, 55, 20]], [.2, .8], minimum=.2)}


def radar():
    result = {key: {"observations": [], "changes": []} for key in ("mountain", "downstream", "study")}
    root = ROOT / "data" / "balikabok_downstream"
    for path in sorted((root / "gcov").glob("*/metadata.json")):
        metadata = json.loads(path.read_text())
        frequency = metadata["frequencies"]["A"]
        with rasterio.open(path.parent / frequency["backscatter"]["file"]) as src:
            data = src.read(1, masked=True).filled(np.nan)
            areas = zones(src.shape, src.transform)
        with rasterio.open(path.parent / frequency["analysis_valid_mask"]["file"]) as src:
            valid = (src.read(1) == 1) & (src.read_masks(1) > 0) & np.isfinite(data)
        for key, area in areas.items():
            selected = valid & area
            result[key]["observations"].append({"date": metadata["identification"]["zeroDopplerStartTime"][:10], "median_db": round(float(np.median(data[selected])), 3), "valid_pixels": int(selected.sum())})
    for path in sorted((root / "gcov_change").glob("*/metadata.json")):
        metadata = json.loads(path.read_text())
        with rasterio.open(path.parent / "change.tif") as src:
            valid = np.isfinite(src.read(1))
            areas = zones(src.shape, src.transform)
        with rasterio.open(path.parent / "hotspots.tif") as src:
            hot = np.isfinite(src.read(1))
        for key, area in areas.items():
            support = valid & area
            count = int((hot & support).sum())
            result[key]["changes"].append({"start": metadata["start_at"][:10], "end": metadata["end_at"][:10],
                "highlighted_ha": round(count*.01, 2), "valid_ha": round(int(support.sum())*.01, 2),
                "highlighted_fraction": round(float(count/support.sum()), 5) if support.any() else None})
    return result


def extract(catalog, client):
    OUT.mkdir(parents=True, exist_ok=True)
    summary_path = OUT / "summary.json"
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}
    summary["generated_at"] = datetime.now(timezone.utc).isoformat()
    summary["bbox"] = BBOX
    for key, work in [("terrain", lambda: terrain(catalog, client)), ("optical", lambda: optical(catalog, client)), ("radar", radar)]:
        print(f"Building {key}", flush=True)
        summary[key] = work()
        write_json(summary_path, summary)
        print(f"Saved {key}", flush=True)
