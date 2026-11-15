"""Extract native NISAR GOFF pixel offsets and quality layers without resampling.

Each polarization/window layer retains its own source grid and units. Offsets
are not filtered, converted to velocity, or interpreted as landslide detections.
"""

import json
from pathlib import Path

import h5py
import numpy as np

from helpers import (
    geographic_bounds,
    json_value,
    read_aoi_grid,
    read_raster_layer,
    save_geotiff,
    source_stem,
    validate_aoi,
    write_json,
)


PRODUCT = "/science/LSAR/GOFF"
POLARIZATIONS = ("HH", "VV", "HV", "VH", "RH", "RV")
OFFSET_LAYERS = ("layer1", "layer2", "layer3")
RASTER_LAYERS = (
    "alongTrackOffset",
    "slantRangeOffset",
    "alongTrackOffsetVariance",
    "slantRangeOffsetVariance",
    "crossOffsetVariance",
    "correlationSurfacePeak",
    "snr",
)
REQUIRED_LAYERS = ("alongTrackOffset", "slantRangeOffset")


def _selection(values, supported, name):
    """Validate explicit selections while defaulting to every supported item."""
    if values is None:
        return supported

    if isinstance(values, str):
        raise ValueError(f"{name} must be a nonempty sequence, not a string.")

    selected = tuple(dict.fromkeys(values))

    if not selected or any(value not in supported for value in selected):
        raise ValueError(f"{name} must be a nonempty selection from {supported}.")

    return selected


def _read_grid(group, points, url, names, coordinate_groups=(), required=()):
    """Read one native grid, preferring its own coordinates over parent grids."""
    coordinate_names = ("xCoordinates", "yCoordinates", "projection")
    coordinates = None

    for candidate in (group, *coordinate_groups):
        if all(name in candidate for name in coordinate_names):
            coordinates = candidate
            break

    if coordinates is None:
        raise ValueError(f"No geocoded coordinates found for {group.name}.")

    grid = read_aoi_grid(coordinates, points, url)
    layers = {}
    missing_layers = []

    for name in names:
        if name not in group:
            if name in required:
                raise ValueError(f"Required GOFF layer missing: {group.name}/{name}")
            missing_layers.append(name)
            continue

        dataset = group[name]

        if not isinstance(dataset, h5py.Dataset) or dataset.shape != grid["shape"]:
            raise ValueError(f"{dataset.name} does not match its GOFF grid.")

        layers[name] = read_raster_layer(dataset, grid["window"], grid["area"])

    return {
        "crs": grid["crs"],
        "transform": grid["transform"],
        "area": grid["area"],
        "layers": layers,
        "missing_layers": missing_layers,
    }


def read_aoi(
    stream, url, aoi_points, frequency="A", *, polarizations=None, layers=None
):
    """Read GOFF AOI windows through one connection for the acquisition pair.

    By default, read all available supported polarizations and offset layers.
    Explicit selections must exist for each requested polarization/layer pair.
    The shared pixelOffsets mask is read on its own grid, without resampling it
    onto the individual offset grids or applying quality thresholds.
    """
    if frequency not in {"A", "B"}:
        raise ValueError("frequency must be 'A' or 'B'.")

    selected_pols = _selection(polarizations, POLARIZATIONS, "polarizations")
    selected_layers = _selection(layers, OFFSET_LAYERS, "layers")
    points = validate_aoi(aoi_points)
    base = f"{PRODUCT}/grids/frequency{frequency}/pixelOffsets"
    grids = {}
    missing_grids = []
    has_valid_offsets = False

    with stream.open(url) as remote:
        with h5py.File(remote, "r") as h5:
            if base not in h5:
                raise ValueError(f"{base} missing in {url}")

            offsets = h5[base]

            if "mask" in offsets:
                grids["pixelOffsets"] = _read_grid(offsets, points, url, ("mask",))

            available_pols = []

            for pol in selected_pols:
                if pol not in offsets:
                    if polarizations is not None:
                        raise ValueError(
                            f"Requested GOFF polarization missing: {base}/{pol}"
                        )
                    continue

                available_pols.append(pol)
                pol_group = offsets[pol]
                available_layers = []

                for layer_name in selected_layers:
                    grid_name = f"pixelOffsets/{pol}/{layer_name}"

                    if layer_name not in pol_group:
                        if layers is not None:
                            raise ValueError(
                                f"Requested GOFF grid missing: {base}/{pol}/{layer_name}"
                            )
                        missing_grids.append(grid_name)
                        continue

                    grid = _read_grid(
                        pol_group[layer_name],
                        points,
                        url,
                        RASTER_LAYERS,
                        coordinate_groups=(pol_group, offsets),
                        required=REQUIRED_LAYERS,
                    )
                    grid["polarization"] = pol
                    grid["offset_layer"] = layer_name
                    grids[grid_name] = grid
                    available_layers.append(layer_name)

                    along = grid["layers"]["alongTrackOffset"]
                    slant = grid["layers"]["slantRangeOffset"]
                    if (along["valid"] & slant["valid"]).any():
                        has_valid_offsets = True

                if not available_layers:
                    raise ValueError(
                        f"No requested GOFF offset layers found in {pol_group.name}."
                    )

            if not available_pols:
                raise ValueError(f"No requested polarizations found in {base}.")

            if not has_valid_offsets:
                raise ValueError("No valid paired GOFF offsets inside the AOI.")

            identification = {}
            identification_path = "/science/LSAR/identification"

            if identification_path in h5:
                for name, dataset in h5[identification_path].items():
                    if not isinstance(dataset, h5py.Dataset):
                        continue

                    if dataset.ndim > 1 or dataset.size > 64:
                        continue

                    identification[name] = json_value(dataset[()])

            omitted_cubes = []
            cube_path = f"{PRODUCT}/metadata/radarGrid"

            if cube_path in h5:
                for dataset in h5[cube_path].values():
                    if isinstance(dataset, h5py.Dataset) and dataset.ndim == 3:
                        omitted_cubes.append(dataset.name)

    return {
        "source": url,
        "frequency": frequency,
        "aoi": {"type": "Polygon", "coordinates": [points.tolist()]},
        "identification": identification,
        "grids": grids,
        "missing_grids": missing_grids,
        "missing_quality_layers": [] if "pixelOffsets" in grids else ["pixelOffsets/mask"],
        "omitted_metadata_cubes": omitted_cubes,
    }


