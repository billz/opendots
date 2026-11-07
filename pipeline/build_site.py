"""Write page data and HTML for each state and county.

Inputs:  data/work/counts/<fips>.json, data/raw/cc-est<vintage>-alldata-<fips>.csv,
         data/raw/cb_2020_us_state_500k.zip, data/raw/cb_2020_us_county_500k.zip
Outputs: site/data/<slug>.json, site/<slug>.html (from site/templates/county.html),
         site/data/counties-<postal>.json, site/data/states.json, site/data/states-geo.json,
         site/united-states.html and site/index.html (national map), site/places.html (list)
"""
import io
import json
import re
import zipfile
from html import escape

import numpy as np
import shapefile
import shapely
from shapely.geometry import mapping, shape

from config import GROUPS, PEP_VINTAGE, RAW, SITE, STATES, WORK
from estimates import page_estimates, read_estimates, state_estimates


# Header line on every page: the headline figures are the latest estimates,
# while the dots can only show the 2020 Census (no block-level estimates).
EYEBROW = f"{PEP_VINTAGE} estimates &middot; dots from the 2020 Census"


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def read_shapes(zip_name):
    with zipfile.ZipFile(RAW / zip_name) as z:
        names = {n.rsplit(".", 1)[1]: n for n in z.namelist()}
        reader = shapefile.Reader(
            shp=io.BytesIO(z.read(names["shp"])),
            dbf=io.BytesIO(z.read(names["dbf"])),
            shx=io.BytesIO(z.read(names["shx"])),
        )
        fields = [f[0] for f in reader.fields[1:]]
        for sr in reader.iterShapeRecords():
            yield dict(zip(fields, sr.record)), shape(sr.shape.__geo_interface__)


# Shown on county pages that have no newer estimates.
NO_ESTIMATES = {
    "09": "Connecticut replaced its counties with nine planning regions in 2022, and newer "
          "Census Bureau estimates are published only for the regions, so this page shows the 2020 Census.",
    "default": "Newer Census Bureau estimates aren't available for this county, so this page shows the 2020 Census.",
}


def unwrap(geom):
    """Keep shapes that cross the 180° line (Alaska's Aleutians) contiguous.

    Parts with positive longitudes are shifted by -360°, so the shape spans
    e.g. -187°..-130° instead of -180°..180° (which would fit the whole world).
    """
    minx, _, maxx, _ = geom.bounds
    if maxx - minx <= 180:
        return geom
    return shapely.transform(geom, lambda c: np.column_stack([np.where(c[:, 0] > 0, c[:, 0] - 360, c[:, 0]), c[:, 1]]))


def focus_bbox(geom, min_share=0.01):
    """Bounds of the parts that matter for the initial view.

    Skips specks like the Farallon Islands (San Francisco County) that would
    otherwise zoom the starting view far out to sea.
    """
    parts = list(getattr(geom, "geoms", [geom]))
    biggest = max(p.area for p in parts)
    keep = [p for p in parts if p.area >= biggest * min_share]
    xs = [b for p in keep for b in (p.bounds[0], p.bounds[2])]
    ys = [b for p in keep for b in (p.bounds[1], p.bounds[3])]
    return [min(xs), min(ys), max(xs), max(ys)]


def total(counts):
    return sum(counts[g] for g in GROUPS)


def write_page(template, data, title, full_name, nav_html, children_html):
    data = {**data, "title": title, "fullName": full_name}
    (SITE / "data" / f"{data['slug']}.json").write_text(json.dumps(data, separators=(",", ":")))
    html = (template
            .replace("{{slug}}", data["slug"])
            .replace("{{title}}", escape(title))
            .replace("{{name}}", escape(full_name))
            .replace("{{nav}}", nav_html)
            .replace("{{children}}", children_html)
            .replace("{{eyebrow}}", EYEBROW))
    (SITE / f"{data['slug']}.html").write_text(html)


