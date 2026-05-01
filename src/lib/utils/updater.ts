import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { STORAGE_KEYS } from '$lib/shared/constants/storage';
import { supportsSelfUpdate } from '$lib/utils/platform';

export type UpdateChannel = 'stable' | 'pre';

/** Reads the user's update channel from localStorage. Default: stable. */
export function getUpdateChannel(): UpdateChannel {
  if (typeof localStorage === 'undefined') return 'stable';
  return localStorage.getItem(STORAGE_KEYS.UPDATE_CHANNEL) === 'pre' ? 'pre' : 'stable';
}

/** Persists the user's update channel choice. */
export function setUpdateChannel(channel: UpdateChannel): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.UPDATE_CHANNEL, channel);
}

let updateReadyData: { version: string; body: string } | null = null;
// Sentinel — true means "an Update is staged in Rust state, ready to install".
// The actual Update object lives in tauri::State (PendingUpdate); we never see
// it from JS to avoid round-tripping a non-Cloneable type.
let pendingUpdate: boolean = false;

/** Reactive store: set when an update has been downloaded and is ready to install */
export const updateAvailable = writable<{ version: string; body: string } | null>(null);

/** Reactive store: controls visibility of the What's New modal */
export const showWhatsNewModal = writable(false);

/** Reactive store: holds changelog content for What's New display */
export const whatsNewContent = writable<{ version: string; body: string } | null>(null);

/**
 * Check for updates, download if available, and set the updateAvailable store.
 * Returns update info if an update was found, null otherwise.
 *
 * Routes through the Rust-side channel-aware updater so that pre-release
 * users see the latest pre-release and stable users only see stable.
 *
 * Skips entirely on Linux deb/rpm installs — those are owned by the system
 * package manager and would error trying to overwrite /usr/bin contents.
 */
export async function checkAndDownloadUpdate(): Promise<{ version: string; body: string } | null> {
  try {
    if (!(await supportsSelfUpdate())) {
      return null;
    }
    const channel = getUpdateChannel();
    const info = await invoke<{ version: string; body: string } | null>(
      'check_for_update_in_channel',
      { channel }
    );
    if (!info) return null;

    pendingUpdate = true; // sentinel — actual Update object lives in Rust state
    updateReadyData = info;
    updateAvailable.set(info);
    return info;
  } catch (e) {
    console.warn('Update check failed:', e);
  }
  return null;
}

/**
 * Install the pending update and relaunch the app.
 *
 * If no pending update is loaded (e.g. user closed the app between check
 * and install), re-runs the check on the current channel before installing.
 */
export async function restartToUpdate(): Promise<void> {
  if (!pendingUpdate) {
    try {
      await checkAndDownloadUpdate();
    } catch (_) { /* ignore */ }
  }
  if (!pendingUpdate) return;
  try {
    await invoke('install_pending_update');
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    console.error('Update restart failed:', e);
  }
}

/**
 * Get the current update-ready data (non-reactive).
 */
export function getUpdateReady(): { version: string; body: string } | null {
  return updateReadyData;
}

/**
 * Check if this version is new since last launch and fetch release notes.
 * Shows the What's New modal if the version changed.
 */
export async function checkWhatsNew(currentVersion: string): Promise<{ version: string; body: string } | null> {
  const lastSeen = typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEYS.LAST_SEEN_VERSION)
    : null;

  if (lastSeen && lastSeen !== currentVersion) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/ansxuman/Clauge/releases/tags/v${currentVersion}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.body) {
          const info = { version: currentVersion, body: data.body };
          whatsNewContent.set(info);
          showWhatsNewModal.set(true);
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEYS.LAST_SEEN_VERSION, currentVersion);
          }
          return info;
        }
      }
    } catch { /* ignore */ }
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.LAST_SEEN_VERSION, currentVersion);
  }
  return null;
}

/**
 * Convert GitHub release markdown to simple HTML.
 */
export function renderReleaseMarkdown(md: string): string {
  return md
    .replace(/\r\n/g, '\n')
    .replace(/^\s*### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^\s*## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^\s*# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    .replace(/\n\n+/g, '<br>')
    .replace(/\n/g, '');
}
