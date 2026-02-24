use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use axum::http::{header, HeaderValue};
use axum::body::Body;
use std::sync::Arc;

use crate::{
    model::{BoardFile, ComponentsFile, Manifest, RailsFile, TopologyFile, ThermalFile},
    state::AppState,
};

fn valid_board_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub async fn get_boards(State(st): State<AppState>) -> impl IntoResponse {
    {
        let guard = st.manifest_cache.read().await;
        if let Some(m) = guard.clone() {
            return (StatusCode::OK, Json(m)).into_response();
        }
    }

    let path = st.manifest_path();

    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("manifest read failed: path={} err={}", path.display(), e);
            return (StatusCode::NOT_FOUND, "manifest.json not found").into_response();
        }
    };

    let manifest: Manifest = match serde_json::from_slice(&bytes) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("manifest parse failed: path={} err={}", path.display(), e);
            return (StatusCode::BAD_REQUEST, "invalid manifest.json").into_response();
        }
    };

    {
        let mut guard = st.manifest_cache.write().await;
        *guard = Some(manifest.clone());
    }

    (StatusCode::OK, Json(manifest)).into_response()
}

pub async fn get_board(Path(board_id): Path<String>, State(st): State<AppState>) -> impl IntoResponse {
    if !valid_board_id(&board_id) {
        return (StatusCode::BAD_REQUEST, "invalid board id").into_response();
    }

    if let Some(v) = st.board_cache.get(&board_id) {
        return (StatusCode::OK, Json(v.value().as_ref().clone())).into_response();
    }

    let path = st.board_path(&board_id);

    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("board read failed: id={} path={} err={}", board_id, path.display(), e);
            return (StatusCode::NOT_FOUND, "board.json not found").into_response();
        }
    };

    let parsed: BoardFile = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("board parse failed: id={} err={}", board_id, e);
            return (StatusCode::BAD_REQUEST, "invalid board.json").into_response();
        }
    };

    let arc = Arc::new(parsed);
    st.board_cache.insert(board_id.clone(), arc.clone());
    (StatusCode::OK, Json(arc.as_ref().clone())).into_response()
}

pub async fn get_components(Path(board_id): Path<String>, State(st): State<AppState>) -> impl IntoResponse {
    if !valid_board_id(&board_id) {
        return (StatusCode::BAD_REQUEST, "invalid board id").into_response();
    }

    if let Some(v) = st.components_cache.get(&board_id) {
        return (StatusCode::OK, Json(v.value().as_ref().clone())).into_response();
    }

    let path = st.components_path(&board_id);

    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("components read failed: id={} path={} err={}", board_id, path.display(), e);
            return (StatusCode::NOT_FOUND, "components.json not found").into_response();
        }
    };

    let parsed: ComponentsFile = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("components parse failed: id={} err={}", board_id, e);
            return (StatusCode::BAD_REQUEST, "invalid components.json").into_response();
        }
    };

    let arc = Arc::new(parsed);
    st.components_cache.insert(board_id.clone(), arc.clone());
    (StatusCode::OK, Json(arc.as_ref().clone())).into_response()
}

pub async fn get_rails(Path(board_id): Path<String>, State(st): State<AppState>) -> impl IntoResponse {
    if !valid_board_id(&board_id) {
        return (StatusCode::BAD_REQUEST, "invalid board id").into_response();
    }

    if let Some(v) = st.rails_cache.get(&board_id) {
        return (StatusCode::OK, Json(v.value().as_ref().clone())).into_response();
    }

    let path = st.rails_path(&board_id);

    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("rails read failed: id={} path={} err={}", board_id, path.display(), e);
            return (StatusCode::NOT_FOUND, "rails.json not found").into_response();
        }
    };

    let parsed: RailsFile = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("rails parse failed: id={} err={}", board_id, e);
            return (StatusCode::BAD_REQUEST, "invalid rails.json").into_response();
        }
    };

    let arc = Arc::new(parsed);
    st.rails_cache.insert(board_id.clone(), arc.clone());
    (StatusCode::OK, Json(arc.as_ref().clone())).into_response()
}

pub async fn get_topology(
    Path(board_id): Path<String>,
    State(st): State<AppState>,
) -> impl IntoResponse {
    if !valid_board_id(&board_id) {
        return (StatusCode::BAD_REQUEST, "invalid board id").into_response();
    }

    if let Some(v) = st.topology_cache.get(&board_id) {
        return (StatusCode::OK, Json(v.value().as_ref().clone())).into_response();
    }

    let path = st.topology_path(&board_id);

    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("topology read failed: id={} path={} err={}", board_id, path.display(), e);
            return (StatusCode::NOT_FOUND, "topology.json not found").into_response();
        }
    };

    let parsed: TopologyFile = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("topology parse failed: id={} err={}", board_id, e);
            return (StatusCode::BAD_REQUEST, "invalid topology.json").into_response();
        }
    };

    let arc = Arc::new(parsed);
    st.topology_cache.insert(board_id.clone(), arc.clone());
    (StatusCode::OK, Json(arc.as_ref().clone())).into_response()
}

