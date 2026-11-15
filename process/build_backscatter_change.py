"""Derive native-grid HH backscatter differences from existing GCOV exports.

Run after extraction: python process/build_backscatter_change.py
No remote requests; original GCOV/GUNW files are not modified.
"""
import json
import re
from pathlib import Path

import numpy as np
import rasterio

from helpers import DATA_DIR, save_geotiff, write_json
from change_hotspots import hotspots, write_overlay


def difference(before, after, before_valid, after_valid):
    if len({array.shape for array in (before, after, before_valid, after_valid)}) != 1:
        raise ValueError("Backscatter difference requires identical array shapes.")
    valid = before_valid & after_valid & np.isfinite(before) & np.isfinite(after)
    result = np.full(before.shape, np.nan, dtype=np.float32)
    result[valid] = after[valid] - before[valid]
    return result, valid


def build():
    for location in sorted(DATA_DIR.iterdir()):
        paths = list((location / "gcov").glob("*/metadata.json"))
        records = [(path, json.loads(path.read_text(encoding="utf-8"))) for path in paths]
        records.sort(key=lambda record: record[1]["identification"]["zeroDopplerStartTime"])
        for (first_path, first), (second_path, second) in zip(records, records[1:]):
            identity = ("trackNumber", "frameNumber", "orbitPassDirection", "lookDirection", "productVersion", "radarBand")
            if any(first["identification"].get(key) is None or first["identification"][key] != second["identification"].get(key) for key in identity):
                raise ValueError("Incompatible GCOV acquisition identity")
            a, b = first["frequencies"]["A"], second["frequencies"]["A"]
            crids = [re.search(r"_([A-Z]\d{5})_", item["source"]) for item in (first, second)]
            if any(crid is None for crid in crids) or crids[0].group(1) != crids[1].group(1):
                raise ValueError("Processing configurations differ; assess compatibility explicitly")
            if any(frequency["backscatter"]["units"] != "dB" for frequency in (a, b)):
                raise ValueError("Backscatter differences require dB inputs")
            for key in ("source_crs", "shape", "transform"):
                if a[key] != b[key]:
                    raise ValueError(f"GCOV {key} differs; resample explicitly")
            if abs(a["transform"][0]) != 10 or abs(a["transform"][4]) != 10:
                raise ValueError("Hotspot display requires the expected 10 m GCOV grid")
            if first["aoi"] != second["aoi"] or a["backscatter"]["layer"] != b["backscatter"]["layer"]:
                raise ValueError("GCOV AOI or polarization differs")
            rasters, validity = [], []
            for path, frequency in ((first_path, a), (second_path, b)):
                with rasterio.open(path.parent / frequency["backscatter"]["file"]) as src:
                    raster = src.read(1, masked=True)
                    if list(src.shape) != frequency["shape"] or src.crs.to_string() != frequency["source_crs"] or list(src.transform)[:6] != frequency["transform"]:
                        raise ValueError("GCOV raster differs from its declared grid")
                    reference = {"crs": src.crs, "transform": src.transform}
                with rasterio.open(path.parent / frequency["analysis_valid_mask"]["file"]) as mask:
                    if mask.shape != raster.shape or mask.crs != reference["crs"] or mask.transform != reference["transform"]:
                        raise ValueError("GCOV quality mask grid differs")
                    valid = (mask.read(1) == 1) & (mask.read_masks(1) > 0) & ~np.ma.getmaskarray(raster)
                rasters.append(raster.data)
                validity.append(valid)
            values, valid = difference(rasters[0], rasters[1], validity[0], validity[1])
            start = first["identification"]["zeroDopplerStartTime"]
            end = second["identification"]["zeroDopplerStartTime"]
            directory = location / "gcov_change" / f"{start[:10]}_{end[:10]}_HH"
            directory.mkdir(parents=True, exist_ok=True)
            save_geotiff(directory / "change.tif", values, reference, nodata=np.nan, predictor=3, description="HH backscatter difference: later minus earlier dB")
            heat, hot = hotspots(rasters[0], rasters[1], valid)
            save_geotiff(directory / "hotspots.tif", heat, reference, nodata=np.nan, predictor=3, description="Spatially supported absolute HH log-ratio change; not displacement")
            overlay_bounds = write_overlay(directory / "hotspots.png", heat, reference)
            bounds = json.loads((first_path.parent / a["bounds_file"]).read_text())
            write_json(directory / "metadata.json", {
                "product": "GCOV_CHANGE", "aoi": first["aoi"], "identification": second["identification"],
                "before_id": first_path.parent.name, "after_id": second_path.parent.name,
                "start_at": start, "end_at": end, "sources": [first["source"], second["source"]],
                "bounds": bounds, "source_crs": a["source_crs"], "shape": a["shape"], "transform": a["transform"],
                "units": "dB", "polarization": "HH", "display_min": -6, "display_max": 6,
                "valid_pixel_count": int(valid.sum()),
                "hotspots": {"file": "hotspots.png", "bounds": overlay_bounds, "threshold_db": 3, "maximum_db": 9,
                    "window_pixels": 9, "window_m": 90, "minimum_patch_m2": 10000, "minimum_valid_fraction": 0.9,
                    "highlighted_pixel_count": int(hot.sum()),
                    "method": "9x9 moving mean of linear intensity on shared-valid pixels, then absolute 10log10(later/earlier). Require at least 90% neighborhood support and valid center; show >=3 dB in 8-connected patches >=100 pixels (1 ha). Exploratory screening, not a validated landslide classifier."},
                "method": "Later minus earlier HH backscatter in dB, using the intersection of native validity and both exported GCOV analysis-valid masks. No spatial averaging or classification.",
            })
            print(f"{location.name}: {start[:10]} -> {end[:10]}, {int(valid.sum())} valid pixels", flush=True)


if __name__ == "__main__":
    build()
