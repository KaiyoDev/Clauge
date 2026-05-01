//! Tauri commands for channel-aware update check + install.

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;

use crate::shared::updater::channel::resolve_endpoint;
use crate::shared::updater::state::PendingUpdate;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub body: String,
}

/// Frontend entry-point. Resolves the right endpoint for the given channel,
/// runs `check()`, and if there's an update, downloads it and stashes the
/// `Update` in state for a follow-up `install_pending_update` call.
///
/// Returns metadata for the new version, or `None` if already up to date.
#[tauri::command]
pub async fn check_for_update_in_channel(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    channel: String,
) -> Result<Option<UpdateInfo>, String> {
    let endpoint = resolve_endpoint(&channel).await?;
    let endpoint_url =
        url::Url::parse(&endpoint).map_err(|e| format!("invalid updater URL: {}", e))?;

    let update = app
        .updater_builder()
        .endpoints(vec![endpoint_url])
        .map_err(|e| format!("updater endpoints: {}", e))?
        .build()
        .map_err(|e| format!("updater build: {}", e))?
        .check()
        .await
        .map_err(|e| format!("update check: {}", e))?;

    let Some(update) = update else {
        return Ok(None);
    };

    // Pre-download so the install step is fast and offline-tolerant. We
    // stash the Update in state — the next call (install) will find it.
    let info = UpdateInfo {
        version: update.version.clone(),
        body: update.body.clone().unwrap_or_default(),
    };

    update
        .download(|_chunk_len, _content_len| {}, || {})
        .await
        .map_err(|e| format!("update download: {}", e))?;

    pending.store(update);
    Ok(Some(info))
}

/// Install the most recently downloaded update and exit. The OS-specific
/// installer takes over from here; on Windows the app is killed mid-flow
/// (a documented Tauri limitation).
#[tauri::command]
pub async fn install_pending_update(
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let Some(update) = pending.take() else {
        return Err("no pending update — run check first".to_string());
    };
    update
        .install(Vec::new())
        .map_err(|e| format!("update install: {}", e))?;
    Ok(())
}