def main():
    template = (SITE / "templates" / "county.html").read_text()
    (SITE / "data").mkdir(exist_ok=True)

    state_geoms = {r["STATEFP"]: unwrap(g) for r, g in read_shapes("cb_2020_us_state_500k.zip") if r["STATEFP"] in STATES}
    county_geoms = {}
    for r, g in read_shapes("cb_2020_us_county_500k.zip"):
        if r["STATEFP"] in STATES:
            county_geoms[(r["STATEFP"], r["COUNTYFP"])] = (r["NAMELSAD"], unwrap(g))

    index_items = []
    manifest = []
    states_out = []  # per state: (fips, name, slug, postal, counts, estimates, people)
    for fips, (_, state_name, postal) in STATES.items():
        counts = json.loads((WORK / "counts" / f"{fips}.json").read_text())
        estimates = read_estimates(fips)
        state_slug = slugify(state_name)

        counties = []
        for (sf, cf), (county_name, geom) in sorted(county_geoms.items(), key=lambda kv: kv[1][0]):
            if sf != fips:
                continue
            slug = f"{slugify(county_name)}-{postal.lower()}"
            counties.append((cf, county_name, slug, geom))

        # Clickable county layer shared by every page in the state
        counties_file = f"counties-{postal.lower()}.json"
        # Headline populations everywhere (hover labels, county lists, index)
        # are the latest estimates, matching the page totals.
        # Counties without estimates (Connecticut: the estimates use the
        # planning regions it adopted in 2022) fall back to the 2020 Census.
        latest = {cf: total(estimates[cf]["latest"]) if cf in estimates else total(c)
                  for cf, c in counts["counties"].items()}
        state_latest = sum(total(e["latest"]) for e in estimates.values())
        write_counties(counties_file, counties, latest)

        # State page
        geom = state_geoms[fips].simplify(0.002, preserve_topology=True)
        children = [{"name": n, "slug": s, "people": latest[cf]} for cf, n, s, _ in counties]
        children_html = (
            '<details class="children"><summary>Counties (' + str(len(children)) + ")</summary><ul>" +
            "".join(f'<li><a href="{c["slug"]}.html">{escape(c["name"])}</a> '
                    f'<span>{c["people"]:,}</span></li>' for c in children) +
            "</ul></details>"
        )
        write_page(template, {
            "slug": state_slug, "kind": "state", "name": state_name, "state": state_name,
            "stateAbbr": postal, "fips": fips,
            "census2020": counts["state"], "bbox": focus_bbox(geom), "boundary": mapping(geom),
            "counties": counties_file, "children": children,
            "estimates": state_estimates(estimates),
            "parent": {"slug": COUNTRY_SLUG, "name": "United States"},
        }, state_name, state_name, '<a href="./">United States</a>', children_html)

        # County pages
        nav = f'<a href="{state_slug}.html">{escape(state_name)}</a>'
        for cf, county_name, slug, geom in counties:
            geom = geom.simplify(0.0003, preserve_topology=True)
            write_page(template, {
                "slug": slug, "kind": "county", "name": county_name, "state": state_name,
                "stateAbbr": postal, "fips": fips + cf,
                "parent": {"slug": state_slug, "name": state_name},
                "census2020": counts["counties"][cf], "bbox": focus_bbox(geom), "boundary": mapping(geom),
                "counties": counties_file,
                **({"estimates": page_estimates(estimates[cf])} if cf in estimates else {"noEstimates": NO_ESTIMATES.get(fips, NO_ESTIMATES["default"])}),
            }, f"{county_name}, {postal}", f"{county_name}, {state_name}", nav, "")

        index_items.append((state_name, state_slug, state_latest, children))
        states_out.append((fips, state_name, state_slug, postal, counts["state"], state_estimates(estimates), state_latest))
        manifest.append({
            "fips": fips, "slug": state_slug, "name": state_name, "postal": postal,
            "bbox": [round(v, 4) for v in state_geoms[fips].bounds], "counties": counties_file,
        })
        print(f"{state_name}: wrote 1 state page and {len(counties)} county pages")

    # Lets the map load each state's clickable counties when it comes into view.
    (SITE / "data" / "states.json").write_text(json.dumps(manifest, separators=(",", ":")))
    write_states_geo(states_out, state_geoms)
    write_country(template, states_out, state_geoms)
    write_index(index_items)


