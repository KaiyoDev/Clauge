//! In-process state for a pending update.
//!
//! The frontend's flow is two-step: `check_for_update_in_channel()` finds
//! and pre-downloads the next version, returning version + release-notes
//! metadata; `install_pending_update()` runs the install. Between the two
//! calls we have to keep the `Update` object alive in Rust state so we can
//! reuse it (the JS side never sees the typed Update — only metadata).

use parking_lot::Mutex;
use std::sync::Arc;
use tauri_plugin_updater::Update;

#[derive(Default)]
pub struct PendingUpdate {
    inner: Arc<Mutex<Option<Update>>>,
}

impl PendingUpdate {
    pub fn store(&self, update: Update) {
        *self.inner.lock() = Some(update);
    }

    pub fn take(&self) -> Option<Update> {
        self.inner.lock().take()
    }
}
