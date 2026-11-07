"""Shared settings for the dot map pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
SITE = ROOT / "site"

# States to build: FIPS -> (Census file prefix, name, postal code).
# Census bulk files live under .../PL_94-171/<Folder_Name>/<prefix>2020.pl.zip
STATES = {
    "04": ("az", "Arizona", "AZ"),
    "06": ("ca", "California", "CA"),
    "32": ("nv", "Nevada", "NV"),
    "41": ("or", "Oregon", "OR"),
}

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
MIN_ZOOM = 5
BUCKET_ZOOM = 7
MAX_ZOOM = 13

# Parallel workers for tile rendering.
WORKERS = 8
