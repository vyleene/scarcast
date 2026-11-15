"""Retrieve independent evidence for Balikabok; never modifies GCOV/GUNW.

Use --inventory to query CMR, --probe to check access, and --extract to export.
Earthdata credentials are read from the existing environment or local netrc.
Credentials and signed URLs are never written to output.
"""
import argparse
from datetime import datetime, timezone
import json
import netrc
import os
from pathlib import Path
import tempfile

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "balikabok_downstream" / "evidence"
BBOX = (120.34, 14.80, 120.57, 14.97)
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"


def search(name, version, temporal=None):
    params = {"short_name": name, "version": version, "page_size": 200,
              "bounding_box": ",".join(map(str, BBOX)), "sort_key": "start_date"}
    if temporal:
        params["temporal"] = temporal
    response = requests.get(CMR, params=params, timeout=60)
    response.raise_for_status()
    entries = response.json()["feed"]["entry"]
    if len(entries) >= 200:
        raise RuntimeError("Catalog pagination required; refusing a truncated inventory")
    return [{"id": e["title"], "date": e["time_start"], "cloud_cover": e.get("cloud_cover"),
             "concept_id": e["id"], "links": [link["href"] for link in e.get("links", [])
              if not link.get("inherited") and link["href"].startswith("https://")
              and link.get("rel", "").endswith("/data#")]}
            for e in entries]


def inventory():
    period = "2026-08-01T00:00:00Z,2026-09-28T23:59:59Z"
    result = {"queried_at": datetime.now(timezone.utc).isoformat(), "bbox": BBOX}
    for name, version, temporal in [
        ("NASADEM_HGT", "001", None),
        ("HLSS30", "2.0", period),
        ("HLSS30", "2.0", "2026-04-06T00:00:00Z,2026-04-07T00:00:00Z"),
        ("GPM_3IMERGDF", "07", period),
        ("GPM_3IMERGDL", "07", period),
    ]:
        entries = search(name, version, temporal)
        result.setdefault(name, []).extend(entries)
        print(f"{name}: {len(entries)} granules", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "catalog.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def session():
    import earthaccess
    previous = {key: os.environ.get(key) for key in ("EARTHDATA_USERNAME", "EARTHDATA_PASSWORD")}
    try:
        if not all(previous.values()):
            for filename in (".netrc", "_netrc"):
                path = Path.home() / filename
                if path.is_file():
                    auth = netrc.netrc(str(path)).authenticators("urs.earthdata.nasa.gov")
                    if auth:
                        os.environ["EARTHDATA_USERNAME"], os.environ["EARTHDATA_PASSWORD"] = auth[0], auth[2]
                        break
        auth = earthaccess.login(strategy="environment", persist=False)
        if not auth.authenticated:
            raise RuntimeError("Earthdata login failed")
        return earthaccess.get_requests_https_session()
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def cached_download(client, url):
    # A cache outside the checkout keeps large remote inputs out of Vite's glob.
    cache = Path(tempfile.gettempdir()) / "scarcast-corroboration-inputs"
    cache.mkdir(exist_ok=True)
    path = cache / url.rsplit("/", 1)[-1]
    if path.exists():
        return path
    response = client.get(url, timeout=120)
    response.raise_for_status()
    if "text/html" in response.headers.get("Content-Type", ""):
        raise RuntimeError("Download returned an authentication page")
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_bytes(response.content)
    temporary.replace(path)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", action="store_true")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--extract", action="store_true")
    parser.add_argument("--rainfall-probe", action="store_true")
    args = parser.parse_args()
    catalog = inventory() if args.inventory or not (OUT / "catalog.json").exists() else json.loads((OUT / "catalog.json").read_text())
    if args.rainfall_probe:
        url = catalog["GPM_3IMERGDL"][0]["links"][0].replace("https://data.gesdisc.earthdata.nasa.gov/data/", "https://gpm1.gesdisc.eosdis.nasa.gov/opendap/")
        client = requests.Session()
        for filename in (".netrc", "_netrc"):
            path = Path.home() / filename
            if path.is_file():
                credentials = netrc.netrc(str(path)).authenticators("urs.earthdata.nasa.gov")
                if credentials:
                    client.auth = (credentials[0], credentials[2])
                    break
        response = client.get(url + ".ascii?precipitation[0:1:0][3003:1:3005][1048:1:1049],precipitation_cnt[0:1:0][3003:1:3005][1048:1:1049]", timeout=60)
        print("Rainfall authenticated access", response.status_code, flush=True)
        if response.ok:
            print(response.text[:5000])
    if args.probe:
        client = session()
        path = cached_download(client, catalog["NASADEM_HGT"][0]["links"][0])
        print(f"NASADEM downloaded: {path.stat().st_size} bytes")
        for name in ("GPM_3IMERGDF", "GPM_3IMERGDL"):
            records = catalog[name]
            if records:
                print(name, records[0]["id"], records[0]["links"])
        for item in catalog["HLSS30"]:
            if "T51PTS" in item["id"]:
                print(item["id"], "tile cloud %", item["cloud_cover"])
        records = catalog["GPM_3IMERGDF"] or catalog["GPM_3IMERGDL"]
        url = records[0]["links"][0]
        alternatives = [url, url.replace("data.gesdisc.earthdata.nasa.gov", "gpm1.gesdisc.eosdis.nasa.gov"),
                        url.replace("https://data.gesdisc.earthdata.nasa.gov/data/", "https://gpm1.gesdisc.eosdis.nasa.gov/opendap/") + ".dds"]
        for candidate in alternatives:
            response = client.get(candidate, headers={"Range": "bytes=0-500"}, timeout=60)
            print("Rainfall access", candidate.split('/')[2], response.status_code, response.headers.get("Content-Type"), len(response.content), flush=True)
            if response.ok and candidate.endswith(".dds"):
                print(response.text[:1500])
        base = alternatives[-1][:-4]
        for suffix in (".das", ".ascii?precipitation[0:1:0][3003:1:3005][1048:1:1049],precipitation_cnt[0:1:0][3003:1:3005][1048:1:1049]"):
            response = client.get(base + suffix, timeout=60)
            response.raise_for_status()
            if suffix == ".das":
                start = response.text.index("precipitation {")
                print(response.text[start:start+1000])
            else:
                print(response.text)
    if args.extract:
        from corroboration import extract
        extract(catalog, session())


if __name__ == "__main__":
    main()
