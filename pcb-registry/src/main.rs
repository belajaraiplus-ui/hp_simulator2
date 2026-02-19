mod routes;
mod state;
mod model;

use axum::{routing::get, Router};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::EnvFilter;
use std::path::PathBuf;
use state::AppState;

fn default_data_dir() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let candidate = exe_dir.join("..").join("..").join("assets").join("boards");
    if candidate.exists() {
        return candidate;
    }

    let cwd_candidate = PathBuf::from("assets").join("boards");
    if cwd_candidate.exists() {
        return cwd_candidate;
    }

    PathBuf::from("../assets/boards")
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let data_dir = std::env::var("PCB_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| default_data_dir());

    tracing::info!("PCB_DATA_DIR resolved to: {}", data_dir.display());

    if !data_dir.exists() {
        anyhow::bail!("PCB_DATA_DIR does not exist: {}", data_dir.display());
    }

    let state = AppState::new(data_dir);

    let app = Router::new()
        .route("/api/boards", get(routes::get_boards))
        .route("/api/boards/:id/board", get(routes::get_board))
        .route("/api/boards/:id/components", get(routes::get_components))
        .route("/api/boards/:id/rails", get(routes::get_rails))
        .route("/api/boards/:id/tiles/:level/:tile", get(routes::get_tile))
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let addr = "127.0.0.1:8080";
    tracing::info!("pcb-registry listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
