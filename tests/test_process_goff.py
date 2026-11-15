"""Offline GOFF extraction checks using small, representative HDF5 products.

Run with process/.venv/Scripts/python.exe -B -m unittest discover -s tests -p test_process_goff.py.
"""

from contextlib import contextmanager, redirect_stdout
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import h5py
import numpy as np
import rasterio
from rasterio.warp import transform_geom

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "process"))
import goff


class LocalStream:
    def __init__(self, path):
        self.path = path
        self.opens = 0

    @contextmanager
    def open(self, url):
        self.opens += 1
        with self.path.open("rb") as source:
            yield source


def coordinates(group, size=40, spacing=80):
    group.create_dataset("xCoordinates", data=500000 + np.arange(size) * spacing)
    group.create_dataset("yCoordinates", data=1700000 - np.arange(size) * spacing)
    group.create_dataset("projection", data=0).attrs["epsg_code"] = 32651


def offset_layer(parent, name, size=40, spacing=80, own_coordinates=True):
    group = parent.create_group(name)
    if own_coordinates:
        coordinates(group, size, spacing)

    for field in goff.RASTER_LAYERS:
        data = np.full((size, size), 0.1, dtype=np.float32)
        if field in goff.REQUIRED_LAYERS:
            data[:] = -2
            data[12, 12] = 0
            data[10, 10] = np.nan
            data[10, 11] = -9999
            data[10, 12] = np.inf
        if field == "snr":
            data[:] = 0
        if field == "crossOffsetVariance":
            data[:] = -0.5
        dataset = group.create_dataset(field, data=data)
        dataset.attrs["_FillValue"] = -9999.0
        dataset.attrs["units"] = "meters" if field in goff.REQUIRED_LAYERS else "1"
    return group


class GOFFExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source.h5"
        self.output = self.root / "exports"
        self.url = "https://example.test/GOFF%20pair.h5?download=1"
        polygon = {
            "type": "Polygon",
            "coordinates": [[
                [500660, 1699340], [501660, 1699340],
                [501660, 1698340], [500660, 1698340],
                [500660, 1699340],
            ]],
        }
        self.aoi = transform_geom("EPSG:32651", "EPSG:4326", polygon)["coordinates"][0]
        with h5py.File(self.source, "w") as h5:
            identification = h5.create_group("/science/LSAR/identification")
            identification.create_dataset("referenceZeroDopplerStartTime", data=b"2026-08-22T00:00:00Z")
            identification.create_dataset("trackNumber", data=62)
            identification.create_dataset("large_array", data=np.arange(65))
            identification.create_group("not_a_dataset")
            cubes = h5.create_group(f"{goff.PRODUCT}/metadata/radarGrid")
            cubes.create_dataset("incidenceAngle", shape=(2, 3, 4), dtype=np.float32)
            for frequency in ("A", "B"):
                offsets = h5.create_group(f"{goff.PRODUCT}/grids/frequency{frequency}/pixelOffsets")
                coordinates(offsets, 20, 160)
                mask = np.full((20, 20), 11, dtype=np.uint32)
                mask[6, 6] = (1 << 16) | 11
                dataset = offsets.create_dataset("mask", data=mask)
                dataset.attrs["_FillValue"] = np.uint32(4294967295)
                hh = offsets.create_group("HH")
                offset_layer(hh, "layer1")
                offset_layer(hh, "layer2", 80, 40)
                offset_layer(hh, "layer3", 20, 160, own_coordinates=False)
                vv = offsets.create_group("VV")
                offset_layer(vv, "layer1")
        self.stream = LocalStream(self.source)

    def convert(self, **options):
        return goff.convert_hdf5(self.stream, self.url, self.aoi, self.output, **options)

    def test_native_exports_preserve_values_dtypes_and_internal_masks(self):
        paths = self.convert()
        self.assertEqual(self.stream.opens, 1)
        self.assertEqual(paths["directory"].name, "GOFF pair")
        self.assertEqual(len(paths["layers"]), 29)
        key = "pixelOffsets/HH/layer1/alongTrackOffset"
        with rasterio.open(paths["layers"][key]) as raster:
            self.assertEqual(raster.dtypes, ("float32",))
            self.assertEqual(raster.crs.to_epsg(), 32651)
            self.assertEqual(raster.transform.a, 80)
            self.assertLess(raster.width, 40)
            data = raster.read(1, masked=True)
            self.assertTrue((data.compressed() == 0).any())
            self.assertTrue((data.compressed() < 0).any())
            self.assertTrue(data.mask.any())
            self.assertTrue(np.isfinite(data.compressed()).all())
            self.assertFalse((data.compressed() == -9999).any())
            self.assertTrue((raster.read(1)[data.mask] == 0).all())
            self.assertEqual(raster.descriptions, ("alongTrackOffset",))
            row = round((1700040 - raster.transform.f) / 80)
            col = round((raster.transform.c - 499960) / 80)
            with h5py.File(self.source, "r") as h5:
                original = h5[f"{goff.PRODUCT}/grids/frequencyA/{key}"][
                    row:row + raster.height, col:col + raster.width
                ]
            np.testing.assert_array_equal(data.compressed(), original[~data.mask])
        with rasterio.open(paths["layers"]["pixelOffsets/mask"]) as raster:
            self.assertEqual(raster.dtypes, ("uint32",))
            self.assertIn((1 << 16) | 11, raster.read(1, masked=True).compressed())
        with rasterio.open(paths["layers"]["pixelOffsets/HH/layer1/snr"]) as raster:
            self.assertTrue((raster.read(1, masked=True).compressed() == 0).all())
        self.assertFalse(list(paths["directory"].glob("*.msk")))

    def test_per_layer_and_shared_grids_have_independent_bounds_and_metadata(self):
        paths = self.convert()
        metadata = json.loads(paths["metadata"].read_text())
        bounds = json.loads(paths["bounds"].read_text())
        grids = metadata["frequencies"]["A"]["grids"]
        for name, spacing in (("pixelOffsets", 160), ("pixelOffsets/HH/layer1", 80),
                              ("pixelOffsets/HH/layer2", 40), ("pixelOffsets/HH/layer3", 160)):
            self.assertEqual(grids[name]["transform"][0], spacing)
            self.assertIn(name, bounds)
        self.assertNotEqual(grids["pixelOffsets/HH/layer1"]["shape"], grids["pixelOffsets/HH/layer2"]["shape"])
        self.assertNotEqual(bounds["pixelOffsets/HH/layer1"], bounds["pixelOffsets/HH/layer2"])
        details = grids["pixelOffsets/HH/layer1"]["layers"]["alongTrackOffset"]
        with rasterio.open(paths["directory"] / details["file"]) as raster:
            self.assertEqual(details["valid_pixel_count"], int((raster.read_masks(1) > 0).sum()))
        self.assertEqual(details["attributes"]["units"], "meters")
        self.assertEqual(metadata["identification"]["trackNumber"], 62)
        self.assertNotIn("large_array", metadata["identification"])
        self.assertEqual(metadata["product"], "GOFF")
        self.assertEqual(len(metadata["frequencies"]["A"]["omitted_metadata_cubes"]), 1)
        self.assertIn("pixelOffsets/VV/layer2", metadata["frequencies"]["A"]["missing_grids"])

    def test_frequency_b_does_not_overwrite_frequency_a(self):
        a = self.convert(polarizations=("HH",), layers=("layer1",))
        before = {path: path.read_bytes() for path in (a["bounds"], *a["layers"].values())}
        b = self.convert(frequency="B", polarizations=("HH",), layers=("layer2",))
        metadata = json.loads(b["metadata"].read_text())
        self.assertEqual(set(metadata["frequencies"]), {"A", "B"})
        self.assertEqual(b["bounds"].name, "frequencyB_bounds.json")
        self.assertTrue(all(path.name.startswith("frequencyB_") for path in b["layers"].values()))
        for path, content in before.items():
            self.assertEqual(path.read_bytes(), content)

    def test_optional_quality_is_reported_when_missing(self):
        with h5py.File(self.source, "a") as h5:
            offsets = h5[f"{goff.PRODUCT}/grids/frequencyA/pixelOffsets"]
            del offsets["mask"]
            del offsets["HH/layer1/snr"]
        paths = self.convert(polarizations=("HH",), layers=("layer1",))
        frequency = json.loads(paths["metadata"].read_text())["frequencies"]["A"]
        self.assertEqual(frequency["missing_quality_layers"], ["pixelOffsets/mask"])
        self.assertIn("snr", frequency["grids"]["pixelOffsets/HH/layer1"]["missing_layers"])

    def test_polarization_coordinates_are_used_when_layer_coordinates_are_absent(self):
        with h5py.File(self.source, "a") as h5:
            hh = h5[f"{goff.PRODUCT}/grids/frequencyA/pixelOffsets/HH"]
            coordinates(hh, 20, 160)
        reference = goff.read_aoi(self.stream, self.url, self.aoi, polarizations=("HH",), layers=("layer3",))
        self.assertEqual(reference["grids"]["pixelOffsets/HH/layer3"]["transform"].a, 160)

    def test_invalid_arguments_fail_before_opening_the_source(self):
        cases = [dict(frequency="C"), dict(polarizations=()), dict(polarizations="HH"),
                 dict(polarizations=("XX",)), dict(layers=()), dict(layers="layer1"),
                 dict(layers=("layer9",))]
        for options in cases:
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.convert(**options)
        with self.assertRaises(ValueError):
            goff.read_aoi(self.stream, self.url, self.aoi[:-1])
        self.assertEqual(self.stream.opens, 0)
        self.assertFalse(self.output.exists())

    def test_explicit_missing_polarizations_and_layers_fail(self):
        for options in (dict(polarizations=("HV",)), dict(polarizations=("VV",), layers=("layer2",))):
            with self.subTest(options=options), self.assertRaisesRegex(ValueError, "Requested GOFF"):
                self.convert(**options)
        self.assertFalse(self.output.exists())

    def test_missing_required_offset_fails_before_export(self):
        with h5py.File(self.source, "a") as h5:
            del h5[f"{goff.PRODUCT}/grids/frequencyA/pixelOffsets/HH/layer1/slantRangeOffset"]
        with self.assertRaisesRegex(ValueError, "Required GOFF layer missing"):
            self.convert()
        self.assertFalse(self.output.exists())

    def test_mismatched_raster_shape_fails_before_export(self):
        with h5py.File(self.source, "a") as h5:
            group = h5[f"{goff.PRODUCT}/grids/frequencyA/pixelOffsets/HH/layer1"]
            del group["snr"]
            group.create_dataset("snr", shape=(3, 4), dtype=np.float32)
        with self.assertRaisesRegex(ValueError, "does not match its GOFF grid"):
            self.convert()
        self.assertFalse(self.output.exists())

    def test_no_valid_paired_offsets_fails_before_export(self):
        with h5py.File(self.source, "a") as h5:
            group = h5[f"{goff.PRODUCT}/grids/frequencyA/pixelOffsets/HH/layer1"]
            group["alongTrackOffset"][:] = np.nan
        with self.assertRaisesRegex(ValueError, "No valid paired GOFF offsets"):
            self.convert(polarizations=("HH",), layers=("layer1",))
        self.assertFalse(self.output.exists())

    def test_missing_product_and_uncovered_aoi_fail_clearly(self):
        with h5py.File(self.source, "a") as h5:
            del h5[f"{goff.PRODUCT}/grids/frequencyB"]
        with self.assertRaisesRegex(ValueError, "missing in"):
            self.convert(frequency="B")
        aoi = [(0, 0), (1, 0), (1, 1), (0, 0)]
        with self.assertRaisesRegex(ValueError, "AOI not covered"):
            goff.read_aoi(self.stream, self.url, aoi)

    def test_runner_searches_and_extracts_goff_alongside_existing_products(self):
        import main

        stream = Mock()
        for setter in ("setAOI", "setProcessingLevel", "setDateRange", "setMaxResults", "setFlightDirection"):
            getattr(stream, setter).return_value = stream
        stream.search.return_value = [self.url]
        extract = Mock(return_value={"directory": self.output})
        with patch.multiple(
            main, NISARStream=Mock(return_value=stream), DATA_DIR=self.output,
            extract_gcov=extract, extract_gunw=extract, extract_goff=extract,
        ), redirect_stdout(io.StringIO()):
            main.extract_mount_balikabok()
        self.assertEqual(
            [call.args[0] for call in stream.setProcessingLevel.call_args_list],
            ["GCOV", "GUNW", "GOFF"],
        )
        goff_call = extract.call_args_list[-1]
        self.assertEqual(goff_call.args[:2], (stream, self.url))
        self.assertEqual(goff_call.kwargs, {"output_dir": self.output / "mount_balikabok" / "goff"})


if __name__ == "__main__":
    unittest.main()
