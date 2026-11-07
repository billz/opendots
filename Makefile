PY = .venv/bin/python
RAW = data/raw

CENSUS = https://www2.census.gov
COUNTIES_URL = $(CENSUS)/geo/tiger/GENZ2020/shp/cb_2020_us_county_500k.zip
STATES_URL = $(CENSUS)/geo/tiger/GENZ2020/shp/cb_2020_us_state_500k.zip

.PHONY: all setup data dots tiles site serve clean counts

all: setup data dots tiles site

setup: .venv
.venv:
	python3 -m venv .venv
	$(PY) -m pip install -q -r pipeline/requirements.txt

# Downloads Census files for every state listed in pipeline/config.py.
data:
	mkdir -p $(RAW)
	test -f $(RAW)/cb_2020_us_county_500k.zip || curl -sfL -o $(RAW)/cb_2020_us_county_500k.zip $(COUNTIES_URL)
	test -f $(RAW)/cb_2020_us_state_500k.zip || curl -sfL -o $(RAW)/cb_2020_us_state_500k.zip $(STATES_URL)
	cd pipeline && ../$(PY) download.py

dots:
	cd pipeline && ../$(PY) make_dots.py

# Pages without dots or tiles: downloads only the small Census files (~1 GB
# nationally) and writes group totals. Use with the live tiles to test pages.
counts:
	cd pipeline && ../$(PY) download.py --counts-only && ../$(PY) make_dots.py --counts-only

tiles:
	cd pipeline && ../$(PY) render_tiles.py

site:
	cd pipeline && ../$(PY) build_site.py

serve:
	cd pipeline && ../$(PY) serve.py 8000

clean:
	rm -rf data/work site/tiles site/tiles.pmtiles site/data
