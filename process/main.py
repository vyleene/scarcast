from gcov import convert_hdf5 as extract_gcov
from goff import convert_hdf5 as extract_goff
from gunw import convert_hdf5 as extract_gunw
from helpers import DATA_DIR
from stream import NISARStream


def extract_mount_balikabok():
    LOCATION_NAME = "mount_balikabok"
    AOI_POINTS = (
        (120.365, 14.9431),
        (120.3495, 14.9208),
        (120.3589, 14.8974),
        (120.3944, 14.884),
        (120.4257, 14.8895),
        (120.4478, 14.9043),
        (120.4461, 14.9292),
        (120.4384, 14.9499),
        (120.4168, 14.9551),
        (120.39, 14.9574),
        (120.365, 14.9431),
    )
    AOI = "POLYGON((" + ",".join(f"{lon} {lat}" for lon, lat in AOI_POINTS) + "))"
    START_DATE = "2026-08-21"
    END_DATE = "2026-09-16"
    FILE_COUNT = 3
    FLIGHT_DIRECTION = "Ascending"
    EXPORT_NATIVE = True
    EXPORT_DB = True
    EXTRACT_GCOV = True
    EXTRACT_GUNW = True
    GUNW_COHERENCE_THRESHOLD = 0.3

    products = (
        ("GCOV", EXTRACT_GCOV, extract_gcov, {
            "export_native": EXPORT_NATIVE,
            "export_db": EXPORT_DB,
        }),
        ("GUNW", EXTRACT_GUNW, extract_gunw, {
            "coherence_threshold": GUNW_COHERENCE_THRESHOLD,
        }),
    )
    for product, enabled, extract, options in products:
        if not enabled:
            continue
        stream = (
            NISARStream()
            .setAOI(AOI)
            .setProcessingLevel(product)
            .setDateRange(START_DATE, END_DATE)
            .setMaxResults(FILE_COUNT)
            .setFlightDirection(FLIGHT_DIRECTION)
        )
        output_dir = DATA_DIR / LOCATION_NAME / product.lower()
        urls = stream.search()[:FILE_COUNT]
        print(f"Found {len(urls)} {product} files.")

        for index, url in enumerate(urls, start=1):
            print(f"Processing {product} {index}/{len(urls)}: {url}")
            paths = extract(stream, url, AOI_POINTS, output_dir=output_dir, **options)
            print(f"Saved to {paths['directory']}")


def extract_nepal_disaster(max_results=100):
    """Extract Nepal GCOV, GUNW, and GOFF data for Aug 18-Sep 1, 2026.

    Search ascending acquisitions with CRID P05023, up to max_results per
    product. GUNW and GOFF use UR; GCOV uses PR. Outputs are saved under
    data/nepal_disaster/{product}/{source}/.
    """
    LOCATION_NAME = "nepal_disaster"
    AOI_POINTS = (
        (85.1051, 28.4059),
        (85.116, 27.787),
        (85.6093, 27.9082),
        (85.645, 28.3987),
        (85.1051, 28.4059),
    )
    AOI = "POLYGON((" + ",".join(f"{lon} {lat}" for lon, lat in AOI_POINTS) + "))"
    START_DATE = "2026-08-18"
    END_DATE = "2026-09-01"
    FLIGHT_DIRECTION = "Ascending"
    CRID = "P05023"

    products = (
        ("GUNW", "UR", extract_gunw, {"coherence_threshold": 0.3}),
        ("GCOV", "PR", extract_gcov, {"export_native": True, "export_db": True}),
        ("GOFF", "UR", extract_goff, {}),
    )
    for product, production_configuration, extract, options in products:
        stream = (
            NISARStream()
            .setAOI(AOI)
            .setProcessingLevel(product)
            .setProductionConfiguration(production_configuration)
            .setDateRange(START_DATE, END_DATE)
            .setMaxResults(max_results)
            .setFlightDirection(FLIGHT_DIRECTION)
            .setCRID(CRID)
        )
        output_dir = DATA_DIR / LOCATION_NAME / product.lower()
        urls = stream.search()
        print(f"Found {len(urls)} {product} files.")

        for index, url in enumerate(urls, start=1):
            print(f"Processing {product} {index}/{len(urls)}: {url}")
            paths = extract(stream, url, AOI_POINTS, output_dir=output_dir, **options)
            print(f"Saved to {paths['directory']}")

if __name__ == "__main__":
    extract_nepal_disaster()
