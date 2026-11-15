"""Spatially supported radar-change display, not a displacement estimator."""
import struct
import zlib

import numpy as np
from rasterio.features import sieve
from rasterio.transform import array_bounds
from rasterio.warp import calculate_default_transform, reproject, transform_bounds, Resampling


def window_sum(values, size):
    radius = size // 2
    padded = np.pad(values, radius, mode="constant")
    integral = np.pad(padded, ((1, 0), (1, 0))).cumsum(0, dtype=np.float64).cumsum(1, dtype=np.float64)
    return integral[size:, size:] - integral[:-size, size:] - integral[size:, :-size] + integral[:-size, :-size]


def hotspots(before_db, after_db, valid, window=9, threshold=3.0, minimum_pixels=100):
    """Average intensities before calculating log ratio; retain substantial patches."""
    if window < 1 or window % 2 != 1:
        raise ValueError("Window must be a positive odd number")
    valid = valid & np.isfinite(before_db) & np.isfinite(after_db)
    count = window_sum(valid.astype(np.float64), window)
    supported = valid & (count >= window * window * 0.9)
    means = []
    for values in (before_db, after_db):
        intensity = np.where(valid, np.power(10.0, np.where(valid, values, 0) / 10.0), 0)
        means.append(np.divide(window_sum(intensity, window), count, out=np.zeros_like(count), where=count > 0))
    supported &= (means[0] > 0) & (means[1] > 0)
    change = np.full(before_db.shape, np.nan, dtype=np.float32)
    change[supported] = 10 * np.log10(means[1][supported] / means[0][supported])
    candidate = supported & (np.abs(change) >= threshold)
    kept = candidate & (sieve(candidate.astype(np.uint8), size=minimum_pixels, connectivity=8) == 1)
    return np.where(kept, np.abs(change), np.nan).astype(np.float32), kept


def write_overlay(path, values, reference, threshold=3.0, maximum=9.0):
    height, width = values.shape
    bounds = array_bounds(height, width, reference["transform"])
    affine, w, h = calculate_default_transform(reference["crs"], "EPSG:3857", width, height, *bounds, resolution=10)
    display = np.full((h, w), np.nan, dtype=np.float32)
    reproject(values, display, src_transform=reference["transform"], src_crs=reference["crs"], src_nodata=np.nan,
              dst_transform=affine, dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=Resampling.nearest)
    valid = np.isfinite(display)
    fraction = np.clip((np.nan_to_num(display, nan=threshold) - threshold) / (maximum - threshold), 0, 1)
    stops = np.array([[255, 220, 70], [255, 125, 30], [190, 20, 20]])
    scaled = fraction * 2
    low = np.minimum(scaled.astype(int), 1)
    weight = (scaled - low)[..., None]
    rgb = np.round(stops[low] + weight * (stops[low + 1] - stops[low])).astype(np.uint8)
    rgb[~valid] = 0
    alpha = np.where(valid, 110 + fraction * 110, 0).astype(np.uint8)
    rgba = np.dstack((rgb, alpha))
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    rows = b''.join(b'\0' + row.tobytes() for row in rgba)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', w, h, 8, 6, 0, 0, 0))
    path.write_bytes(png + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))
    west, south, east, north = transform_bounds('EPSG:3857', 'EPSG:4326', *array_bounds(h, w, affine))
    return [[south, west], [north, east]]
