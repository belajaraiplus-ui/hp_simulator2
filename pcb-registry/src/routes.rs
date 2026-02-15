use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use axum::response::Response;
use axum::http::{header, HeaderValue};
use axum::body::Body;
use std::sync::Arc;

use crate::{
    model::{BoardFile, ComponentsFile, Manifest, RailsFile},
    state::AppState,
};

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
        Err(_) => return (StatusCode::NOT_FOUND, "manifest.json not found").into_response(),
    };

    let manifest: Manifest = match serde_json::from_slice(&bytes) {
        Ok(m) => m,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid manifest.json").into_response(),
    };

    {
        let mut guard = st.manifest_cache.write().await;
        *guard = Some(manifest.clone());
    }

    (StatusCode::OK, Json(manifest)).into_response()
}

pub async fn get_board(Path(board_id): Path<String>, State(st): State<AppState>) -> impl IntoResponse {
    if let Some(v) = st.board_cache.get(&board_id) {
        let board: BoardFile = v.value().as_ref().clone();
        return (StatusCode::OK, Json(board)).into_response();
    }

    let path = st.board_path(&board_id);
    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::NOT_FOUND, "board.json not found").into_response(),
    };

    let parsed: BoardFile = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid board.json").into_response(),
    };

    let arc = Arc::new(parsed);
    st.board_cache.insert(board_id.clone(), arc.clone());
    (StatusCode::OK, Json(arc.as_ref().clone())).into_response()
}

pub async fn get_components(
    Path(board_id): Path<String>,
    State(st): State<AppState>,
) -> impl IntoResponse {
    if let Some(v) = st.components_cache.get(&board_id) {
        let components: ComponentsFile = v.value().as_ref().clone();
        return (StatusCode::OK, Json(components)).into_response();
    }

    let path = st.components_path(&board_id);
    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::NOT_FOUND, "components.json not found").into_response(),
    };

    let parsed: ComponentsFile = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid components.json").into_response(),
    };

    let arc = Arc::new(parsed);
    st.components_cache.insert(board_id.clone(), arc.clone());
    (StatusCode::OK, Json(arc.as_ref().clone())).into_response()
}

pub async fn get_rails(Path(board_id): Path<String>, State(st): State<AppState>) -> impl IntoResponse {
    if let Some(v) = st.rails_cache.get(&board_id) {
        let rails: RailsFile = v.value().as_ref().clone();
        return (StatusCode::OK, Json(rails)).into_response();
    }

    let path = st.rails_path(&board_id);
    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::NOT_FOUND, "rails.json not found").into_response(),
    };

    let parsed: RailsFile = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid rails.json").into_response(),
    };

    let arc = Arc::new(parsed);
    st.rails_cache.insert(board_id.clone(), arc.clone());
    (StatusCode::OK, Json(arc.as_ref().clone())).into_response()
}

pub async fn get_tile(
    Path((board_id, level, tile_name)): Path<(String, u32, String)>,
    State(st): State<AppState>,
) -> impl IntoResponse {
    // tile_name contoh: "12_8.jpg"
    let (x, y, ext) = match parse_tile_name(&tile_name) {
        Some(v) => v,
        None => return (StatusCode::BAD_REQUEST, "invalid tile name").into_response(),
    };

    let path = st.tile_path(&board_id, level, x, y, &ext);

    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::NOT_FOUND, "tile not found").into_response(),
    };

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
    resp
}

// helper kecil (letakkan di bawah file routes.rs)
fn parse_tile_name(tile_name: &str) -> Option<(u32, u32, String)> {
    // "12_8.jpg"
    let (xy, ext) = tile_name.rsplit_once('.')?;
    let (xs, ys) = xy.split_once('_')?;
    let x: u32 = xs.parse().ok()?;
    let y: u32 = ys.parse().ok()?;
    Some((x, y, ext.to_lowercase()))
}
