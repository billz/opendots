"""Download the Census files for every state in config.STATES (skips existing):
redistricting counts, block shapes, and population estimates."""
import subprocess
import sys

from config import PEP_VINTAGE, RAW, STATES

CENSUS = "https://www2.census.gov"
PL = CENSUS + "/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/{folder}/{prefix}2020.pl.zip"
BLOCKS = CENSUS + "/geo/tiger/TIGER2020/TABBLOCK20/tl_2020_{fips}_tabblock20.zip"
PEP = CENSUS + "/programs-surveys/popest/datasets/2020-{v}/counties/asrh/cc-est{v}-alldata-{fips}.csv"


def fetch(url, path):
    if path.exists():
        return
    print(f"downloading {path.name}")
    subprocess.run(["curl", "-sfL", "-o", str(path), url], check=True)


def main():
    # --counts-only skips the block shapes (~9.8 GB nationally); the rest is
    # enough for `make_dots.py --counts-only` and building pages.
    counts_only = "--counts-only" in sys.argv
    RAW.mkdir(parents=True, exist_ok=True)
    for fips, (prefix, name, _) in STATES.items():
        folder = name.replace(" ", "_")
        fetch(PL.format(folder=folder, prefix=prefix), RAW / f"{prefix}2020.pl.zip")
        if not counts_only:
            fetch(BLOCKS.format(fips=fips), RAW / f"tl_2020_{fips}_tabblock20.zip")
        fetch(PEP.format(v=PEP_VINTAGE, fips=fips), RAW / f"cc-est{PEP_VINTAGE}-alldata-{fips}.csv")


if __name__ == "__main__":
    main()
