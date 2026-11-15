"""Search or extract an explicitly configured region without changing main.py.

Run with --config regions/balikabok_downstream.json to inspect the selection;
add --extract to authenticate and export. Paths are relative to this script.
"""
import argparse
import json
import netrc
import os
from pathlib import Path
import re

from helpers import DATA_DIR, validate_aoi, write_json
from stream import NISARStream


def select_urls(urls, product, config):
    selected = []
    direction = {"ASCENDING": "A", "DESCENDING": "D"}[config["flight_direction"].upper()]
    identity = f"_{config['track']:03d}_{direction}_{config['frame']:03d}_"
    for url in urls:
        name = url.rsplit("/", 1)[-1]
        if identity not in name or f"_{config['processing_configuration']}_" not in name:
            continue
        dates = re.findall(r"_(\d{8})T\d{6}", name)
        if len(dates) != (4 if product == "GUNW" else 2):
            continue
        start = dates[0]
        end = dates[2] if product == "GUNW" else start
        if config["start_date"].replace("-", "") <= start <= end <= config["end_date"].replace("-", ""):
            selected.append((start, end, url))
    return sorted(set(selected))


def authenticate(stream):
    """Use existing environment credentials or a saved netrc, without logging secrets."""
    keys = ("EARTHDATA_USERNAME", "EARTHDATA_PASSWORD")
    if all(os.environ.get(key) for key in keys):
        stream.authenticate()
        return
    for filename in (".netrc", "_netrc"):
        path = Path.home() / filename
        if not path.is_file():
            continue
        credentials = netrc.netrc(str(path)).authenticators("urs.earthdata.nasa.gov")
        if not credentials:
            continue
        previous = {key: os.environ.get(key) for key in keys}
        try:
            os.environ[keys[0]], os.environ[keys[1]] = credentials[0], credentials[2]
            stream.authenticate()
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
        return
    raise RuntimeError("Configure Earthdata credentials locally before extraction.")


def complete(directory, expected_aoi=None):
    metadata_path = directory / "metadata.json"
    if not metadata_path.is_file():
        return False
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if expected_aoi is not None and metadata.get("aoi", {}).get("coordinates") != [expected_aoi]:
        return False
    files = []
    for frequency in metadata.get("frequencies", {}).values():
        files.append(frequency["bounds_file"])
        if "backscatter" in frequency:
            files.append(frequency["backscatter"]["file"])
        if "analysis_valid_mask" in frequency:
            files.append(frequency["analysis_valid_mask"]["file"])
        files.extend(layer["file"] for layer in frequency.get("layers", {}).values())
        for grid in frequency.get("grids", {}).values():
            files.extend(layer["file"] for layer in grid["layers"].values())
    return bool(files) and all((directory / file).is_file() for file in files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--extract", action="store_true")
    parser.add_argument("--product", choices=("GCOV", "GUNW", "both"), default="both")
    args = parser.parse_args()
    config_path = Path(args.config)
    if not config_path.is_absolute():
        config_path = Path(__file__).parent / config_path
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if not re.fullmatch(r"[a-z][a-z0-9_]*", config["location"]):
        raise ValueError("Location must be a safe lowercase directory name.")
    points = validate_aoi(config["aoi"])
    aoi = "POLYGON((" + ",".join(f"{lon} {lat}" for lon, lat in points) + "))"
    products = ("GCOV", "GUNW") if args.product == "both" else (args.product,)
    stream = NISARStream().setAOI(aoi).setDateRange(config["start_date"], config["end_date"]).setFlightDirection(config["flight_direction"]).setMaxResults(100)
    inventory = {}
    for product in products:
        selected = select_urls(stream.setProcessingLevel(product).search(), product, config)
        inventory[product] = [{"start": start, "end": end, "url": url} for start, end, url in selected]
        print(f"{product}: {len(selected)} matching products", flush=True)
        for start, end, _ in selected:
            print(f"  {start} -> {end}", flush=True)
    if not args.extract:
        return
    if not any(inventory.values()):
        raise RuntimeError("No matching products; no output written.")
    authenticate(stream)
    # Catalog intersection is insufficient: verify complete study-area coverage.
    import asf_search
    from shapely import wkt
    from shapely.geometry import shape
    for product in products:
        for item in inventory[product]:
            stem = Path(item["url"]).stem
            results = asf_search.granule_search([stem])
            if not results or not shape(results[0].geometry).covers(wkt.loads(aoi)):
                raise RuntimeError(f"Full AOI coverage not established for {stem}; revise AOI or mosaic explicitly.")
    output = DATA_DIR / config["location"]
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "extraction-plan.json", {"config": config, "products": inventory})
    from gcov import convert_hdf5 as extract_gcov
    from gunw import convert_hdf5 as extract_gunw
    for product in products:
        for item in inventory[product]:
            directory = output / product.lower() / Path(item["url"]).stem
            if complete(directory, points.tolist()):
                print(f"Already complete: {directory.name}", flush=True)
                continue
            if directory.exists():
                raise RuntimeError(f"Existing output is incomplete or uses a different AOI; left untouched: {directory}")
            print(f"Extracting {product} {item['start']} -> {item['end']}", flush=True)
            extract = extract_gcov if product == "GCOV" else extract_gunw
            options = {} if product == "GCOV" else {"coherence_threshold": config["coherence_threshold"]}
            # The dashboard must never discover half-written TIFF/metadata sets.
            staging = output / "_staging" / product.lower()
            result = extract(stream, item["url"], points, output_dir=staging, **options)
            if not complete(result["directory"], points.tolist()):
                raise RuntimeError(f"Extraction incomplete; retained in staging: {result['directory']}")
            directory.parent.mkdir(parents=True, exist_ok=True)
            result["directory"].rename(directory)
            print(f"Saved {directory}", flush=True)


if __name__ == "__main__":
    main()
