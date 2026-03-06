use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use axum::http::{header, HeaderValue};
use axum::body::Body;
use std::collections::HashSet;
use std::sync::Arc;
use std::path::{Path as FsPath, PathBuf};

use crate::{
    model::{BoardFile, ComponentsFile, Manifest, RailsFile, ScenarioFile, TopologyFile, ThermalFile},
    state::AppState,
};



#[derive(Debug)]
enum ScenarioLoadError {
    ReadDir(String),
    Parse { path: String, reason: String },
    Semantic { path: String, reason: String },
    DuplicateId { id: String, first: String, second: String },
}


fn known_world_profiles() -> [&'static str; 8] {
    [
        "IDEAL_BENCH",
        "HOT_HUMID_WORKSHOP",
        "PREVIOUSLY_REPAIRED_DEVICE",
        "POST_PREVIOUS_REPAIR",
        "STABLE_LAB",
        "NOISY_POWER_ENV",
        "POST_WATER_EXPOSURE",
        "RF_UNSTABLE_ENVIRONMENT",
    ]
}

fn validate_scenario_semantics(s: &ScenarioFile) -> Result<(), String> {
    if !known_world_profiles().contains(&s.world_profile.as_str()) {
        return Err(format!("Unknown world_profile: {}", s.world_profile));
    }

    let forbidden = [
        "ic", "pa", "pmic", "short", "konslet", "ganti", "rusak", "solusi", "ntc", "baseband",
    ];

    let notes = s.notes.clone().unwrap_or_default();
    let text = format!(
        "{} {} {} {}",
        s.title,
        s.customer_complaint,
        s.background_story,
        notes
    )
    .to_lowercase();

    let tokens: std::collections::HashSet<&str> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();

    for word in forbidden {
        if tokens.contains(word) {
            return Err(format!("Forbidden term detected: {}", word));
        }
    }

    Ok(())
}

fn load_scenarios_from_dir(path: &FsPath) -> Result<Vec<ScenarioFile>, ScenarioLoadError> {
    let entries = std::fs::read_dir(path)
        .map_err(|e| ScenarioLoadError::ReadDir(format!("read_dir failed: {}", e)))?;

    let mut scenarios: Vec<ScenarioFile> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();
    let mut first_path_by_id: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for entry in entries {
        let entry = match entry {
            Ok(v) => v,
            Err(_) => continue,
        };

        let file_path = entry.path();
        if file_path.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }

        let bytes = match std::fs::read(&file_path) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let s = serde_json::from_slice::<ScenarioFile>(&bytes).map_err(|e| {
            ScenarioLoadError::Parse {
                path: file_path.display().to_string(),
                reason: e.to_string(),
            }
        })?;

        validate_scenario_semantics(&s).map_err(|e| ScenarioLoadError::Semantic {
            path: file_path.display().to_string(),
            reason: e,
        })?;

        let scenario_id = s.id.clone();
        let source = file_path.display().to_string();
        if seen_ids.contains(&scenario_id) {
            let first = first_path_by_id
                .get(&scenario_id)
                .cloned()
                .unwrap_or_else(|| "unknown".to_string());
            return Err(ScenarioLoadError::DuplicateId {
                id: scenario_id,
                first,
                second: source,
            });
        }
        seen_ids.insert(scenario_id.clone());
        first_path_by_id.insert(scenario_id, source);
        scenarios.push(s);
    }

    scenarios.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(scenarios)
}


pub async fn get_scenarios(State(st): State<AppState>) -> impl IntoResponse {
    match load_scenarios_from_dir(&st.scenarios_dir) {
        Ok(scenarios) => (StatusCode::OK, Json(scenarios)).into_response(),
        Err(ScenarioLoadError::ReadDir(e)) => {
            tracing::warn!("scenarios read_dir failed: path={} err={}", st.scenarios_dir.display(), e);
            (StatusCode::NOT_FOUND, "scenarios directory not found").into_response()
        }
        Err(ScenarioLoadError::Parse { path, reason }) => {
            tracing::warn!("scenario parse failed: path={} err={}", path, reason);
            (StatusCode::INTERNAL_SERVER_ERROR, "invalid scenario file detected").into_response()
        }
        Err(ScenarioLoadError::Semantic { path, reason }) => {
            tracing::warn!("scenario semantic invalid: path={} err={}", path, reason);
            (StatusCode::INTERNAL_SERVER_ERROR, "invalid scenario semantics detected").into_response()
        }
        Err(ScenarioLoadError::DuplicateId { id, first, second }) => {
            tracing::warn!(
                "duplicate scenario id detected: id={} first={} second={}",
                id,
                first,
                second
            );
            (StatusCode::INTERNAL_SERVER_ERROR, "duplicate scenario id detected").into_response()
        }
    }
}

