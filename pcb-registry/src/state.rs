use dashmap::DashMap;
use std::{path::PathBuf, sync::Arc};

use crate::model::{BoardFile, ComponentsFile, Manifest, RailsFile};

#[derive(Clone)]
pub struct AppState {
    pub data_dir: PathBuf,

    pub manifest_cache: Arc<tokio::sync::RwLock<Option<Manifest>>>,

    pub board_cache: Arc<DashMap<String, Arc<BoardFile>>>,
    pub components_cache: Arc<DashMap<String, Arc<ComponentsFile>>>,
    pub rails_cache: Arc<DashMap<String, Arc<RailsFile>>>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            manifest_cache: Arc::new(tokio::sync::RwLock::new(None)),
            board_cache: Arc::new(DashMap::new()),
            components_cache: Arc::new(DashMap::new()),
            rails_cache: Arc::new(DashMap::new()),
        }
    }

    pub fn manifest_path(&self) -> PathBuf {
        self.data_dir.join("manifest.json")
    }

    pub fn board_path(&self, board_id: &str) -> PathBuf {
        self.data_dir.join(board_id).join("board.json")
    }

    pub fn components_path(&self, board_id: &str) -> PathBuf {
        self.data_dir.join(board_id).join("components.json")
    }

    pub fn rails_path(&self, board_id: &str) -> PathBuf {
        self.data_dir.join(board_id).join("rails.json")
    }

    pub fn tile_path(&self, board_id: &str, level: u32, x: u32, y: u32, ext: &str) -> PathBuf {
        let filename = format!("{}_{}.{}", x, y, ext);
        self.data_dir.join(board_id).join("tiles").join(level.to_string()).join(filename)
    }
}