def _visualization(name, layer):
    """Describe display ranges without modifying scientific measurements."""
    if name == "mask":
        return {"rendering": "categorical", "interpolation": "nearest"}

    if name == "correlationSurfacePeak":
        return {"colormap": "viridis", "min": 0, "max": 1}

    values = layer["data"][layer["valid"]]

    if not values.size:
        return {"rendering": "no valid pixels"}

    low, high = np.percentile(values, [2, 98])

    if name in {"alongTrackOffset", "slantRangeOffset", "crossOffsetVariance"}:
        limit = max(abs(float(low)), abs(float(high))) or 1.0
        return {"colormap": "RdBu_r", "min": -limit, "max": limit}

    return {"colormap": "viridis", "min": float(low), "max": float(high)}


def convert_hdf5(
    stream, url, aoi_points, output_dir, frequency="A", *, polarizations=None, layers=None
):
    """Export flat native GeoTIFFs, per-grid bounds, and merged metadata.

    Pass data/{location}/goff as output_dir. Files are saved under {stem}/,
    for example HH_layer1_alongTrackOffset.tif and offsets_mask.tif. Frequency
    B uses a frequencyB_ filename prefix and frequencyB_bounds.json. Metadata
    retains both frequencies and describes the native grid for every raster.
    """
    stem = source_stem(url)
    reference = read_aoi(
        stream, url, aoi_points, frequency, polarizations=polarizations, layers=layers
    )
    directory = Path(output_dir) / stem
    directory.mkdir(parents=True, exist_ok=True)
    prefix = "" if frequency == "A" else "frequencyB_"
    paths = {
        "directory": directory,
        "bounds": directory / f"{prefix}bounds.json",
        "metadata": directory / "metadata.json",
        "layers": {},
    }
    bounds = {}
    grid_metadata = {}

    for grid_name, grid in reference["grids"].items():
        layer_metadata = {}

        for name, layer in grid["layers"].items():
            if grid_name == "pixelOffsets":
                filename = f"offsets_{name}"
            else:
                filename = f"{grid['polarization']}_{grid['offset_layer']}_{name}"

            path = directory / f"{prefix}{filename}.tif"
            save_geotiff(path, layer["data"], grid, valid=layer["valid"], description=name)
            paths["layers"][f"{grid_name}/{name}"] = path
            layer_metadata[name] = {
                "file": path.name,
                "source_path": layer["source_path"],
                "dtype": str(layer["data"].dtype),
                "attributes": layer["attributes"],
                "valid_pixel_count": int(layer["valid"].sum()),
                "visualization": _visualization(name, layer),
            }

        bounds[grid_name] = geographic_bounds(
            grid["area"].shape, grid["transform"], grid["crs"]
        )
        grid_metadata[grid_name] = {
            "source_crs": grid["crs"],
            "shape": list(grid["area"].shape),
            "transform": list(grid["transform"])[:6],
            "bounds_key": grid_name,
            "layers": layer_metadata,
            "missing_layers": grid["missing_layers"],
        }

        if "polarization" in grid:
            grid_metadata[grid_name]["polarization"] = grid["polarization"]
            grid_metadata[grid_name]["offset_layer"] = grid["offset_layer"]

    metadata = {}

    if paths["metadata"].exists():
        metadata = json.loads(paths["metadata"].read_text(encoding="utf-8"))

    metadata.update(
        {
            "source": url,
            "product": "GOFF",
            "aoi": reference["aoi"],
            "identification": reference["identification"],
            "processing": (
                "AOI clipping only; source grids, native values, and dtypes preserved"
            ),
            "validity": (
                "Read GeoTIFF internal masks with masked=True; "
                "invalid stored values are zero"
            ),
            "limitations": [
                (
                    "Offsets are unfiltered and can contain outliers; "
                    "quality layers are exported separately."
                ),
                (
                    "The shared quality mask is not resampled "
                    "or applied to individual offset grids."
                ),
                (
                    "No quality thresholds, velocity conversion, "
                    "or landslide classification are applied."
                ),
                (
                    "3-D metadata cubes require terrain-height interpolation "
                    "and are not exported as 2-D rasters."
                ),
            ],
        }
    )
    frequencies = metadata.setdefault("frequencies", {})
    frequencies[frequency] = {
        "bounds_file": paths["bounds"].name,
        "grids": grid_metadata,
        "missing_grids": reference["missing_grids"],
        "missing_quality_layers": reference["missing_quality_layers"],
        "omitted_metadata_cubes": reference["omitted_metadata_cubes"],
    }
    write_json(paths["bounds"], bounds)
    write_json(paths["metadata"], metadata)

    return paths
