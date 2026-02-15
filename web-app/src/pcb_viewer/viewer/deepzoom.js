import OpenSeadragon from "openseadragon";

export async function createDeepZoomViewer({ el, board }) {
  // board = hasil fetch dari /api/boards/:id/board
  const { tile_size, overlap, max_level, url_template } = board.tiles;
  const { full_width_px, full_height_px } = board.image;

  // OSD pakai level 0 = paling kecil atau paling besar? (OSD: level 0 biasanya paling kecil)
  // Kita “map” pakai 'maxLevel' dan buat getTileUrl manual.
  const viewer = OpenSeadragon({
    element: el,
    prefixUrl: "/openseadragon-images/", // (lihat catatan di bawah)
    showNavigator: true,
    maxZoomPixelRatio: 2,
    tileSources: {
      width: full_width_px,
      height: full_height_px,
      tileSize: tile_size,
      tileOverlap: overlap,
      minLevel: 0,
      maxLevel: max_level,
      getTileUrl: function (level, x, y) {
        // level yang diminta OSD = 0..maxLevel
        // url_template Anda juga 0..max_level -> cocok
        return url_template
          .replace("{level}", String(level))
          .replace("{x}", String(x))
          .replace("{y}", String(y));
      },
    },
  });

  return viewer;
}
