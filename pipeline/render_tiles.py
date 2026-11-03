"""Render dots into map tiles that store group shares, not colors.

Each tile is a 256x512 RGB PNG made of two stacked 256x256 strips:
  top strip:    R = hispanic share, G = white share, B = black share
  bottom strip: R = asian share,    G = multiracial share, B = density
Shares are 0-255 fractions of the people in that pixel; the "other" share is
whatever is left. Density is 0-255 opacity, scaled by pixel area so a given
number of people per km² looks the same at every zoom.

The page turns shares into colors with whatever palette is configured, so
colors can change without re-rendering. Tiles with no people are not written.

Steps:
  1. Overview zooms (MIN_ZOOM .. BUCKET_ZOOM-1): stream each state's dots and
     add them into shared per-tile counts.
  2. Split dots into buckets, one per BUCKET_ZOOM tile, across all states.
  3. Render detail zooms (BUCKET_ZOOM .. MAX_ZOOM) one bucket per worker.
  4. Pack all tiles into site/tiles.pmtiles and write site/data/tileset.json.

Outputs: site/tiles/{z}/{x}/{y}.png, site/tiles.pmtiles, site/data/tileset.json
"""
import json
import shutil
import time
from multiprocessing import Pool

import numpy as np
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write as pmtiles_write

from config import BUCKET_ZOOM, GROUPS, MAX_ZOOM, MIN_ZOOM, SITE, STATES, WORK, WORKERS

HALF = 20037508.342789244
TILE = 256
NG = len(GROUPS)
TILES = SITE / "tiles"
BUCKETS = WORK / "buckets"


def density_alpha(n, z):
    """Opacity for n people in one pixel at zoom z."""
    # People per pixel for ~63% opacity. Pixel area grows 4x per zoom level
    # out; growing tau only 3x keeps sparse areas visible at overview zooms.
    tau = 0.5 * 3.0 ** (13 - z)
    return 1.0 - np.exp(-n / tau)


def encode(counts, z):
    """counts: (256*256, NG) -> 512x256x3 uint8 image."""
    n = counts.sum(axis=1)
    share = np.zeros(counts.shape, dtype=np.float64)
    has = n > 0
    share[has] = counts[has] / n[has, None]
    img = np.zeros((2 * TILE, TILE, 3), dtype=np.uint8)
    q = lambda a: np.round(a * 255).astype(np.uint8).reshape(TILE, TILE)
    for c in range(3):
        img[:TILE, :, c] = q(share[:, c])
    img[TILE:, :, 0] = q(share[:, 3])
    img[TILE:, :, 1] = q(share[:, 4])
    img[TILE:, :, 2] = q(density_alpha(n, z))
    return img


def save(img, z, x, y):
    path = TILES / str(z) / str(x) / f"{y}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img, "RGB").save(path, optimize=True)


def pixels(x, y, z):
    """Global pixel coordinates of Web Mercator points at zoom z."""
    size = TILE * 2 ** z
    px = np.minimum(((x + HALF) / (2 * HALF) * size).astype(np.int64), size - 1)
    py = np.minimum(((HALF - y) / (2 * HALF) * size).astype(np.int64), size - 1)
    return px, py


def tile_groups(px, py):
    """Yield (tile_x, tile_y, index array) for each tile the pixels fall in."""
    key = ((px >> 8) << 32) | (py >> 8)
    order = np.argsort(key, kind="stable")
    key_s = key[order]
    starts = np.flatnonzero(np.r_[True, key_s[1:] != key_s[:-1]])
    ends = np.r_[starts[1:], len(key_s)]
    for s, e in zip(starts, ends):
        k = int(key_s[s])
        yield k >> 32, k & 0xFFFFFFFF, order[s:e]


def tile_counts(px, py, g, idx):
    local = (py[idx] & 255) * TILE + (px[idx] & 255)
    return np.bincount(local * NG + g[idx], minlength=TILE * TILE * NG).reshape(TILE * TILE, NG)


def state_files():
    return [WORK / "dots" / f"{fips}.npz" for fips in STATES]


# ---------- step 1 + 2: overview tiles and buckets ----------

