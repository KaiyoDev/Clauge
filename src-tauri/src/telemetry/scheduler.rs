// Bản local thuần: scheduler telemetry đã bị tắt vì gọi clauge.in. Stub
// `spawn` no-op giữ chữ ký cũ để telemetry/mod.rs vẫn re-export được mà
// không cần sửa. Counters trong RAM vẫn hoạt động (telemetry::bump tăng
// AtomicU64), nhưng không bao giờ flush ra mạng — đạt yêu cầu "không thu
// thập dữ liệu cá nhân".

use tauri::AppHandle;

#[inline(always)]
pub fn spawn(_app: AppHandle) {
    // no-op: bản local không gửi telemetry
}
