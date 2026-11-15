"""Run with the Python environment containing process/requirements.txt."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "process"))
from change_hotspots import hotspots, window_sum


class ChangeHotspotTests(unittest.TestCase):
    def setUp(self):
        self.base = np.zeros((80, 80), dtype=np.float32)
        self.valid = np.ones((80, 80), dtype=bool)

    def test_unchanged_and_invalid_areas_remain_transparent(self):
        for valid in (self.valid, ~self.valid):
            values, kept = hotspots(self.base, self.base, valid)
            self.assertFalse(kept.any())
            self.assertTrue(np.isnan(values).all())

    def test_isolated_spike_is_not_a_supported_patch(self):
        after = self.base.copy()
        after[40, 40] = 40
        _, kept = hotspots(self.base, after, self.valid)
        self.assertFalse(kept.any())

    def test_broad_increases_and_decreases_show_true_center_magnitude(self):
        for value in (-6, 6):
            after = self.base.copy()
            after[20:60, 20:60] = value
            magnitude, kept = hotspots(self.base, after, self.valid)
            self.assertTrue(kept[40, 40])
            self.assertAlmostEqual(float(magnitude[40, 40]), 6, places=4)
            self.assertFalse(kept[5, 5])

    def test_masked_centers_are_not_filled_in(self):
        after = np.full_like(self.base, 6)
        self.valid[30:50, 30:50] = False
        magnitude, kept = hotspots(self.base, after, self.valid)
        self.assertFalse(kept[~self.valid].any())
        self.assertTrue(np.isnan(magnitude[~self.valid]).all())

    def test_moving_sum_matches_explicit_neighborhoods(self):
        values = np.arange(25).reshape(5, 5)
        result = window_sum(values, 3)
        self.assertEqual(result[2, 2], values[1:4, 1:4].sum())
        self.assertEqual(result[0, 0], values[:2, :2].sum())


if __name__ == "__main__":
    unittest.main()
