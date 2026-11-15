import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "process"))
from evidence_algorithms import drainage, hls_ndvi, hls_rgb


class EvidenceAlgorithms(unittest.TestCase):
    def test_optical_clouds_are_opaque_and_outside_study_is_transparent(self):
        channels = np.full((1, 4, 3), 1500, dtype=np.float32)
        qa = np.array([[0, 2, 255, 0]], dtype=np.uint8)
        study = np.array([[True, True, True, False]])
        rgba, valid = hls_rgb(channels, qa, study)
        self.assertEqual(valid.tolist(), [[True, False, False, False]])
        self.assertEqual(rgba[0, :, 3].tolist(), [255, 255, 255, 0])
        self.assertEqual(rgba[0, 1, :3].tolist(), [35, 39, 37])
        self.assertEqual(rgba[0, 2, :3].tolist(), [35, 39, 37])

    def test_optical_stretch_is_fixed_and_invalid_reflectance_is_masked(self):
        channels = np.array([[[0, 1500, 3000], [-9999, 1500, 3000]]], dtype=np.float32)
        rgba, valid = hls_rgb(channels, np.zeros((1, 2), dtype=np.uint8), np.ones((1, 2), dtype=bool))
        self.assertEqual(rgba[0, 0].tolist(), [0, 186, 255, 255])
        self.assertFalse(valid[0, 1])
        self.assertEqual(rgba[0, 1].tolist(), [35, 39, 37, 255])

    def test_ndvi_uses_nir_red_ratio_and_rejects_quality_flags(self):
        qa = np.array([[0, 1, 2, 4, 8, 16, 32, 192, 255]], dtype=np.uint8)
        red = np.full(qa.shape, 1000, dtype=np.int16)
        nir = np.full(qa.shape, 3000, dtype=np.int16)
        actual = hls_ndvi(red, nir, qa)
        self.assertAlmostEqual(actual[0, 0], .5)
        self.assertAlmostEqual(actual[0, 6], .5)  # water bit alone isn't cloud
        self.assertTrue(np.isnan(actual[0, [1, 2, 3, 4, 5, 7, 8]]).all())

    def test_ndvi_rejects_fill_zero_denominator_and_unphysical_ratio(self):
        red = np.array([[0, -9999, -1, 1000]], dtype=np.int16)
        nir = np.array([[0, 3000, 3000, 3000]], dtype=np.int16)
        actual = hls_ndvi(red, nir, np.zeros(red.shape, dtype=np.uint8))
        self.assertTrue(np.isnan(actual[0, :3]).all())
        self.assertAlmostEqual(actual[0, 3], .5)

    def test_drainage_has_no_cycles_and_conserves_contributing_cells(self):
        # A depression surrounded by flats must still reach a border outlet.
        dem = np.array([[5, 5, 5, 4, 3], [5, 6, 6, 5, 3], [5, 6, 0, 5, 3], [5, 6, 6, 5, 3], [5, 5, 5, 4, 3]], dtype=float)
        receiver, counts = drainage(dem)
        flat = receiver.ravel()
        self.assertEqual(int(counts.ravel()[flat < 0].sum()), dem.size)
        for start in range(dem.size):
            visited = set()
            current = start
            while current >= 0:
                self.assertNotIn(current, visited)
                visited.add(current)
                current = int(flat[current])
            outlet = next(index for index in visited if flat[index] < 0)
            row, col = divmod(outlet, dem.shape[1])
            self.assertTrue(row in (0, dem.shape[0]-1) or col in (0, dem.shape[1]-1))

    def test_missing_elevation_cannot_be_silently_routed(self):
        with self.assertRaises(ValueError):
            drainage(np.array([[0, 0, 0], [0, np.nan, 0], [0, 0, 0]]))


if __name__ == "__main__":
    unittest.main()
