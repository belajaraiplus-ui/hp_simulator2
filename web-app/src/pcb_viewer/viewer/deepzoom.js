import OpenSeadragon from "openseadragon";

class HpTileSource extends OpenSeadragon.TileSource {

  constructor(board) {

    super({
      width: board.image.full_width_px,
      height: board.image.full_height_px,
      tileSize: board.tiles.tile_size,
      tileOverlap: board.tiles.overlap || 0, // Default 0 to prevent grid lines
      minLevel: 0,
      maxLevel: board.tiles.max_level
    });

    this.board = board;
  }

  getTileUrl(level, x, y) {
    // Use relative path so Vite proxy handles the domain/port
    const fmt = this.board.tiles.format || 'jpg';
    return `/api/boards/${this.board.id}/tiles/${level}/${x}_${y}.${fmt}`;
  }

}

export async function createDeepZoomViewer({ el, board }) {

  const viewer = OpenSeadragon({
    element: el,
    prefixUrl: "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.0/images/",
    showNavigator: true,
    
    // UX & Navigation Settings
    animationTime: 0.5,
    blendTime: 0.1,
    constrainDuringPan: true,
    visibilityRatio: 1.0,     // Keep image in viewport
    minZoomImageRatio: 0.8,   // Prevent zooming out too far
    maxZoomPixelRatio: 2.0,   // Prevent zooming in until pixelated
    defaultZoomLevel: 0,      // 0 = Auto fit to screen
  });

  viewer.open(new HpTileSource(board));

  return viewer;
}