use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub boards: Vec<BoardListItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardListItem {
    pub id: String,
    pub name: String,

    // manifest Anda punya "board_url"
    #[serde(default)]
    pub board_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardFile {
    pub version: u32,
    pub id: String,
    pub name: String,

    pub image: ImageMeta,
    pub tiles: TilesMeta,
    pub units: UnitsMeta,
    pub transform: AffineTransform,

    // board.json Anda punya ini
    #[serde(default)]
    pub components_url: Option<String>,
    #[serde(default)]
    pub rails_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageMeta {
    pub full_width_px: u32,
    pub full_height_px: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TilesMeta {
    #[serde(rename = "type")]
    pub kind: String,
    pub tile_size: u32,
    pub overlap: u32,
    pub format: String,
    pub max_level: u32,
    pub url_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitsMeta {
    pub mm_per_px: f64,
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AffineTransform {
    #[serde(rename = "type")]
    pub kind: String,
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub tx: f64,
    pub ty: f64,
}

// components.json (minimal; cukup untuk panel Anda)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentsFile {
    pub version: u32,
    pub components: Vec<ComponentItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentItem {
    pub id: String,
    pub refdes: String,
    #[serde(default)]
    pub kind: String,
}

// rails.json sesuai file Anda
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RailsFile {
    pub version: u32,
    pub rails: Vec<RailItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RailItem {
    pub id: String,
    pub label: String,

    #[serde(rename = "type", default)]
    pub kind: String,

    #[serde(default)]
    pub overlay: Option<RailOverlay>,

    #[serde(default)]
    pub probe_points: Vec<ProbePoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbePoint {
    pub x: f64,
    pub y: f64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RailOverlay {
    #[serde(rename = "type")]
    pub kind: String,

    // "polys": [[[x,y],...], ...]
    #[serde(default)]
    pub polys: Vec<Vec<[f64; 2]>>,
}
