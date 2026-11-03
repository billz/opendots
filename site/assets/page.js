/*
 * County page: loads data/<slug>.json, builds the map, table, and summary.
 */
(function () {
  "use strict";

  var cfg = window.DOTMAP_CONFIG;
  var STORAGE_KEY = "dotmap-colors";
  var slug = document.body.dataset.slug;
  var fmt = new Intl.NumberFormat("en-US");
  var pct = function (x) { return (x * 100).toFixed(1) + "%"; };

  function savedColors() {
    if (!cfg.colorPicker) return null;
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (e) { return null; }
  }

  function currentColors() {
    var saved = savedColors() || {};
    return cfg.groups.map(function (g) { return saved[g.id] || g.color; });
  }

  function isNarrow() {
    return window.matchMedia("(max-width: 760px)").matches;
  }

  function renderTable(page, colors) {
    var counts = page.census2020;
    var total = cfg.groups.reduce(function (s, g) { return s + counts[g.id]; }, 0);
    var rows = cfg.groups
      .map(function (g, i) { return { g: g, i: i, n: counts[g.id], share: counts[g.id] / total }; })
      .sort(function (a, b) { return b.n - a.n; });

    var tbody = document.querySelector("#groups tbody");
    tbody.innerHTML = "";
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<th scope="row"><span class="swatch" data-group="' + r.g.id + '"></span>' +
        '<span class="group-label"></span></th>' +
        '<td class="num">' + fmt.format(r.n) + "</td>" +
        '<td class="share"><span class="bar"><span></span></span>' + pct(r.share) + "</td>";
      tr.querySelector(".group-label").textContent = r.g.label;
      var bar = tr.querySelector(".bar span");
      bar.style.width = (r.share * 100).toFixed(2) + "%";
      bar.dataset.group = r.g.id;
      tbody.appendChild(tr);
    });
    document.getElementById("total").textContent = fmt.format(total);
    applySwatchColors(colors);
    return { total: total, rows: rows };
  }

  function applySwatchColors(colors) {
    cfg.groups.forEach(function (g, i) {
      document.querySelectorAll('[data-group="' + g.id + '"]').forEach(function (el) {
        el.style.background = colors[i];
      });
    });
  }

  function renderSummary(page, stats) {
    var top = stats.rows;
    var diversity = 1 - top.reduce(function (s, r) { return s + r.share * r.share; }, 0);
    var label = function (r) { return r.g.label; };
    var p = document.getElementById("summary");
    p.textContent =
      "The 2020 Census counted " + fmt.format(stats.total) + " people in " + page.name + ". " +
      label(top[0]) + " residents were the largest group, at " + pct(top[0].share) +
      ", followed by " + label(top[1]) + " (" + pct(top[1].share) + ") and " +
      label(top[2]) + " (" + pct(top[2].share) + ").";
    document.getElementById("diversity").textContent = pct(diversity);
  }

  function setupPicker(map, colors) {
    if (!cfg.colorPicker || !window.Huebee) return;
    document.body.classList.add("can-pick");
    var reset = document.getElementById("reset-colors");
    reset.hidden = false;

    function update(newColors) {
      colors = newColors;
      var saved = {};
      cfg.groups.forEach(function (g, i) { saved[g.id] = colors[i]; });
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch (e) {}
      applySwatchColors(colors);
      map.setColors(colors);
    }

    document.querySelectorAll("#groups .swatch").forEach(function (sw) {
      var i = cfg.groups.findIndex(function (g) { return g.id === sw.dataset.group; });
      sw.setAttribute("role", "button");
      sw.setAttribute("tabindex", "0");
      sw.setAttribute("aria-label", "Change color for " + cfg.groups[i].label);
      var hb = new Huebee(sw, { setText: false, setBGColor: false, notation: "hex", saturations: 2, shades: 7 });
      hb.on("change", function (color) {
        var next = colors.slice();
        next[i] = color;
        update(next);
      });
    });

    reset.addEventListener("click", function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      colors = cfg.groups.map(function (g) { return g.color; });
      applySwatchColors(colors);
      map.setColors(colors);
    });
  }

  function start() {
    var getJson = function (url) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
        return r.json();
      });
    };
    Promise.all([getJson("data/" + slug + ".json"), getJson("data/tileset.json")])
      .then(function (results) {
        var page = results[0], tileset = results[1];
        var colors = currentColors();
        var dotmap = DotMap.create("map", page, tileset, {
          padding: function () {
            if (isNarrow()) return [24, 24, 24, 24];
            var panel = document.querySelector(".panel");
            return [48, 48, 48, panel.getBoundingClientRect().right + 32];
          },
        });
        if (colors.join() !== cfg.groups.map(function (g) { return g.color; }).join()) {
          dotmap.setColors(colors);
        }
        window.dotmap = dotmap; // handy for debugging in the console
        var stats = renderTable(page, colors);
        renderSummary(page, stats);
        setupPicker(dotmap, colors);
      })
      .catch(function (e) {
        document.getElementById("summary").textContent =
          "Couldn't load the data for this page (" + e.message + "). " +
          "Open it through a web server rather than as a file.";
      });
  }

  start();
})();
