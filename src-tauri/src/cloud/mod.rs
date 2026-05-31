// Bản local thuần (Clauge Việt): module cloud đã được gỡ bỏ hoàn toàn.
// Chỉ giữ một stub `scheduler::bump` no-op để các call site `crate::cloud::
// scheduler::bump(kind)` rải khắp các mode (rest, sql, nosql, ssh, agent,
// explorer, workspace) vẫn biên dịch mà không cần sửa hàng loạt. Không có
// bất kỳ lệnh gọi mạng nào — dữ liệu của người dùng luôn ở trên máy.

pub mod scheduler;
