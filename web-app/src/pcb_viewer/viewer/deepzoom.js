import OpenSeadragon from "openseadragon";

export async function createDeepZoomViewer({ el, board }) {
  // board = hasil fetch dari http://127.0.0.1:8080/api/boards/:id/board
  const { tile_size, overlap, max_level, url_template } = board.tiles;
  const { full_width_px, full_height_px } = board.image;

  const viewer = OpenSeadragon({
    element: el,
    // Menggunakan CDN untuk icon kontrol agar tidak perlu copy folder manual dulu
    prefixUrl: "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.0/images/", 
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
        /**
         * SINKRONISASI PENTING:
         * url_template Anda adalah "/api/boards/.../tiles/{level}/{x}_{y}.jpg"
         * Kita harus menambahkan "http://127.0.0.1:8080" agar tidak mencari di port Vite (5173).
         */
        const baseUrl = "http://127.0.0.1:8080";
        return `${baseUrl}${url_template}`
          .replace("{level}", String(level))
          .replace("{x}", String(x))
          .replace("{y}", String(y));
      },
    },
  });

  return viewer;
}