fn valid_board_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn source_content_type(ext: &str) -> Option<&'static str> {
    match ext {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        _ => None,
    }
}

fn find_source_image_path(source_dir: &FsPath) -> std::io::Result<Option<(PathBuf, String)>> {
    let mut candidates: Vec<(PathBuf, String)> = Vec::new();
    let entries = std::fs::read_dir(source_dir)?;

    for entry in entries {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .and_then(|v| v.to_str())
            .map(|v| v.to_ascii_lowercase())
            .unwrap_or_default();
        if source_content_type(&ext).is_some() {
            candidates.push((path, ext));
        }
    }

    candidates.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(candidates.into_iter().next())
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

pub async fn get_source(
    Path(board_id): Path<String>,
    State(st): State<AppState>,
) -> impl IntoResponse {
    if !valid_board_id(&board_id) {
        return (StatusCode::BAD_REQUEST, "invalid board id").into_response();
    }

    let source_dir = st.source_dir(&board_id);
    let (source_path, ext) = match find_source_image_path(&source_dir) {
        Ok(Some(v)) => v,
        Ok(None) => return (StatusCode::NOT_FOUND, "source image not found").into_response(),
        Err(e) => {
            tracing::warn!(
                "source dir read failed: id={} path={} err={}",
                board_id,
                source_dir.display(),
                e
            );
            return (StatusCode::NOT_FOUND, "source image not found").into_response();
        }
    };

    let bytes = match tokio::fs::read(&source_path).await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(
                "source image read failed: id={} path={} err={}",
                board_id,
                source_path.display(),
                e
            );
            return (StatusCode::NOT_FOUND, "source image not found").into_response();
        }
    };

    let content_type = match source_content_type(&ext) {
        Some(v) => v,
        None => return (StatusCode::BAD_REQUEST, "unsupported source image extension").into_response(),
    };

    let mut resp = Response::new(Body::from(bytes));
    *resp.status_mut() = StatusCode::OK;
    resp.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600"),
    );
    resp
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

    const MAX_LEVEL: u32 = 17;
    if level > MAX_LEVEL {
        return (StatusCode::NOT_FOUND, "tile not found").into_response();
    }

    // Fallback extension search order:
    // - coba ext yang diminta dulu
    // - lalu coba jpg/jpeg/png lain jika tidak ditemukan
    let mut try_exts = Vec::with_capacity(3);
    try_exts.push(ext_req.clone());
    if ext_req != "jpg" { try_exts.push("jpg".to_string()); }
    if ext_req != "jpeg" { try_exts.push("jpeg".to_string()); }
    if ext_req != "png" { try_exts.push("png".to_string()); }

    let mut last_err: Option<std::io::Error> = None;

    for ext in &try_exts {
        let candidate_paths = [
            st.tile_path(&board_id, level, x, y, ext),
            st.pcb_files_tile_path(&board_id, level, x, y, ext),
        ];

        for path in candidate_paths {
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
    }

    // If all attempts fail, log with request context.
    tracing::warn!(
        "tile read failed: id={} req_level={} x={} y={} tile={} err={}",
        board_id,
        level,
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


#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("{}_{}", prefix, nonce));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn load_scenarios_from_dir_sorts_and_filters() {
        let dir = temp_dir("hp_sim_scenarios");

        std::fs::write(
            dir.join("a.json"),
            r#"{"id":"s2","title":"Z Title","world_profile":"STABLE_LAB","customer_complaint":"c","background_story":"b"}"#,
        )
        .expect("write scenario");
        std::fs::write(
            dir.join("b.json"),
            r#"{"id":"s1","title":"A Title","world_profile":"STABLE_LAB","customer_complaint":"c","background_story":"b"}"#,
        )
        .expect("write scenario");
        std::fs::write(dir.join("readme.txt"), "ignore").expect("write txt");

        let out = load_scenarios_from_dir(&dir).expect("load scenarios");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].title, "A Title");
        assert_eq!(out[1].title, "Z Title");

        std::fs::remove_dir_all(dir).expect("cleanup temp dir");
    }

    #[test]
    fn load_scenarios_from_dir_errors_for_missing_dir() {
        let missing = std::env::temp_dir().join("hp_sim_missing_dir_should_not_exist");
        if missing.exists() {
            std::fs::remove_dir_all(&missing).expect("remove stale dir");
        }

        let err = load_scenarios_from_dir(&missing).expect_err("expected missing dir error");
        match err {
            ScenarioLoadError::ReadDir(msg) => assert!(msg.contains("read_dir failed")),
            _ => panic!("expected ReadDir error"),
        }
    }



    #[test]
    fn load_scenarios_from_dir_rejects_invalid_json() {
        let dir = temp_dir("hp_sim_scenarios_invalid");

        std::fs::write(
            dir.join("ok.json"),
            r#"{"id":"s1","title":"A Title","world_profile":"STABLE_LAB","customer_complaint":"c","background_story":"b"}"#,
        )
        .expect("write scenario");
        std::fs::write(dir.join("bad.json"), "{not-json}").expect("write bad");

        let err = load_scenarios_from_dir(&dir).expect_err("expected parse error");
        match err {
            ScenarioLoadError::Parse { path, .. } => assert!(path.ends_with("bad.json")),
            _ => panic!("expected Parse error"),
        }

        std::fs::remove_dir_all(dir).expect("cleanup temp dir");
    }

    #[tokio::test]
    async fn api_scenarios_endpoint_returns_500_for_invalid_json() {
        let scenarios_dir = temp_dir("hp_sim_scenarios_api_invalid");
        std::fs::write(
            scenarios_dir.join("ok.json"),
            r#"{"id":"s1","title":"A Title","world_profile":"STABLE_LAB","customer_complaint":"c","background_story":"b"}"#,
        )
        .expect("write scenario");
        std::fs::write(scenarios_dir.join("bad.json"), "{not-json}").expect("write bad");

        let boards_dir = temp_dir("hp_sim_boards_dummy_invalid");
        let st = AppState::new(boards_dir.clone(), scenarios_dir.clone());

        let resp = get_scenarios(State(st)).await.into_response();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);

        std::fs::remove_dir_all(scenarios_dir).expect("cleanup scenarios dir");
        std::fs::remove_dir_all(boards_dir).expect("cleanup boards dir");
    }



    #[test]
    fn load_scenarios_from_dir_rejects_unknown_world() {
        let dir = temp_dir("hp_sim_scenarios_bad_world");
        std::fs::write(
            dir.join("bad_world.json"),
            r#"{"id":"s1","title":"A Title","world_profile":"UNKNOWN_WORLD","customer_complaint":"c","background_story":"b"}"#,
        )
        .expect("write bad world");

        let err = load_scenarios_from_dir(&dir).expect_err("expected semantic error");
        match err {
            ScenarioLoadError::Semantic { reason, .. } => assert!(reason.contains("Unknown world_profile")),
            _ => panic!("expected Semantic error"),
        }

        std::fs::remove_dir_all(dir).expect("cleanup temp dir");
    }

    #[tokio::test]
    async fn api_scenarios_endpoint_returns_500_for_invalid_semantics() {
        let scenarios_dir = temp_dir("hp_sim_scenarios_api_semantic");
        std::fs::write(
            scenarios_dir.join("bad_world.json"),
            r#"{"id":"s1","title":"A Title","world_profile":"UNKNOWN_WORLD","customer_complaint":"c","background_story":"b"}"#,
        )
        .expect("write bad world");

        let boards_dir = temp_dir("hp_sim_boards_dummy_semantic");
        let st = AppState::new(boards_dir.clone(), scenarios_dir.clone());

        let resp = get_scenarios(State(st)).await.into_response();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);

        std::fs::remove_dir_all(scenarios_dir).expect("cleanup scenarios dir");
        std::fs::remove_dir_all(boards_dir).expect("cleanup boards dir");
    }



    #[test]
    fn load_scenarios_from_dir_rejects_forbidden_terms() {
        let dir = temp_dir("hp_sim_scenarios_forbidden");
        std::fs::write(
            dir.join("bad_term.json"),
            r#"{"id":"s1","title":"A Title","world_profile":"STABLE_LAB","customer_complaint":"indikasi short saat diuji","background_story":"b"}"#,
        )
        .expect("write bad term");

        let err = load_scenarios_from_dir(&dir).expect_err("expected semantic error");
        match err {
            ScenarioLoadError::Semantic { reason, .. } => assert!(reason.contains("Forbidden term detected")),
            _ => panic!("expected Semantic error"),
        }

        std::fs::remove_dir_all(dir).expect("cleanup temp dir");
    }

    #[tokio::test]
    async fn api_scenarios_endpoint_returns_500_for_forbidden_terms() {
        let scenarios_dir = temp_dir("hp_sim_scenarios_api_forbidden");
        std::fs::write(
            scenarios_dir.join("bad_term.json"),
            r#"{"id":"s1","title":"A Title","world_profile":"STABLE_LAB","customer_complaint":"indikasi short saat diuji","background_story":"b"}"#,
        )
        .expect("write bad term");

        let boards_dir = temp_dir("hp_sim_boards_dummy_forbidden");
        let st = AppState::new(boards_dir.clone(), scenarios_dir.clone());

        let resp = get_scenarios(State(st)).await.into_response();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);

        std::fs::remove_dir_all(scenarios_dir).expect("cleanup scenarios dir");
        std::fs::remove_dir_all(boards_dir).expect("cleanup boards dir");
    }


    #[test]
    fn load_scenarios_from_dir_rejects_duplicate_ids() {
        let dir = temp_dir("hp_sim_scenarios_dup");

        let payload = r#"{"id":"dup","title":"Case","world_profile":"STABLE_LAB","customer_complaint":"c","background_story":"b"}"#;
        std::fs::write(dir.join("one.json"), payload).expect("write one");
        std::fs::write(dir.join("two.json"), payload).expect("write two");

        let err = load_scenarios_from_dir(&dir).expect_err("expected duplicate id error");
        match err {
            ScenarioLoadError::DuplicateId { id, .. } => assert_eq!(id, "dup"),
            _ => panic!("expected DuplicateId error"),
        }

        std::fs::remove_dir_all(dir).expect("cleanup temp dir");
    }

    #[tokio::test]
    async fn api_scenarios_endpoint_returns_500_for_duplicate_ids() {
        let scenarios_dir = temp_dir("hp_sim_scenarios_api_dup");
        let payload = r#"{"id":"dup","title":"Case","world_profile":"STABLE_LAB","customer_complaint":"c","background_story":"b"}"#;
        std::fs::write(scenarios_dir.join("one.json"), payload).expect("write one");
        std::fs::write(scenarios_dir.join("two.json"), payload).expect("write two");

        let boards_dir = temp_dir("hp_sim_boards_dummy_dup");
        let st = AppState::new(boards_dir.clone(), scenarios_dir.clone());

        let resp = get_scenarios(State(st)).await.into_response();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);

        std::fs::remove_dir_all(scenarios_dir).expect("cleanup scenarios dir");
        std::fs::remove_dir_all(boards_dir).expect("cleanup boards dir");
    }


    #[tokio::test]
    async fn api_scenarios_endpoint_returns_sorted_json() {
        let scenarios_dir = temp_dir("hp_sim_scenarios_api");
        std::fs::write(
            scenarios_dir.join("z.json"),
            r#"{"id":"z","title":"Zeta","world_profile":"STABLE_LAB","customer_complaint":"c","background_story":"b"}"#,
        )
        .expect("write z scenario");
        std::fs::write(
            scenarios_dir.join("a.json"),
            r#"{"id":"a","title":"Alpha","world_profile":"STABLE_LAB","customer_complaint":"c","background_story":"b"}"#,
        )
        .expect("write a scenario");

        let boards_dir = temp_dir("hp_sim_boards_dummy");
        let st = AppState::new(boards_dir.clone(), scenarios_dir.clone());

        let resp = get_scenarios(State(st)).await.into_response();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .expect("read body bytes");
        let parsed: Vec<ScenarioFile> = serde_json::from_slice(&body).expect("parse scenarios json");

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].title, "Alpha");
        assert_eq!(parsed[1].title, "Zeta");

        std::fs::remove_dir_all(scenarios_dir).expect("cleanup scenarios dir");
        std::fs::remove_dir_all(boards_dir).expect("cleanup boards dir");
    }

    #[tokio::test]
    async fn api_scenarios_endpoint_returns_404_for_missing_dir() {
        let missing = std::env::temp_dir().join("hp_sim_missing_api_scenarios_dir");
        if missing.exists() {
            std::fs::remove_dir_all(&missing).expect("remove stale dir");
        }

        let boards_dir = temp_dir("hp_sim_boards_dummy_missing");
        let st = AppState::new(boards_dir.clone(), missing);

        let resp = get_scenarios(State(st)).await.into_response();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);

        std::fs::remove_dir_all(boards_dir).expect("cleanup boards dir");
    }


}
