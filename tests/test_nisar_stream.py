"""Offline checks for CRID search filtering against the ASF search API."""

from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "process"))
from stream import NISARStream


class CRIDSearchTests(unittest.TestCase):
    def setUp(self):
        self.stream = (
            NISARStream()
            .setAOI("POLYGON((120 14,121 14,121 15,120 14))")
            .setDateRange("2026-08-21", "2026-09-16")
            .setMaxResults(3)
            .setFlightDirection("Ascending")
        )
        self.results = Mock()
        self.results.find_urls.return_value = ["https://example.test/data.h5"] * 2
        self.search = patch("stream.asf.search", autospec=True).start()
        self.addCleanup(patch.stopall)
        self.search.return_value = self.results

    def test_default_search_has_no_crid_filter(self):
        self.assertEqual(self.stream.search(), ["https://example.test/data.h5"])
        self.assertNotIn("granule_list", self.search.call_args.kwargs)
        self.assertIsNone(self.stream.crid)
        self.results.find_urls.assert_called_once_with(
            extension=".h5", pattern=r"^(?!.*QA_STATS).*", directAccess=False
        )

    def test_crid_is_normalized_and_sent_as_a_server_side_filter(self):
        self.assertIs(self.stream.setCRID(" x05016 "), self.stream)
        self.stream.search()
        self.search.assert_called_once_with(
            dataset=["NISAR"],
            processingLevel=["GCOV"],
            productionConfiguration=["PR"],
            flightDirection="ASCENDING",
            intersectsWith=self.stream.aoi,
            start="2026-08-21T00:00:00Z",
            end="2026-09-16T23:59:59Z",
            maxResults=3,
            granule_list=["NISAR_*_X05016_*"],
        )

    def test_crid_can_be_replaced_and_cleared(self):
        self.stream.setCRID("X05016").setCRID("P05012").search()
        self.assertEqual(self.search.call_args.kwargs["granule_list"], ["NISAR_*_P05012_*"])
        self.assertIs(self.stream.setCRID(None), self.stream)
        self.stream.search()
        self.assertNotIn("granule_list", self.search.call_args.kwargs)

    def test_invalid_crids_fail_without_replacing_an_existing_filter(self):
        self.stream.setCRID("X05016")
        for value in ("", " ", "05016", "X0501", "X050160", "X0501?", "*05016",
                      "X05016_P", "X０５０１６", 5016, ["X05016"]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.stream.setCRID(value)
            self.assertEqual(self.stream.crid, "X05016")
        self.search.assert_not_called()

    def test_crid_combines_with_each_geocoded_product_and_production_configuration(self):
        for product in ("GCOV", "GUNW", "GOFF"):
            with self.subTest(product=product):
                self.stream.setProcessingLevel(product).setProductionConfiguration("UR").setCRID("X05016").search()
                kwargs = self.search.call_args.kwargs
                self.assertEqual(kwargs["processingLevel"], [product])
                self.assertEqual(kwargs["productionConfiguration"], ["UR"])
                self.assertEqual(kwargs["granule_list"], ["NISAR_*_X05016_*"])
                self.assertEqual(kwargs["maxResults"], 3)


if __name__ == "__main__":
    unittest.main()
