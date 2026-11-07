/*
 * Dot map settings. Edit this file to change colors, labels, or features.
 *
 * groups: order must match the tile channels written by
 * pipeline/render_tiles.py (GROUPS in pipeline/config.py).
 * Race groups are non-Hispanic; "Hispanic or Latino" can be of any race.
 */
window.DOTMAP_CONFIG = {
  groups: [
    { id: "hispanic",    label: "Hispanic or Latino",    color: "#e69f00" },
    { id: "white",       label: "White",                 color: "#56b4e9" },
    { id: "black",       label: "Black",                 color: "#009e73" },
    { id: "asian",       label: "Asian",                 color: "#d55e00" },
    { id: "multiracial", label: "Multiracial",           color: "#cc79a7" },
    { id: "other",       label: "Native American/Other", color: "#8c6d31" },
  ],

  // Show a color picker on each legend swatch. Picks are saved per browser.
  colorPicker: false,

  // OpenMapTiles-schema vector tiles (TileJSON URL) for streets and labels.
  basemap: "https://tiles.openfreemap.org/planet",

  // Pre-rendered dot tiles (see pipeline/render_tiles.py). Either the tile
  // folder, which works with any static server, or the single PMTiles file,
  // which needs a server that supports HTTP range requests (Apache, nginx,
  // S3, Cloudflare R2, GitHub Pages). Coverage and zooms come from
  // data/tileset.json.
  tiles: "tiles/{z}/{x}/{y}.png",
  // tiles: "tiles.pmtiles",

  // How the dot colors are drawn. color: 1 blends groups exactly where dots
  // overlap (realistic but muted when zoomed out); higher values lean each
  // spot toward its majority group. opacity: 1 draws density as rendered;
  // higher values make sparsely settled areas more visible. farOpacity is
  // the same for zoomed-out views (state and national scale).
  // Try values live in the browser console: dotmap.setVividness({...}).
  vividness: { color: 2, opacity: 1.5, farOpacity: 2.5 },

  // How far past the most detailed tiles people can zoom in. Each level
  // doubles the size of a dot: 0 = one pixel per dot, 1 = 2x2 pixels,
  // 2 = 4x4 (dots start to look like square blocks).
  zoomPastTiles: 1,
};
