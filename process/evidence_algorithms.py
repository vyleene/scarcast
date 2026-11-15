"""Small, testable operations used by independent-evidence exports."""
import heapq
import numpy as np


def hls_rgb(channels, qa, study):
    """Fixed stretch across dates; never expose the basemap through cloudy gaps."""
    clear = (qa != 255) & ((qa & 31) == 0) & ((qa >> 6) != 3)
    valid = clear & study & np.isfinite(channels).all(axis=-1) & (channels != -9999).all(axis=-1)
    safe = np.nan_to_num(channels, nan=0) * .0001
    rgb = np.round(np.power(np.clip(safe / .30, 0, 1), 1 / 2.2) * 255).astype(np.uint8)
    rgb[~valid] = [35, 39, 37]
    rgb[~study] = 0
    return np.dstack((rgb, np.where(study, 255, 0).astype(np.uint8))), valid


def hls_ndvi(red, nir, qa):
    """HLS S30 v2: reject fill, cloud/cirrus/adjacency/shadow/snow, high aerosol.

    Reflectance bands have the same 0.0001 scale, which cancels in NDVI.
    B04 is red and B8A is the harmonized narrow NIR band.
    """
    red, nir = red.astype(np.float32), nir.astype(np.float32)
    valid = (qa != 255) & ((qa & 31) == 0) & ((qa >> 6) != 3)
    valid &= (red != -9999) & (nir != -9999) & ((red + nir) > 0)
    values = np.divide(nir - red, nir + red, out=np.full(red.shape, np.nan), where=valid)
    return np.where(valid & (np.abs(values) <= 1), values, np.nan).astype(np.float32)


def drainage(dem):
    """Priority-flood drainage tree; each receiver precedes its child.

    Each cell drains to a processed neighbour at the lowest reachable spill
    elevation. Flats follow this tree. Counts are pixel counts, not discharge.
    All border cells are outlets; callers must flag truncated catchments.
    """
    height, width = dem.shape
    if not np.isfinite(dem).all():
        raise ValueError("Drainage requires a finite DEM")
    seen = np.zeros(dem.shape, dtype=bool)
    receiver = np.full(dem.size, -1, dtype=np.int32)
    queue = []
    for row in range(height):
        for col in (range(width) if row in (0, height - 1) else (0, width - 1)):
            if seen[row, col]:
                continue
            seen[row, col] = True
            heapq.heappush(queue, (float(dem[row, col]), row * width + col))
    order = []
    while queue:
        spill, index = heapq.heappop(queue)
        order.append(index)
        row, col = divmod(index, width)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                r, c = row + dr, col + dc
                if not (0 <= r < height and 0 <= c < width) or seen[r, c]:
                    continue
                seen[r, c] = True
                child = r * width + c
                receiver[child] = index
                heapq.heappush(queue, (max(spill, float(dem[r, c])), child))
    accumulation = np.ones(dem.size, dtype=np.int32)
    for index in reversed(order):
        parent = receiver[index]
        if parent >= 0:
            accumulation[parent] += accumulation[index]
    return receiver.reshape(dem.shape), accumulation.reshape(dem.shape)