COUNTRY_SLUG = "united-states"
NOT_CONTIGUOUS = {"02", "15"}  # Alaska, Hawaii: left out of the opening view


def write_states_geo(states_out, state_geoms):
    """All states as one GeoJSON file, for hover and click on the national map."""
    features = [
        {
            "type": "Feature",
            "properties": {"slug": slug, "name": name, "people": people},
            "geometry": mapping(state_geoms[fips].simplify(0.01, preserve_topology=True)),
        }
        for fips, name, slug, _, _, _, people in states_out
    ]
    text = json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))
    text = re.sub(r"(-?\d+\.\d{3})\d+", r"\1", text)
    (SITE / "data" / "states-geo.json").write_text(text)


def write_country(template, states_out, state_geoms):
    """National page, also served as the site's home page (index.html)."""
    census = {g: sum(st[4][g] for st in states_out) for g in GROUPS}
    est = {
        "year": PEP_VINTAGE,
        "base": {g: sum(st[5]["base"][g] for st in states_out) for g in GROUPS},
        "latest": {g: sum(st[5]["latest"][g] for st in states_out) for g in GROUPS},
    }
    contiguous = [state_geoms[st[0]] for st in states_out if st[0] not in NOT_CONTIGUOUS] or \
                 [state_geoms[st[0]] for st in states_out]
    bbox = [min(g.bounds[0] for g in contiguous), min(g.bounds[1] for g in contiguous),
            max(g.bounds[2] for g in contiguous), max(g.bounds[3] for g in contiguous)]
    children = sorted(({"name": name, "slug": slug, "people": people}
                       for _, name, slug, _, _, _, people in states_out), key=lambda c: c["name"])
    children_html = (
        '<details class="children"><summary>States (' + str(len(children)) + ")</summary><ul>" +
        "".join(f'<li><a href="{c["slug"]}.html">{escape(c["name"])}</a> '
                f'<span>{c["people"]:,}</span></li>' for c in children) +
        "</ul></details>"
    )
    write_page(template, {
        "slug": COUNTRY_SLUG, "kind": "country", "name": "the United States",
        "census2020": census, "estimates": est, "bbox": bbox, "boundary": None,
        "children": children, "statesGeo": "states-geo.json",
    }, "United States", "the United States", '<a href="places.html">All places</a>', children_html)
    # The national map is the home page.
    (SITE / "index.html").write_text((SITE / f"{COUNTRY_SLUG}.html").read_text())
    print(f"United States: wrote national page ({sum(census.values()):,} people in 2020)")


def write_counties(filename, counties, people):
    """All counties in a state as one GeoJSON file, for hover and click."""
    features = [
        {
            "type": "Feature",
            "properties": {"slug": slug, "name": name, "people": people[cf]},
            "geometry": mapping(geom.simplify(0.002, preserve_topology=True)),
        }
        for cf, name, slug, geom in counties
    ]
    text = json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))
    # Trim coordinates to ~100 m precision; the full float repr triples the file size.
    text = re.sub(r"(-?\d+\.\d{3})\d+", r"\1", text)
    (SITE / "data" / filename).write_text(text)


def write_index(items):
    sections = []
    for state_name, state_slug, people, children in items:
        links = "".join(f'<li><a href="{c["slug"]}.html">{escape(c["name"])}</a></li>' for c in children)
        sections.append(
            f'<section><h2><a href="{state_slug}.html">{escape(state_name)}</a> '
            f'<span>{people:,} people ({PEP_VINTAGE})</span></h2><ul class="county-list">{links}</ul></section>'
        )
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>All places: Race and Ethnicity Dot Maps</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/app.css">
</head>
<body class="index">
<main>
<p class="eyebrow">{EYEBROW}</p>
<p class="crumbs"><a href="./">United States map</a></p>
<h1>All places</h1>
{''.join(sections)}
</main>
</body>
</html>
"""
    (SITE / "places.html").write_text(html)


if __name__ == "__main__":
    main()
