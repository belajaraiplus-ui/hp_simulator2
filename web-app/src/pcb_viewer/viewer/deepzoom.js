import OpenSeadragon from "openseadragon";

class HpTileSource extends OpenSeadragon.TileSource {

  constructor(board, getTileUrlFn) {
    const width = Number(board?.image?.full_width_px) || 1;
    const height = Number(board?.image?.full_height_px) || 1;
    const tileSize = Number(board?.tiles?.tile_size) || 256;
    const configuredMax = Number(board?.tiles?.max_level);
    const geometricMax = Math.ceil(Math.log2(Math.max(width, height)));
    const maxLevel = Number.isFinite(configuredMax)
      ? Math.min(configuredMax, geometricMax)
      : geometricMax;
    const overlap = Math.max(0, Number(board?.tiles?.overlap) || 0);

    super({
      width,
      height,
      tileSize,
      tileOverlap: overlap,
      minLevel: 0,
      maxLevel
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
    wrapHorizontal: false,
    wrapVertical: false,
    
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
