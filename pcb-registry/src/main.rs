mod routes;
mod state;
mod model;

use axum::{routing::get, Router};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::EnvFilter;

use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let data_dir =
        std::env::var("PCB_DATA_DIR").unwrap_or_else(|_| "../assets/boards".to_string());
    let state = AppState::new(data_dir.into());

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
