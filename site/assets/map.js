/*
 * Dot map: OpenLayers + OpenFreeMap basemap + share-encoded dot tiles.
 * Exposes window.DotMap.create(target, pageData, tileset, options)
 *   -> { map, fit, setColors(hexList), setPage(pageData), onSelect(fn(slug)) }.
 */
(function () {
  "use strict";

  var TILE = 256;
  var WATER = "#dceff7";
  var ROAD = "rgba(70, 70, 70, 0.32)";
  var BOUNDARY = "rgba(40, 40, 40, 0.45)";
  var LABEL_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  function zoomFor(resolution) {
    return Math.log2(156543.03392804097 / resolution);
  }

  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h.replace(/./g, "$&$&");
    return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); });
  }

  /* ---------- dot tiles ---------- */

  // Decoded share data per tile URL, so recoloring doesn't refetch.
  var rawCache = new Map();
  var RAW_CACHE_MAX = 800;

  function decode(img) {
    var c = document.createElement("canvas");
    c.width = TILE;
    c.height = TILE * 2;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, TILE, TILE * 2).data;
  }

  function paint(raw, palette) {
    var c = document.createElement("canvas");
    c.width = c.height = TILE;
    var ctx = c.getContext("2d");
    var out = ctx.createImageData(TILE, TILE);
    var o = out.data, n = TILE * TILE, bottom = n * 4;
    var p0 = palette[0], p1 = palette[1], p2 = palette[2],
        p3 = palette[3], p4 = palette[4], p5 = palette[5];
    for (var i = 0; i < n; i++) {
      var t = i * 4, b = bottom + t;
      var a = raw[b + 2];
      if (!a) continue;
      var s0 = raw[t], s1 = raw[t + 1], s2 = raw[t + 2], s3 = raw[b], s4 = raw[b + 1];
      var s5 = 255 - s0 - s1 - s2 - s3 - s4;
      if (s5 < 0) s5 = 0;
      var sum = s0 + s1 + s2 + s3 + s4 + s5 || 1;
      o[t]     = (s0 * p0[0] + s1 * p1[0] + s2 * p2[0] + s3 * p3[0] + s4 * p4[0] + s5 * p5[0]) / sum;
      o[t + 1] = (s0 * p0[1] + s1 * p1[1] + s2 * p2[1] + s3 * p3[1] + s4 * p4[1] + s5 * p5[1]) / sum;
      o[t + 2] = (s0 * p0[2] + s1 * p1[2] + s2 * p2[2] + s3 * p3[2] + s4 * p4[2] + s5 * p5[2]) / sum;
      o[t + 3] = a;
    }
    ctx.putImageData(out, 0, 0);
    return c;
  }

  function emptyTile() {
    var c = document.createElement("canvas");
    c.width = c.height = 1;
    return c;
  }

  function loadImage(src, done) {
    var img = new Image();
    img.onload = function () { done(img); };
    img.onerror = function () { done(null); };
    img.src = src;
  }

  // Fetch one tile's PNG from a PMTiles archive as an image (null if absent).
  function pmtilesLoader(url) {
    var archive = new pmtiles.PMTiles(url);
    return function (z, x, y, done) {
      archive.getZxy(z, x, y).then(function (res) {
        if (!res) return done(null);
        var blobUrl = URL.createObjectURL(new Blob([res.data], { type: "image/png" }));
        loadImage(blobUrl, function (img) {
          URL.revokeObjectURL(blobUrl);
          done(img);
        });
      }, function () { done(null); });
    };
  }

  function dotLayer(tiles, tileset, getPalette) {
    var usePmtiles = /\.pmtiles$/.test(tiles);
    var fetchPmtiles = usePmtiles ? pmtilesLoader(tiles) : null;
    var source = new ol.source.XYZ({
      url: usePmtiles ? "pmtiles:{z}/{x}/{y}" : tiles,
      minZoom: tileset.minzoom,
      maxZoom: tileset.maxzoom,
      interpolate: false,
      attributions: "Population: U.S. Census Bureau, 2020 Census",
      tileLoadFunction: function (tile, src) {
        var cached = rawCache.get(src);
        if (cached) {
          tile.setImage(paint(cached, getPalette()));
          return;
        }
        var done = function (img) {
          if (!img) return tile.setImage(emptyTile());
          var raw = decode(img);
          rawCache.set(src, raw);
          if (rawCache.size > RAW_CACHE_MAX) rawCache.delete(rawCache.keys().next().value);
          tile.setImage(paint(raw, getPalette()));
        };
        if (fetchPmtiles) {
          var c = tile.getTileCoord();
          fetchPmtiles(c[0], c[1], c[2], done);
        } else {
          loadImage(src, done);
        }
      },
    });
    var extent = ol.proj.transformExtent(tileset.bounds, "EPSG:4326", "EPSG:3857");
    return new ol.layer.Tile({ source: source, extent: extent, zIndex: 2 });
  }

  /* ---------- basemap ---------- */

  var styleCache = {};
  function cached(key, make) {
    return styleCache[key] || (styleCache[key] = make());
  }

  function stroke(color, width, dash) {
    return new ol.style.Style({
      stroke: new ol.style.Stroke({ color: color, width: width, lineDash: dash || undefined }),
    });
  }

  function underStyle(feature, resolution) {
    var layer = feature.get("layer");
    if (layer === "water") {
      return cached("water", function () {
        return new ol.style.Style({ fill: new ol.style.Fill({ color: WATER }) });
      });
    }
    if (layer === "waterway" && zoomFor(resolution) >= 11) {
      return cached("waterway", function () { return stroke(WATER, 1.2); });
    }
    return null;
  }

  var ROAD_RULES = {
    motorway:  { minZoom: 0,  width: [0.8, 1.6] },
    trunk:     { minZoom: 0,  width: [0.7, 1.4] },
    primary:   { minZoom: 9,  width: [0.6, 1.2] },
    secondary: { minZoom: 10, width: [0.5, 1.0] },
    tertiary:  { minZoom: 11, width: [0.5, 0.9] },
    minor:     { minZoom: 13, width: [0.4, 0.7] },
    service:   { minZoom: 15, width: [0.3, 0.5] },
  };

  var PLACE_RULES = {
    city:          { minZoom: 0,  size: 14, weight: 600 },
    town:          { minZoom: 9,  size: 12, weight: 500 },
    village:       { minZoom: 11, size: 11, weight: 500 },
    suburb:        { minZoom: 11, size: 11, weight: 500 },
    neighbourhood: { minZoom: 13, size: 10, weight: 500 },
  };

  function labelStyle(text, size, weight, color, italic) {
    return new ol.style.Style({
      text: new ol.style.Text({
        text: text,
        font: (italic ? "italic " : "") + weight + " " + size + "px " + LABEL_FONT,
        fill: new ol.style.Fill({ color: color }),
        stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.92)", width: 3 }),
        overflow: true,
      }),
      zIndex: 10,
    });
  }

  function featureName(feature) {
    return feature.get("name:en") || feature.get("name_en") || feature.get("name");
  }

  function overStyle(feature, resolution) {
    var layer = feature.get("layer");
    var z = zoomFor(resolution);

    if (layer === "transportation") {
      if (feature.get("brunnel") === "tunnel") return null;
      var rule = ROAD_RULES[feature.get("class")];
      if (!rule || z < rule.minZoom) return null;
      var w = z >= 12 ? rule.width[1] : rule.width[0];
      return cached("road" + w, function () { return stroke(ROAD, w); });
    }

    if (layer === "boundary") {
      if (feature.get("maritime") === 1) return null;
      var level = feature.get("admin_level");
      if (level === 4) return cached("state", function () { return stroke(BOUNDARY, 1, [5, 4]); });
      if (level === 6 && z >= 8) return cached("county", function () { return stroke("rgba(40,40,40,0.25)", 0.8); });
      return null;
    }

    if (layer === "place") {
      var place = PLACE_RULES[feature.get("class")];
      var name = featureName(feature);
      if (!place || !name || z < place.minZoom) return null;
      var rank = feature.get("rank") || 10;
      if (feature.get("class") === "city" && z < 9 && rank > 6) return null;
      return cached("place:" + feature.get("class") + ":" + name, function () {
        return labelStyle(name, place.size, place.weight, "#1d2125");
      });
    }

    if (layer === "water_name" && feature.get("class") === "ocean") {
      var ocean = featureName(feature);
      if (!ocean) return null;
      return cached("ocean:" + ocean, function () {
        return labelStyle(ocean, 13, 500, "#5a7f91", true);
      });
    }
    return null;
  }

  function basemapLayers(tileJsonUrl) {
    var source = new ol.source.VectorTile({
      format: new ol.format.MVT(),
      maxZoom: 14,
      attributions:
        '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
        '© <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
        'Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
    });
    fetch(tileJsonUrl)
      .then(function (r) { return r.json(); })
      .then(function (tj) { source.setUrls(tj.tiles); })
      .catch(function (e) { console.warn("Basemap unavailable:", e); });
    return [
      new ol.layer.VectorTile({ source: source, style: underStyle, zIndex: 1 }),
      new ol.layer.VectorTile({ source: source, style: overStyle, declutter: true, zIndex: 4 }),
    ];
  }

  /* ---------- current outline ---------- */

  function readGeometry(geometry) {
    return new ol.format.GeoJSON().readFeatures(
      { type: "Feature", geometry: geometry, properties: {} },
      { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }
    );
  }

  function outlineLayer(boundary) {
    return new ol.layer.Vector({
      source: new ol.source.Vector({ features: readGeometry(boundary) }),
      zIndex: 3.5,
      style: [
        new ol.style.Style({ stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.85)", width: 4.5 }) }),
        new ol.style.Style({ stroke: new ol.style.Stroke({ color: "#312e81", width: 2 }) }),
      ],
    });
  }

  /* ---------- clickable counties ---------- */

  // Transparent fill so the whole county area responds to the pointer.
  var COUNTY_HIT = new ol.style.Style({ fill: new ol.style.Fill({ color: "rgba(0,0,0,0)" }) });
  var COUNTY_HOVER = new ol.style.Style({
    fill: new ol.style.Fill({ color: "rgba(49,46,129,0.08)" }),
    stroke: new ol.style.Stroke({ color: "rgba(49,46,129,0.75)", width: 1.5 }),
  });

  function countyPicker(map, url, getCurrent, onSelect) {
    var fmt = new Intl.NumberFormat("en-US");
    var hovered = null;
    var source = new ol.source.Vector({
      url: url,
      format: new ol.format.GeoJSON({ dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }),
    });
    var layer = new ol.layer.Vector({
      source: source,
      zIndex: 3,
      style: function (feature) {
        if (feature.get("slug") === getCurrent()) return null; // not selectable
        return feature === hovered ? COUNTY_HOVER : COUNTY_HIT;
      },
    });
    map.addLayer(layer);

    var tip = document.createElement("div");
    tip.className = "county-tip";
    tip.hidden = true;
    var overlay = new ol.Overlay({ element: tip, positioning: "bottom-center", offset: [0, -14], stopEvent: false });
    map.addOverlay(overlay);

    function countyAt(pixel) {
      return map.forEachFeatureAtPixel(pixel, function (f) { return f; }, {
        layerFilter: function (l) { return l === layer; },
      }) || null;
    }

    function setHover(feature, coordinate) {
      if (feature !== hovered) {
        hovered = feature;
        layer.changed();
        map.getTargetElement().style.cursor = feature ? "pointer" : "";
        if (feature) {
          tip.innerHTML = "<strong></strong><span></span>";
          tip.querySelector("strong").textContent = feature.get("name");
          tip.querySelector("span").textContent = fmt.format(feature.get("people")) + " people";
        }
        tip.hidden = !feature;
      }
      if (feature) overlay.setPosition(coordinate);
    }

    map.on("pointermove", function (evt) {
      if (evt.dragging) return;
      var touch = evt.originalEvent && evt.originalEvent.pointerType === "touch";
      setHover(touch ? null : countyAt(evt.pixel), evt.coordinate);
    });
    map.getViewport().addEventListener("mouseleave", function () { setHover(null); });

    map.on("singleclick", function (evt) {
      var feature = countyAt(evt.pixel);
      setHover(null);
      if (feature) onSelect(feature.get("slug"));
    });

    return {
      refresh: function () {
        setHover(null);
        layer.changed();
      },
    };
  }

  /* ---------- map ---------- */

  function create(target, page, tileset, options) {
    var cfg = window.DOTMAP_CONFIG;
    var palette = cfg.groups.map(function (g) { return hexToRgb(g.color); });
    var dots = dotLayer(cfg.tiles, tileset, function () { return palette; });
    var outline = outlineLayer(page.boundary);
    var selectHandler = null;

    var map = new ol.Map({
      target: target,
      layers: basemapLayers(cfg.basemap).concat([dots, outline]),
      view: new ol.View({
        minZoom: Math.max(3, tileset.minzoom - 1),
        maxZoom: tileset.maxzoom + (cfg.zoomPastTiles == null ? 1 : cfg.zoomPastTiles),
      }),
      controls: ol.control.defaults.defaults({ attributionOptions: { collapsible: true } }),
    });

    var picker = page.counties
      ? countyPicker(map, "data/" + page.counties,
          function () { return page.slug; },
          function (slug) { if (selectHandler) selectHandler(slug); })
      : null;

    function fit(duration) {
      var extent = ol.proj.transformExtent(page.bbox, "EPSG:4326", "EPSG:3857");
      var pad = (options && options.padding && options.padding()) || [40, 40, 40, 40];
      map.getView().fit(extent, { padding: pad, duration: duration || 0 });
    }
    fit();

    return {
      map: map,
      fit: fit,
      setColors: function (hexList) {
        palette = hexList.map(hexToRgb);
        dots.getSource().refresh();
      },
      // Show another place without reloading the map.
      setPage: function (next) {
        page = next;
        var src = outline.getSource();
        src.clear();
        src.addFeatures(readGeometry(page.boundary));
        if (picker) picker.refresh();
        fit(600);
      },
      onSelect: function (fn) { selectHandler = fn; },
    };
  }

  window.DotMap = { create: create };
})();
