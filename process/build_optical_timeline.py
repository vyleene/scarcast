"""Export dated HLS RGB maps for the existing Analysis view.

Run with the same Earthdata environment as fetch_corroboration.py.
All dates are actual acquisitions. Cloud-masked pixels remain opaque gray
inside the study area, preventing an undated basemap from filling the gaps.
"""
import argparse
from datetime import datetime, timezone
import json
import struct
import zlib

import numpy as np
from rasterio.transform import array_bounds, from_origin
from rasterio.warp import reproject, transform_bounds, Resampling

from corroboration import grid, read_to_grid, write_json, zones
from evidence_algorithms import hls_rgb
from fetch_corroboration import OUT, cached_download, search, session


def inventory():
    existing = json.loads((OUT / "catalog.json").read_text())
    landsat = search("HLSL30", "2.0", "2026-08-15T00:00:00Z,2026-09-28T23:59:59Z")
    candidates = [item for item in existing["HLSS30"] + landsat if "T51PTS" in item["id"]]
    records = sorted({item["id"]: item for item in candidates}.values(), key=lambda item: item["date"])
    result = {"queried_at": datetime.now(timezone.utc).isoformat(), "records": records}
    write_json(OUT / "optical-catalog.json", result)
    print(f"Found {len(records)} candidate optical scenes", flush=True)
    return result


def write_rgb(name, rgba, affine):
    height, width = rgba.shape[:2]
    west, south, east, north = transform_bounds("EPSG:32651", "EPSG:3857", *array_bounds(height, width, affine))
    w, h = int(np.ceil((east-west)/30)), int(np.ceil((north-south)/30))
    target = from_origin(west, north, (east-west)/w, (north-south)/h)
    display = np.zeros((h, w, 4), dtype=np.uint8)
    for band in range(4):
        reproject(rgba[..., band], display[..., band], src_transform=affine, src_crs="EPSG:32651",
                  dst_transform=target, dst_crs="EPSG:3857", resampling=Resampling.nearest)
    def chunk(kind, data):
        return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind+data) & 0xffffffff)
    rows = b"".join(b"\0" + row.tobytes() for row in display)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!2I5B", w, h, 8, 6, 0, 0, 0))
    (OUT / name).write_bytes(png + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))
    west, south, east, north = transform_bounds("EPSG:3857", "EPSG:4326", west, south, east, north)
    return {"file": name, "bounds": [[south, west], [north, east]]}


def build(catalog):
    client = session()
    affine, shape = grid()
    areas = zones(shape, affine)
    scenes, excluded = [], []
    for item in catalog["records"]:
        date = item["date"][:10]
        # Read QA first; avoid downloading RGB for fully obscured mountain scenes.
        qa_url = next(url for url in item["links"] if url.endswith(".Fmask.tif"))
        qa = np.nan_to_num(read_to_grid(cached_download(client, qa_url), affine, shape), nan=255).astype(np.uint8)
        clear = (qa != 255) & ((qa & 31) == 0) & ((qa >> 6) != 3)
        coverage = {key: round(float(clear[mask].mean()), 4) for key, mask in areas.items()}
        print(f"{date} {item['id'].split('.')[1]} mountain clear {coverage['mountain']:.1%}", flush=True)
        if coverage["mountain"] < .15:
            excluded.append({"id": item["id"], "date": item["date"], "reason": "Less than 15% clear coverage in the mountain study area", "clear_fraction": coverage})
            continue
        channels, urls = [], [qa_url]
        for band in ("B04", "B03", "B02"):
            url = next(url for url in item["links"] if url.endswith(f".{band}.tif"))
            urls.append(url)
            channels.append(read_to_grid(cached_download(client, url), affine, shape))
        rgba, valid = hls_rgb(np.stack(channels, axis=-1), qa, areas["study"])
        coverage = {key: round(float(valid[mask].mean()), 4) for key, mask in areas.items()}
        name = f"optical-{date}-{item['id'].split('.')[1]}.png"
        scenes.append({"id": item["id"], "date": item["date"], "sensor": "Sentinel-2" if ".S30." in item["id"] else "Landsat 8/9",
                       "source_urls": urls, "clear_fraction": coverage, "overlay": write_rgb(name, rgba, affine)})
        # Publish only a complete frame list, after every referenced PNG exists.
    if not any(item["date"][:10] < "2026-08-30" for item in scenes) or not any(item["date"][:10] > "2026-08-30" for item in scenes):
        raise RuntimeError("A before/after optical comparison could not be established")
    result = {"generated_at": datetime.now(timezone.utc).isoformat(), "event_date": "2026-08-30", "resolution_m": 30,
              "method": "HLS S30/L30 v2 B04/B03/B02 true color; reflectance scale 0.0001, fixed 0–0.30 display range, gamma 2.2 for every scene. Exclude Fmask fill, cloud, cirrus, adjacency, shadow, snow, high aerosol and invalid reflectance. Masked pixels are opaque gray; no gap filling or temporal interpolation.",
              "scenes": scenes, "excluded": excluded}
    write_json(OUT / "optical-timeline.json", result)
    print(f"Saved {len(scenes)} dated optical frames", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", action="store_true")
    parser.add_argument("--extract", action="store_true")
    args = parser.parse_args()
    catalog = inventory() if args.inventory or not (OUT / "optical-catalog.json").exists() else json.loads((OUT / "optical-catalog.json").read_text())
    if args.extract:
        build(catalog)
