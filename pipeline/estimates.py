"""Newer population figures from the Census Bureau's Population Estimates
Program (PEP): county characteristics by race and Hispanic origin.

Change is measured from the PEP's own April 1, 2020 estimates base rather
than the raw 2020 Census counts. The base is the census adjusted to the same
race categories PEP uses (it has no "Some other race"; those people are
assigned to a specific race), so comparisons are like for like.
"""
import csv

from config import GROUPS, PEP_VINTAGE, RAW

BASE_YEAR_CODE = "1"  # April 1, 2020 estimates base
LATEST_YEAR_CODE = str(PEP_VINTAGE - 2020 + 2)  # July 1 of the vintage year

# PEP columns (male + female) that make up each map group. Race groups are
# non-Hispanic, race alone; "other" here is American Indian/Alaska Native
# plus Native Hawaiian/Pacific Islander.
COLUMNS = {
    "hispanic": ["H"],
    "white": ["NHWA"],
    "black": ["NHBA"],
    "asian": ["NHAA"],
    "multiracial": ["NHTOM"],
    "other": ["NHIA", "NHNA"],
}


def pep_file(fips):
    return RAW / f"cc-est{PEP_VINTAGE}-alldata-{fips}.csv"


def read_estimates(fips):
    """Return {county FIPS: {"base": {group: n}, "latest": {group: n}}}."""
    out = {}
    with open(pep_file(fips), newline="", encoding="latin-1") as f:
        for row in csv.DictReader(f):
            if row["AGEGRP"] != "0":  # all ages
                continue
            year = {BASE_YEAR_CODE: "base", LATEST_YEAR_CODE: "latest"}.get(row["YEAR"])
            if not year:
                continue
            counts = {
                g: sum(int(row[c + "_MALE"]) + int(row[c + "_FEMALE"]) for c in COLUMNS[g])
                for g in GROUPS
            }
            out.setdefault(row["COUNTY"], {})[year] = counts
    return out


def page_estimates(counts):
    """Shape one place's figures for the page JSON."""
    return {"year": PEP_VINTAGE, "base": counts["base"], "latest": counts["latest"]}


def state_estimates(by_county):
    """Sum all counties for the state page."""
    total = {"base": dict.fromkeys(GROUPS, 0), "latest": dict.fromkeys(GROUPS, 0)}
    for c in by_county.values():
        for year in total:
            for g in GROUPS:
                total[year][g] += c[year][g]
    return page_estimates(total)