pub async fn get_thermal(
    Path(board_id): Path<String>,
    State(st): State<AppState>,
) -> impl IntoResponse {
    if !valid_board_id(&board_id) {
        return (StatusCode::BAD_REQUEST, "invalid board id").into_response();
    }

    if let Some(v) = st.thermal_cache.get(&board_id) {
        return (StatusCode::OK, Json(v.value().as_ref().clone())).into_response();
    }

    let path = st.thermal_path(&board_id);

    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("thermal read failed: id={} path={} err={}", board_id, path.display(), e);
            return (StatusCode::NOT_FOUND, "thermal.json not found").into_response();
        }
    };

    let parsed: ThermalFile = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("thermal parse failed: id={} err={}", board_id, e);
            return (StatusCode::BAD_REQUEST, "invalid thermal.json").into_response();
        }
    };

    let arc = Arc::new(parsed);
    st.thermal_cache.insert(board_id.clone(), arc.clone());
    (StatusCode::OK, Json(arc.as_ref().clone())).into_response()
}

pub async fn get_tile(
    Path((board_id, level, tile_name)): Path<(String, u32, String)>,
    State(st): State<AppState>,
) -> impl IntoResponse {
    if !valid_board_id(&board_id) {
        return (StatusCode::BAD_REQUEST, "invalid board id").into_response();
    }

    let (x, y, ext_req) = match parse_tile_name(&tile_name) {
        Some(v) => v,
        None => return (StatusCode::BAD_REQUEST, "invalid tile name").into_response(),
    };

    // Validate request extension (OSD biasanya .jpg)
    if ext_req != "jpg" && ext_req != "jpeg" && ext_req != "png" {
        return (StatusCode::BAD_REQUEST, "invalid tile extension").into_response();
    }

    // ==========================================================
    // IMPORTANT FIX:
    // Disk tiles kamu levelnya "terbalik" dibanding OpenSeadragon.
    // Kamu punya folder 0..11, dan level 10 di disk hanya 2x3 tiles,
    // artinya disk level tinggi = zoom-out (tile sedikit).
    //
    // Maka kita map: disk_level = MAX_LEVEL - requested_level
    // ==========================================================
    const MAX_LEVEL: u32 = 17;

    if level > MAX_LEVEL {
        return (StatusCode::NOT_FOUND, "tile not found").into_response();
    }

    let disk_level = level;

    // Fallback extension search order:
    // - coba ext yang diminta dulu
    // - lalu coba jpg/jpeg/png lain jika tidak ditemukan
    let mut try_exts = Vec::with_capacity(3);
    try_exts.push(ext_req.clone());
    if ext_req != "jpg" { try_exts.push("jpg".to_string()); }
    if ext_req != "jpeg" { try_exts.push("jpeg".to_string()); }
    if ext_req != "png" { try_exts.push("png".to_string()); }

    let mut last_err: Option<std::io::Error> = None;

    for ext in try_exts {
        let path = st.tile_path(&board_id, disk_level, x, y, &ext);

        match tokio::fs::read(&path).await {
            Ok(bytes) => {
                let content_type = match ext.as_str() {
                    "jpg" | "jpeg" => "image/jpeg",
                    "png" => "image/png",
                    _ => "application/octet-stream",
                };

                let mut resp = Response::new(Body::from(bytes));
                *resp.status_mut() = StatusCode::OK;
                resp.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
                resp.headers_mut().insert(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("public, max-age=31536000, immutable"),
                );
                return resp;
            }
            Err(e) => {
                last_err = Some(e);
                continue;
            }
        }
    }

    // If all attempts fail, log with both requested and mapped levels
    tracing::warn!(
        "tile read failed: id={} req_level={} disk_level={} x={} y={} tile={} err={}",
        board_id,
        level,
        disk_level,
        x,
        y,
        tile_name,
        last_err
            .as_ref()
            .map(|e| e.to_string())
            .unwrap_or_else(|| "unknown".to_string())
    );

    (StatusCode::NOT_FOUND, "tile not found").into_response()
}

fn parse_tile_name(tile_name: &str) -> Option<(u32, u32, String)> {
    let (xy, ext) = tile_name.rsplit_once('.')?;
    let (xs, ys) = xy.split_once('_')?;
    let x: u32 = xs.parse().ok()?;
    let y: u32 = ys.parse().ok()?;
    Some((x, y, ext.to_lowercase()))
}
