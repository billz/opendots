"""Place one dot per person, at a random spot inside their census block.

Inputs per state (data/raw):
  <prefix>2020.pl.zip              2020 Census P.L. 94-171 redistricting data
  tl_2020_<fips>_tabblock20.zip    2020 TIGER/Line census block shapes

Outputs per state (data/work):
  dots/<fips>.npz     x, y (Web Mercator meters, float64), group (uint8 index into GROUPS)
  counts/<fips>.json  group totals for the state and each county
"""
import io
import json
import sys
import zipfile

import numpy as np
import shapefile
import shapely
from shapely.geometry import shape

from config import GROUPS, RAW, STATES, WORK

# Field positions (0-based) in the pipe-delimited PL files.
GEO_SUMLEV, GEO_LOGRECNO, GEO_GEOCODE, GEO_COUNTY = 2, 7, 9, 14
SEG1_LOGRECNO = 4
P2 = {  # table P2: Hispanic or Latino, and not Hispanic by race
    "total": 76, "hispanic": 77, "white": 80, "black": 81, "aian": 82,
    "asian": 83, "nhpi": 84, "sor": 85, "two_or_more": 86,
}

R = 6378137.0


def to_mercator(lon, lat):
    x = np.radians(lon) * R
    y = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * R
    return x, y


def group_counts(row):
    """Collapse P2 columns into the map's groups."""
    v = {k: int(row[i]) for k, i in P2.items()}
    return [
        v["hispanic"],
        v["white"],
        v["black"],
        v["asian"],
        v["two_or_more"],
        v["aian"] + v["nhpi"] + v["sor"],
    ]


def read_pl(prefix):
    """Return ({block GEOID: counts}, {"state": totals, "counties": {fips: totals}})."""
    blocks, totals = {}, {"state": None, "counties": {}}
    with zipfile.ZipFile(RAW / f"{prefix}2020.pl.zip") as z:
        logrec = {}
        with z.open(f"{prefix}geo2020.pl") as f:
            for line in io.TextIOWrapper(f, encoding="latin-1"):
                r = line.split("|")
                sumlev = r[GEO_SUMLEV]
                if sumlev == "750":
                    logrec[r[GEO_LOGRECNO]] = ("block", r[GEO_GEOCODE])
                elif sumlev == "050":
                    logrec[r[GEO_LOGRECNO]] = ("county", r[GEO_COUNTY])
                elif sumlev == "040":
                    logrec[r[GEO_LOGRECNO]] = ("state", None)
        with z.open(f"{prefix}000012020.pl") as f:
            for line in io.TextIOWrapper(f, encoding="latin-1"):
                r = line.rstrip("\n").split("|")
                hit = logrec.get(r[SEG1_LOGRECNO])
                if not hit:
                    continue
                kind, key = hit
                counts = group_counts(r)
                if kind == "block":
                    if sum(counts):
                        blocks[key] = counts
                elif kind == "county":
                    totals["counties"][key] = dict(zip(GROUPS, counts))
                else:
                    totals["state"] = dict(zip(GROUPS, counts))
    return blocks, totals


def sample_in_polygon(geom, n, rng):
    """n uniform random points inside geom (rejection sampling)."""
    minx, miny, maxx, maxy = geom.bounds
    shapely.prepare(geom)
    out_x, out_y, need = [], [], n
    while need > 0:
        k = max(16, int(need * 1.6) + 8)
        xs = rng.uniform(minx, maxx, k)
        ys = rng.uniform(miny, maxy, k)
        inside = shapely.contains_xy(geom, xs, ys)
        xs, ys = xs[inside][:need], ys[inside][:need]
        out_x.append(xs)
        out_y.append(ys)
        need -= len(xs)
        if k > 50000 and not inside.any():  # degenerate sliver: use a point on it
            c = geom.representative_point()
            out_x.append(np.full(need, c.x))
            out_y.append(np.full(need, c.y))
            need = 0
    return np.concatenate(out_x), np.concatenate(out_y)


def make_state(fips):
    prefix, name, _ = STATES[fips]
    rng = np.random.default_rng(2020 + int(fips))

    print(f"{name}: reading population counts…")
    blocks, totals = read_pl(prefix)
    people = sum(map(sum, blocks.values()))
    print(f"  {len(blocks):,} populated blocks, {people:,} people")

    print(f"{name}: placing dots…")
    xs, ys, gs = [], [], []
    done = 0
    with zipfile.ZipFile(RAW / f"tl_2020_{fips}_tabblock20.zip") as z:
        names = {n.rsplit(".", 1)[1]: n for n in z.namelist()}
        reader = shapefile.Reader(
            shp=io.BytesIO(z.read(names["shp"])),
            dbf=io.BytesIO(z.read(names["dbf"])),
            shx=io.BytesIO(z.read(names["shx"])),
        )
        fields = [f[0] for f in reader.fields[1:]]
        i_geoid = fields.index("GEOID20")
        for i, rec in enumerate(reader.iterRecords()):
            counts = blocks.get(rec[i_geoid])
            if not counts:
                continue
            geom = shape(reader.shape(i).__geo_interface__)
            # Project vertices so dots are uniform in map space.
            geom = shapely.transform(geom, lambda c: np.column_stack(to_mercator(c[:, 0], c[:, 1])))
            bx, by = sample_in_polygon(geom, sum(counts), rng)
            xs.append(bx)
            ys.append(by)
            gs.append(np.repeat(np.arange(len(GROUPS), dtype=np.uint8), counts))
            done += 1
            if done % 100000 == 0:
                print(f"  {done:,} / {len(blocks):,} blocks")

    x, y, g = np.concatenate(xs), np.concatenate(ys), np.concatenate(gs)
    (WORK / "dots").mkdir(parents=True, exist_ok=True)
    (WORK / "counts").mkdir(parents=True, exist_ok=True)
    np.savez(WORK / "dots" / f"{fips}.npz", x=x, y=y, group=g)
    (WORK / "counts" / f"{fips}.json").write_text(json.dumps(totals, indent=1))
    assert len(x) == people, (len(x), people)
    print(f"{name}: wrote {len(x):,} dots from {done:,} blocks")


def main():
    for fips in sys.argv[1:] or STATES:
        make_state(fips)


if __name__ == "__main__":
    main()
