// Stub no-op cho phần "đồng bộ đám mây" đã gỡ. Các mode trước đây gọi
// `bump(kind)` để báo cho Rust scheduler có thay đổi cần đẩy lên cloud;
// bản local thuần không có đám mây nên hàm này không làm gì cả.
//
// Giữ chữ ký `bump(&'static str)` để tránh phải sửa hàng chục call site.

#[inline(always)]
pub fn bump(_kind: &'static str) {
    // no-op: bản local không đồng bộ đám mây
}
