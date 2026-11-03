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

  /* ---------- color picker ---------- */

  var colors = currentColors();
  var dotmap = null;

  function updateColors(next) {
    colors = next;
    applySwatchColors(colors);
    if (dotmap) dotmap.setColors(colors);
  }

  function setupPicker() {
    if (!cfg.colorPicker || !window.Huebee) return;
    document.body.classList.add("can-pick");
    var reset = document.getElementById("reset-colors");
    reset.hidden = false;
    reset.addEventListener("click", function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      updateColors(cfg.groups.map(function (g) { return g.color; }));
    });
  }

  // Swatches are rebuilt with the table, so bind pickers after each render.
  function bindSwatches() {
    if (!cfg.colorPicker || !window.Huebee) return;
    document.querySelectorAll("#groups .swatch").forEach(function (sw) {
      var i = cfg.groups.findIndex(function (g) { return g.id === sw.dataset.group; });
      sw.setAttribute("role", "button");
      sw.setAttribute("tabindex", "0");
      sw.setAttribute("aria-label", "Change color for " + cfg.groups[i].label);
      var hb = new Huebee(sw, { setText: false, setBGColor: false, notation: "hex", saturations: 2, shades: 7 });
      hb.on("change", function (color) {
        var next = colors.slice();
        next[i] = color;
        var saved = {};
        cfg.groups.forEach(function (g, j) { saved[g.id] = next[j]; });
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch (e) {}
        updateColors(next);
      });
    });
  }

  /* ---------- showing a place ---------- */

  function link(href, text) {
    var a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    return a;
  }

  function renderNav(page) {
    var nav = document.getElementById("crumbs");
    nav.innerHTML = "";
    nav.appendChild(page.parent
      ? link(page.parent.slug + ".html", page.parent.name)
      : link("index.html", "All places"));
  }

  function renderChildren(page) {
    var box = document.getElementById("children");
    box.innerHTML = "";
    if (!page.children || !page.children.length) return;
    var details = document.createElement("details");
    details.className = "children";
    var summary = document.createElement("summary");
    summary.textContent = "Counties (" + page.children.length + ")";
    var ul = document.createElement("ul");
    page.children.forEach(function (c) {
      var li = document.createElement("li");
      var count = document.createElement("span");
      count.textContent = fmt.format(c.people);
      li.appendChild(link(c.slug + ".html", c.name));
      li.appendChild(count);
      ul.appendChild(li);
    });
    details.appendChild(summary);
    details.appendChild(ul);
    box.appendChild(details);
  }

  function renderPanel(page) {
    var stats = renderTable(page, colors);
    renderSummary(page, stats);
    bindSwatches();
  }

  // Swap the whole page to another place, keeping the map.
  function showPage(page) {
    slug = page.slug;
    document.body.dataset.slug = page.slug;
    document.title = page.title + ": Race and Ethnicity Dot Map";
    var meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.content = "A map of every person in " + page.fullName +
        ", from the 2020 Census, one dot per person, colored by race and ethnicity.";
    }
    document.getElementById("title").textContent = page.title;
    renderNav(page);
    renderChildren(page);
    renderPanel(page);
    document.querySelector(".panel").scrollTop = 0;
    dotmap.setPage(page);
  }

  /* ---------- loading ---------- */

  var pageCache = new Map();

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
      return r.json();
    });
  }

  function loadPage(s) {
    if (!pageCache.has(s)) {
      pageCache.set(s, getJson("data/" + s + ".json").catch(function (e) {
        pageCache.delete(s);
        throw e;
      }));
    }
    return pageCache.get(s);
  }

  function goTo(s, push) {
    if (s === slug) return;
    loadPage(s)
      .then(function (page) {
        showPage(page);
        if (push) history.pushState({ slug: s }, "", s + ".html");
      })
      .catch(function () { location.href = s + ".html"; });
  }

  function start() {
    Promise.all([loadPage(slug), getJson("data/tileset.json")])
      .then(function (results) {
        var page = results[0], tileset = results[1];
        dotmap = DotMap.create("map", page, tileset, {
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
        setupPicker();
        renderPanel(page);

        dotmap.onSelect(function (s) { goTo(s, true); });
        history.replaceState({ slug: slug }, "", location.href);
        window.addEventListener("popstate", function (e) {
          var s = (e.state && e.state.slug) || location.pathname.split("/").pop().replace(/\.html$/, "");
          if (s) goTo(s, false);
        });
      })
      .catch(function (e) {
        document.getElementById("summary").textContent =
          "Couldn't load the data for this page (" + e.message + "). " +
          "Open it through a web server rather than as a file.";
      });
  }

  start();
})();
