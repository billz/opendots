"""Shared settings for the dot map pipeline."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
SITE = ROOT / "site"

# States to build: FIPS -> (Census file prefix, name, postal code).
# Census bulk files live under .../PL_94-171/<Folder_Name>/<prefix>2020.pl.zip
ALL_STATES = {
    "01": ("al", "Alabama", "AL"),
    "02": ("ak", "Alaska", "AK"),
    "04": ("az", "Arizona", "AZ"),
    "05": ("ar", "Arkansas", "AR"),
    "06": ("ca", "California", "CA"),
    "08": ("co", "Colorado", "CO"),
    "09": ("ct", "Connecticut", "CT"),
    "10": ("de", "Delaware", "DE"),
    "11": ("dc", "District of Columbia", "DC"),
    "12": ("fl", "Florida", "FL"),
    "13": ("ga", "Georgia", "GA"),
    "15": ("hi", "Hawaii", "HI"),
    "16": ("id", "Idaho", "ID"),
    "17": ("il", "Illinois", "IL"),
    "18": ("in", "Indiana", "IN"),
    "19": ("ia", "Iowa", "IA"),
    "20": ("ks", "Kansas", "KS"),
    "21": ("ky", "Kentucky", "KY"),
    "22": ("la", "Louisiana", "LA"),
    "23": ("me", "Maine", "ME"),
    "24": ("md", "Maryland", "MD"),
    "25": ("ma", "Massachusetts", "MA"),
    "26": ("mi", "Michigan", "MI"),
    "27": ("mn", "Minnesota", "MN"),
    "28": ("ms", "Mississippi", "MS"),
    "29": ("mo", "Missouri", "MO"),
    "30": ("mt", "Montana", "MT"),
    "31": ("ne", "Nebraska", "NE"),
    "32": ("nv", "Nevada", "NV"),
    "33": ("nh", "New Hampshire", "NH"),
    "34": ("nj", "New Jersey", "NJ"),
    "35": ("nm", "New Mexico", "NM"),
    "36": ("ny", "New York", "NY"),
    "37": ("nc", "North Carolina", "NC"),
    "38": ("nd", "North Dakota", "ND"),
    "39": ("oh", "Ohio", "OH"),
    "40": ("ok", "Oklahoma", "OK"),
    "41": ("or", "Oregon", "OR"),
    "42": ("pa", "Pennsylvania", "PA"),
    "44": ("ri", "Rhode Island", "RI"),
    "45": ("sc", "South Carolina", "SC"),
    "46": ("sd", "South Dakota", "SD"),
    "47": ("tn", "Tennessee", "TN"),
    "48": ("tx", "Texas", "TX"),
    "49": ("ut", "Utah", "UT"),
    "50": ("vt", "Vermont", "VT"),
    "51": ("va", "Virginia", "VA"),
    "53": ("wa", "Washington", "WA"),
    "54": ("wv", "West Virginia", "WV"),
    "55": ("wi", "Wisconsin", "WI"),
    "56": ("wy", "Wyoming", "WY"),
}

# Set OPENDOTS_STATES to a comma-separated list of postal codes (for example
# "AK,HI,CT") to build just those states, handy for testing locally.
_only = {p.strip().upper() for p in os.environ.get("OPENDOTS_STATES", "").split(",") if p.strip()}
STATES = {f: v for f, v in ALL_STATES.items() if not _only or v[2] in _only}

# Census Bureau Population Estimates vintage for the "since 2020" figures
# (county characteristics by race and Hispanic origin, July 1 of this year).
PEP_VINTAGE = 2025

# Group order is the order of channels in the tiles. Keep in sync with
# site/assets/config.js.
GROUPS = ["hispanic", "white", "black", "asian", "multiracial", "other"]

# Zoom levels. Overview zooms are rendered by streaming every state's dots
# into a shared set of tiles; detail zooms are rendered in parallel, one
# BUCKET_ZOOM tile (and everything inside it) at a time. Above MAX_ZOOM the
# page enlarges the last level, which makes individual dots bigger.
MIN_ZOOM = 3  # 3-4 give full-size tiles for the national and Alaska views
BUCKET_ZOOM = 7
MAX_ZOOM = 13

# Parallel workers for tile rendering: one per CPU. More workers than CPUs
# doesn't speed things up and multiplies memory use.
WORKERS = os.cpu_count() or 4