def overview_and_buckets():
    acc = {z: {} for z in range(MIN_ZOOM, BUCKET_ZOOM)}
    bounds = [np.inf, np.inf, -np.inf, -np.inf]
    if BUCKETS.exists():
        shutil.rmtree(BUCKETS)

    for path in state_files():
        d = np.load(path)
        x, y, g = d["x"], d["y"], d["group"]
        bounds = [min(bounds[0], x.min()), min(bounds[1], y.min()),
                  max(bounds[2], x.max()), max(bounds[3], y.max())]
        for z, tiles in acc.items():
            px, py = pixels(x, y, z)
            for tx, ty, idx in tile_groups(px, py):
                c = tile_counts(px, py, g, idx)
                if (tx, ty) in tiles:
                    tiles[(tx, ty)] += c
                else:
                    tiles[(tx, ty)] = c
        px, py = pixels(x, y, BUCKET_ZOOM)
        for tx, ty, idx in tile_groups(px, py):
            out = BUCKETS / f"{tx}_{ty}"
            out.mkdir(parents=True, exist_ok=True)
            np.savez(out / path.name, x=x[idx], y=y[idx], group=g[idx])
        print(f"  split {path.stem}: {len(x):,} dots")

    n = 0
    for z, tiles in acc.items():
        for (tx, ty), c in tiles.items():
            save(encode(c, z), z, tx, ty)
        n += len(tiles)
        print(f"  z{z}: {len(tiles):,} tiles")
    return n, bounds


# ---------- step 3: detail tiles, one bucket per worker ----------

def render_bucket(bucket):
    parts = [np.load(p) for p in sorted(bucket.glob("*.npz"))]
    x = np.concatenate([p["x"] for p in parts])
    y = np.concatenate([p["y"] for p in parts])
    g = np.concatenate([p["group"] for p in parts])
    per_zoom = {}
    for z in range(BUCKET_ZOOM, MAX_ZOOM + 1):
        px, py = pixels(x, y, z)
        count = 0
        for tx, ty, idx in tile_groups(px, py):
            save(encode(tile_counts(px, py, g, idx), z), z, tx, ty)
            count += 1
        per_zoom[z] = count
    return bucket.name, len(x), per_zoom


# ---------- step 4: pack ----------

def to_lonlat(x, y):
    lon = np.degrees(x / 6378137.0)
    lat = np.degrees(2 * np.arctan(np.exp(y / 6378137.0)) - np.pi / 2)
    return float(lon), float(lat)


def pack(bounds):
    entries = []
    for path in TILES.glob("*/*/*.png"):
        z, x, y = int(path.parts[-3]), int(path.parts[-2]), int(path.stem)
        entries.append((zxy_to_tileid(z, x, y), path))
    entries.sort()
    w, s = to_lonlat(bounds[0], bounds[1])
    e, n = to_lonlat(bounds[2], bounds[3])
    e7 = lambda v: int(round(v * 1e7))
    with pmtiles_write(str(SITE / "tiles.pmtiles")) as writer:
        for tileid, path in entries:
            writer.write_tile(tileid, path.read_bytes())
        writer.finalize(
            {
                "tile_type": TileType.PNG,
                "tile_compression": Compression.NONE,
                "min_zoom": MIN_ZOOM,
                "max_zoom": MAX_ZOOM,
                "min_lon_e7": e7(w), "min_lat_e7": e7(s),
                "max_lon_e7": e7(e), "max_lat_e7": e7(n),
                "center_zoom": MIN_ZOOM + 1,
                "center_lon_e7": e7((w + e) / 2), "center_lat_e7": e7((s + n) / 2),
            },
            {
                "name": "Census 2020 dot map",
                "description": "Group shares per pixel; see pipeline/render_tiles.py for the encoding.",
                "groups": GROUPS,
                "attribution": "U.S. Census Bureau, 2020 Census",
            },
        )
    tileset = {"bounds": [w, s, e, n], "minzoom": MIN_ZOOM, "maxzoom": MAX_ZOOM, "tiles": len(entries)}
    (SITE / "data").mkdir(exist_ok=True)
    (SITE / "data" / "tileset.json").write_text(json.dumps(tileset, indent=1))
    return len(entries)


def main():
    t0 = time.time()
    if TILES.exists():
        shutil.rmtree(TILES)

    print("overview zooms and buckets…")
    n_overview, bounds = overview_and_buckets()

    buckets = sorted(BUCKETS.iterdir(), key=lambda b: -sum(p.stat().st_size for p in b.glob("*.npz")))
    print(f"detail zooms: {len(buckets)} buckets on {WORKERS} workers…")
    totals = {}
    with Pool(WORKERS) as pool:
        for name, dots, per_zoom in pool.imap_unordered(render_bucket, buckets):
            for z, c in per_zoom.items():
                totals[z] = totals.get(z, 0) + c
            print(f"  bucket {name}: {dots:,} dots, {sum(per_zoom.values()):,} tiles")
    for z in sorted(totals):
        print(f"  z{z}: {totals[z]:,} tiles")

    print("packing tiles.pmtiles…")
    n = pack(bounds)
    size = (SITE / "tiles.pmtiles").stat().st_size / 1e6
    print(f"wrote {n:,} tiles ({n_overview} overview), tiles.pmtiles {size:,.0f} MB, "
          f"{time.time() - t0:,.0f}s")


if __name__ == "__main__":
    main()
