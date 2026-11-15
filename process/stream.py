
from pathlib import Path
from contextlib import contextmanager
from datetime import date
import re

import earthaccess
import asf_search as asf

from dotenv import load_dotenv


class NISARStream:

    def __init__(self):
        self.dataset = "NISAR"
        self.aoi = None
        self.processing_level = "GCOV"
        self.production_configuration = "PR"
        self.crid = None
        self.flight_direction = None
        self.start_date = None
        self.end_date = None
        self.max_results = 100

        self._authenticated = False
        self._filesystem = None


    def setAOI(self, polygon):
        if not isinstance(polygon, str) or not polygon.strip():
            raise ValueError("AOI must be a nonempty WKT string.")

        self.aoi = polygon
        return self


    def setProcessingLevel(self, level):

        allowed = {
            "GCOV", "GUNW", "GOFF",
            "GSLC", "RSLC", "RIFG",
            "RUNW", "ROFF", "L0B", "SME2"
        }

        level = level.upper()

        if level not in allowed:
            raise ValueError(
                f"Unsupported processing level: {level}"
            )

        self.processing_level = level
        return self


    def setProductionConfiguration(self, config):

        config = config.upper()

        if config not in {"PR", "UR", "CR"}:
            raise ValueError(
                "Production configuration must be PR, UR, or CR."
            )

        self.production_configuration = config

        return self


    def setCRID(self, crid):
        """Filter by an exact Composite Release ID, or pass None to clear it."""
        if crid is None:
            self.crid = None
            return self

        if not isinstance(crid, str):
            raise ValueError("CRID must be a letter followed by five digits, e.g. X05016.")

        crid = crid.strip().upper()

        if re.fullmatch(r"[A-Z][0-9]{5}", crid) is None:
            raise ValueError("CRID must be a letter followed by five digits, e.g. X05016.")

        self.crid = crid
        return self


    def setFlightDirection(self, direction):

        direction = direction.upper()

        if direction not in {"ASCENDING", "DESCENDING"}:
            raise ValueError(
                "Flight direction must be "
                "'ASCENDING' or 'DESCENDING'."
            )

        self.flight_direction = direction

        return self


    def setDateRange(self, start, end):

        start_date = date.fromisoformat(start)
        end_date = date.fromisoformat(end)

        if start_date > end_date:
            raise ValueError(
                "Start date must not be after end date."
            )

        self.start_date = (
            f"{start_date.isoformat()}T00:00:00Z"
        )

        self.end_date = (
            f"{end_date.isoformat()}T23:59:59Z"
        )

        return self


    def setMaxResults(self, count):

        if not isinstance(count, int) or count < 1:
            raise ValueError("max_results must be positive.")

        self.max_results = count

        return self


    def authenticate(self):

        env_path = Path(__file__).resolve().parent / ".env"
        load_dotenv(dotenv_path=env_path)

        auth = earthaccess.login(
            strategy="environment"
        )

        if not auth.authenticated:
            raise RuntimeError(
                "NASA Earthdata authentication failed."
            )

        self._authenticated = True
        self._filesystem = earthaccess.get_fsspec_https_session()

        return self


    def search(self):

        if not self.aoi:
            raise ValueError(
                "Set an AOI using setAOI() first."
            )

        if not self.start_date or not self.end_date:
            raise ValueError(
                "Set a date range using setDateRange() first."
            )

        search_options = {}

        if self.crid is not None:
            # ASF exposes CRID through granule-name wildcards, not a CRID keyword.
            # Match the complete token and filter before maxResults is applied.
            search_options["granule_list"] = [f"NISAR_*_{self.crid}_*"]

        results = asf.search(
            dataset=[self.dataset],
            processingLevel=[self.processing_level],
            productionConfiguration=[
                self.production_configuration
            ],
            flightDirection=self.flight_direction,
            intersectsWith=self.aoi,
            start=self.start_date,
            end=self.end_date,
            maxResults=self.max_results,
            **search_options
        )

        urls = results.find_urls(
            extension=".h5",
            pattern=r"^(?!.*QA_STATS).*",
            directAccess=False
        )

        urls = list(dict.fromkeys(urls))

        return urls


    @contextmanager
    def open(self, url):

        if not self._authenticated:
            self.authenticate()

        with self._filesystem.open(
            url,
            mode="rb",
            block_size=16 * 1024 * 1024,
            cache_type="blockcache"
        ) as remote_file:
            yield remote_file
