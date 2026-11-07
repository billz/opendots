/*
 * County page: loads data/<slug>.json, builds the map, table, and summary.
 */
(function () {
  "use strict";

  var cfg = window.DOTMAP_CONFIG;
  var STORAGE_KEY = "dotmap-colors";
  var slug = document.body.dataset.slug;
  var HOME_SLUG = "united-states"; // the national map is served at the site root

  function pageUrl(s) { return s === HOME_SLUG ? "./" : s + ".html"; }

  function slugFromPath() {
    var file = location.pathname.split("/").pop().replace(/\.html$/, "");
    return !file || file === "index" ? HOME_SLUG : file;
  }
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

  /* ---------- change since 2020 ---------- */

  var MIN_BASE_FOR_PERCENT = 100; // below this, show the change in people

  function shares(counts) {
    var total = cfg.groups.reduce(function (s, g) { return s + counts[g.id]; }, 0) || 1;
    var out = {};
    cfg.groups.forEach(function (g) { out[g.id] = counts[g.id] / total; });
    return out;
  }

  // One change figure: arrow + text, plus a plain-language tooltip.
  function delta(kind, text, title) {
    var span = document.createElement("span");
    span.className = "delta " + kind;
    span.title = title;
    var arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = kind === "up" ? "▲" : kind === "down" ? "▼" : "–";
    span.appendChild(arrow);
    span.appendChild(document.createTextNode(text));
    return span;
  }

  function countDelta(base, latest, year) {
    var diff = latest - base;
    var since = " since April 2020 (" + fmt.format(base) + " → " + fmt.format(latest) + " in " + year + ")";
    if (base < MIN_BASE_FOR_PERCENT) {
      if (diff === 0) return delta("flat", "no change", "No change" + since);
      var people = fmt.format(Math.abs(diff)) + (Math.abs(diff) === 1 ? " person" : " people");
      return delta(diff > 0 ? "up" : "down", (diff > 0 ? "+" : "−") + people, (diff > 0 ? "Up " : "Down ") + people + since);
    }
    var change = diff / base * 100;
    if (Math.abs(change) < 0.5) return delta("flat", "little change", "Changed by less than 0.5%" + since);
    var text = Math.abs(change).toFixed(1) + "%";
    return delta(change > 0 ? "up" : "down", text, (change > 0 ? "Up " : "Down ") + text + since);
  }

  function shareDelta(before, after) {
    var pts = (after - before) * 100;
    var detail = " (" + pct(before) + " in 2020, " + pct(after) + " now)";
    if (Math.abs(pts) < 0.1) return delta("flat", "share steady", "Share of the population barely changed" + detail);
    var text = "share " + Math.abs(pts).toFixed(1) + " pts";
    return delta(pts > 0 ? "up" : "down", text, "Share of the population " + (pts > 0 ? "rose " : "fell ") +
      Math.abs(pts).toFixed(1) + " percentage points" + detail);
  }

  function changeRow(parts) {
    var tr = document.createElement("tr");
    tr.className = "change";
    var td = document.createElement("td");
    td.colSpan = 3;
    parts.forEach(function (p) { td.appendChild(p); });
    tr.appendChild(td);
    return tr;
  }

  function baseLabel(n) {
    var span = document.createElement("span");
    span.className = "latest";
    span.title = "April 2020 starting point of the Census Bureau estimates: the 2020 Census, " +
      "with \u201cSome other race\u201d assigned to a specific race";
    span.textContent = "2020: " + fmt.format(n);
    return span;
  }

  function sumOf(counts) {
    return cfg.groups.reduce(function (s, g) { return s + counts[g.id]; }, 0);
  }

  // Headline figures are the latest estimates when available, else the 2020 Census.
  function renderTable(page, colors) {
    var est = page.estimates;
    var counts = est ? est.latest : page.census2020;
    var total = sumOf(counts);
    var rows = cfg.groups
      .map(function (g, i) { return { g: g, i: i, n: counts[g.id], share: counts[g.id] / total }; })
      .sort(function (a, b) { return b.n - a.n; });
    var baseShare = est && shares(est.base);
    var latestShare = est && shares(est.latest);

    document.getElementById("people-heading").textContent = est ? "People, " + est.year : "People, 2020";

    var tbody = document.querySelector("#groups tbody");
    tbody.innerHTML = "";
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.className = est ? "group has-change" : "group";
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
      if (est) {
        var id = r.g.id;
        tbody.appendChild(changeRow([
          baseLabel(est.base[id]),
          countDelta(est.base[id], est.latest[id], est.year),
          shareDelta(baseShare[id], latestShare[id]),
        ]));
      }
    });
    document.getElementById("total").textContent = fmt.format(total);

    var foot = document.getElementById("total-change");
    foot.innerHTML = "";
    foot.hidden = !est;
    if (est) {
      var baseTotal = sumOf(est.base);
      foot.appendChild(changeRow([baseLabel(baseTotal), countDelta(baseTotal, total, est.year)]).firstChild);
    }
    var note = document.getElementById("estimate-note");
    var noteText = document.getElementById("estimate-note-text");
    var noEst = document.getElementById("no-estimates");
    note.hidden = !est && !page.noEstimates;
    noteText.hidden = !est;
    noEst.hidden = !!est || !page.noEstimates;
    if (est) document.getElementById("estimate-year").textContent = est.year;
    else if (page.noEstimates) noEst.textContent = page.noEstimates;

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
    var est = page.estimates;
    var census = fmt.format(sumOf(page.census2020));
    var groups =
      label(top[0]) + " residents were the largest group (" + pct(top[0].share) +
      "), followed by " + label(top[1]) + " (" + pct(top[1].share) + ") and " +
      label(top[2]) + " (" + pct(top[2].share) + ").";
    var text;
    if (est) {
      var change = (stats.total - sumOf(est.base)) / sumOf(est.base) * 100;
      text = "An estimated " + fmt.format(stats.total) + " people lived in " + page.name +
        " in July " + est.year +
        (Math.abs(change) < 0.5 ? ", about the same as in 2020. " :
          ", " + (change > 0 ? "up " : "down ") + Math.abs(change).toFixed(1) + "% from 2020. ") + groups;
      // Fastest-growing group, among groups big enough for the percentage to
      // mean something: at least 1% of the population and 1,000 people.
      var baseTotal = sumOf(est.base);
      var growth = cfg.groups
        .filter(function (g) {
          return est.base[g.id] >= MIN_BASE_FOR_PERCENT * 10 && est.base[g.id] / baseTotal >= 0.01;
        })
        .map(function (g) { return { g: g, change: (est.latest[g.id] - est.base[g.id]) / est.base[g.id] * 100 }; })
        .sort(function (a, b) { return b.change - a.change; });
      if (growth.length && growth[0].change >= 0.5) {
        text += " The fastest-growing group since 2020 was " + growth[0].g.label +
          " (up " + growth[0].change.toFixed(1) + "%).";
      }
      text += " The map's dots show the 2020 Census, which counted " + census + " people here.";
    } else {
      text = "The 2020 Census counted " + census + " people in " + page.name + ". " + groups;
    }
    document.getElementById("summary").textContent = text;
    document.getElementById("diversity").textContent = pct(diversity);
    document.getElementById("diversity-year").textContent = est ? " in " + est.year : "";
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
      ? link(pageUrl(page.parent.slug), page.parent.name)
      : link("places.html", "All places"));
  }

  function renderChildren(page) {
    var box = document.getElementById("children");
    box.innerHTML = "";
    if (!page.children || !page.children.length) return;
    var details = document.createElement("details");
    details.className = "children";
    var summary = document.createElement("summary");
    summary.textContent = (page.kind === "country" ? "States (" : "Counties (") + page.children.length + ")";
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
        if (push) history.pushState({ slug: s }, "", pageUrl(s));
      })
      .catch(function () { location.href = pageUrl(s); });
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
          var s = (e.state && e.state.slug) || slugFromPath();
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
