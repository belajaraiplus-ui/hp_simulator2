import OpenSeadragon from "openseadragon";

class HpTileSource extends OpenSeadragon.TileSource {

  constructor(board, getTileUrlFn) {

    super({
      width: board.image.full_width_px,
      height: board.image.full_height_px,
      tileSize: board.tiles.tile_size,
      tileOverlap: board.tiles.overlap || 0,
      minLevel: 0,
      maxLevel: board.tiles.max_level
    });

    this.board = board;
    this.getTileUrlFn = getTileUrlFn;
  }

  getTileUrl(level, x, y) {
    if (this.getTileUrlFn) {
      return this.getTileUrlFn(level, x, y);
    }
    const fmt = this.board.tiles.format || 'jpg';
    return `/api/boards/${this.board.id}/tiles/${level}/${x}_${y}.${fmt}`;
  }

}

export async function createDeepZoomViewer({ el, board, getTileUrl }) {

  const viewer = OpenSeadragon({
    element: el,
    prefixUrl: "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.0/images/",
    showNavigator: true,
    
    // UX & Navigation Settings
    animationTime: 0.5,
    blendTime: 0.1,
    constrainDuringPan: true,
    visibilityRatio: 1.0,
    minZoomImageRatio: 0.8,
    maxZoomPixelRatio: 2.0,
    defaultZoomLevel: 0,
  });

  viewer.open(new HpTileSource(board, getTileUrl));

  return viewer;
}