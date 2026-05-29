<p align="center">
  <img src="src-tauri/icons/clauge-mark.svg" alt="Clauge" width="96" />
</p>

<h1 align="center">Clauge — Phiên bản tiếng Việt</h1>

<p align="center">
  <strong>Một cửa sổ. Mọi công cụ dev.</strong>
</p>

<p align="center">
  Coding agent · workspace · REST · SQL · NoSQL · SSH · file explorer<br/>
  — mọi công cụ trong một khung, mỗi mode có AI riêng được tinh chỉnh.
</p>

<p align="center">
  <a href="README.md">English README</a> ·
  <a href="https://clauge.in">Trang chủ</a> ·
  <a href="https://github.com/ansxuman/Clauge/issues">Báo lỗi</a>
</p>

---

> **Đây là bản fork đã Việt hóa toàn bộ giao diện.** Mọi thuật ngữ kỹ thuật (REST, SQL, MCP, SSH, agent, worktree...) được giữ nguyên vì đó là từ vựng chuẩn của developer Việt Nam. Tên brand/model (Clauge, Claude, GitHub, MongoDB, Redis, Postgres...) cũng giữ nguyên.

---

## Clauge là gì?

Bạn đang phải nhảy qua nhiều ứng dụng để làm cùng một việc. Clauge gộp tất cả vào một khung — coding agent, API client, editor SQL/NoSQL, phiên SSH, trình duyệt tệp từ xa, và một workspace dự án — và cho mỗi mode một AI riêng được điều chỉnh cho workflow đó. Mọi mode chỉ cách một phím tắt. Dữ liệu của bạn nằm trên máy bạn.

---

## Các Mode

| | Mode | Chức năng | Khả năng chính |
|---|---|---|---|
| `01` | **Agent** | Chạy nhiều coding agent song song — mỗi agent có mục đích, git worktree và bối cảnh riêng. | Claude · Codex · Gemini · OpenCode · phiên gắn mục đích · Trình quản lý bối cảnh · Trình quản lý plugin · git identity riêng từng phiên · phân tích sử dụng |
| `02` | **Workspace** | Bảng kanban + ghi chú mà agent có thể đọc, viết và thao tác. | Bảng Kanban · ghi chú markdown · đồng nghiệp AI · nhập issue GitHub & GitLab · tích hợp đầy đủ MCP |
| `03` | **REST** | API client mà AI — và mọi agent ngoài — có thể điều khiển. | Collection · môi trường · runner AI hàng loạt · lộ qua MCP (agent tạo/đọc/sửa/xóa collection và request) |
| `04` | **SQL** | Một client cho mọi engine. | PostgreSQL · MySQL · ClickHouse · SQLite · Cloudflare D1 · AI hiểu schema · dịch chéo dialect · dùng chung SSH tunnel |
| `05` | **NoSQL** | Document store và key-value, song song. | MongoDB · Redis · trình dựng aggregation pipeline · console Redis tương tác · AI nhận diện engine |
| `06` | **SSH** | Terminal có AI co-pilot. | Profile · nhiều tab cho cùng một host · port forwarding · credential lưu trong keychain · **2 chế độ AI**: cần xác nhận và tự động |
| `07` | **Explorer** | Mọi storage trong một trình duyệt. | FS cục bộ · S3 (và S3-compatible) · Azure Blob · SFTP · FTP · kéo-thả truyền tệp · quét bằng AI |

Cộng thêm lớp **History** xuyên mode — log có thể truy vấn cho mọi phiên, request, query và lệnh trên các mode.

---

## Yêu cầu hệ thống

- **OS**: Windows 10/11, macOS 11+, hoặc Linux (Ubuntu 22.04+, Fedora 38+, Arch...)
- **RAM**: tối thiểu 4 GB (khuyến nghị 8 GB)
- **Đĩa**: ~100 MB cho app + dữ liệu

### Để build từ source

- **Rust** (≥ 1.75) — cài qua [rustup](https://rustup.rs/)
- **Bun** (≥ 1.0) — cài qua [bun.sh](https://bun.sh/) (hoặc dùng `npm`/`pnpm`)
- **Node.js** (≥ 18) — cần cho một số script
- **Tauri prerequisites** theo OS:
  - **Windows**: Microsoft Edge WebView2 (đã có sẵn từ Win 11)
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: `webkit2gtk-4.1`, `libsoup-3.0`, `libssl-dev`, `librsvg2-dev`

Xem hướng dẫn chi tiết tại [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/).

---

## Hướng dẫn chạy thử

### Bước 1 — Clone repository

```bash
git clone https://github.com/<your-user>/Clauge.git
cd Clauge
```

### Bước 2 — Cài đặt dependency

```bash
bun install
```

> Nếu chưa có Bun, dùng `npm install` hoặc `pnpm install` cũng được.

### Bước 3 — Chạy chế độ dev

```bash
bun run tauri dev
```

- Frontend Svelte chạy trên `http://localhost:1420`
- Cửa sổ desktop Tauri sẽ tự mở
- Hot reload hoạt động cho cả frontend và backend Rust

### Bước 4 — Build bản release

```bash
bun run tauri build
```

Kết quả nằm trong:
- **Windows**: `src-tauri/target/release/bundle/msi/*.msi` và `nsis/*.exe`
- **macOS**: `src-tauri/target/release/bundle/dmg/*.dmg`
- **Linux**: `src-tauri/target/release/bundle/{deb,appimage,rpm}/`

### Bước 5 — Kiểm tra type-check (tuỳ chọn)

```bash
bun run check
```

Lệnh này chạy `svelte-check` để xác nhận TypeScript không có lỗi.

---

## Các script khác

| Lệnh | Mô tả |
|---|---|
| `bun run dev` | Chỉ chạy Vite dev server (không có Tauri) |
| `bun run build` | Build frontend Svelte |
| `bun run preview` | Preview bản build frontend |
| `bun run check` | Type-check toàn bộ codebase |
| `bun run check:watch` | Type-check ở chế độ watch |
| `bun run tauri dev` | Chạy app desktop ở chế độ phát triển |
| `bun run tauri build` | Build app desktop bản release |

---

## Cấu hình ban đầu

Khi mở app lần đầu, bạn sẽ thấy màn hình **Onboarding**. Có 2 lựa chọn:

1. **Đăng nhập với GitHub/Google** — đồng bộ đám mây tuỳ chọn (collection, profile, ngữ cảnh agent...). Không bao giờ đồng bộ credential nhạy cảm trừ khi bạn bật riêng.
2. **Tiếp tục mà không đăng nhập** — mọi dữ liệu chỉ nằm trên máy này. Có thể đăng nhập sau qua **Cài đặt → Tài khoản**.

### Thiết lập AI Provider

Vào **Cài đặt → AI Providers** rồi chọn:

- **Tự cung cấp khóa (BYOK)** — dán API key của Anthropic, OpenAI, Google, hoặc OpenCode. Clauge gọi trực tiếp tới provider, không qua trung gian.
- **Clauge AI credits** — đăng ký gói Pro để dùng credit Clauge quản lý cho mọi mode và mọi provider.

### Cài đặt CLI Agent (cho mode Agent)

Mode Agent cần CLI tương ứng có trên `PATH`:

| Provider | Lệnh cài (macOS) | Lệnh cài (Windows) | Lệnh cài (Linux) |
|---|---|---|---|
| **Claude Code** | `brew install --cask claude-code` | `winget install Anthropic.ClaudeCode` | `curl -fsSL https://claude.ai/install.sh \| bash` |
| **Codex CLI** | `brew install --cask codex` | `npm install -g @openai/codex` | `npm install -g @openai/codex` |
| **Gemini CLI** | `brew install gemini-cli` | `npm install -g @google/gemini-cli` | `npm install -g @google/gemini-cli` |
| **OpenCode** | `brew install anomalyco/tap/opencode` | `scoop install opencode` | `curl -fsSL https://opencode.ai/install \| bash` |

Sau khi cài, **khởi động lại Clauge** để app cập nhật `PATH`.

### Cài đặt CLI cho Workspace (tuỳ chọn)

Để đẩy/kéo issue và mở PR từ workspace:

| CLI | Lệnh cài |
|---|---|
| **GitHub CLI (`gh`)** | `brew install gh` / `winget install GitHub.cli` / `sudo apt install gh` |
| **GitLab CLI (`glab`)** | `brew install glab` / `winget install gitlab.cli` / `sudo apt install glab` |

Sau khi cài, đăng nhập một lần: `gh auth login` hoặc `glab auth login`.

---

## Phím tắt

| Phím | Hành động |
|---|---|
| `Ctrl/Cmd + 1…9` | Chuyển sang tab thứ N |
| `Ctrl/Cmd + Shift + 1…8` | Chuyển mode (Agent · Workspace · REST · SQL · NoSQL · SSH · Explorer · History) |
| `Ctrl/Cmd + T` | Tab mới (mode hiện tại) |
| `Ctrl/Cmd + W` | Đóng tab đang mở |
| `Ctrl/Cmd + Enter` | Gửi request / Chạy truy vấn |
| `Ctrl/Cmd + S` | Lưu request / truy vấn hiện tại |
| `Ctrl/Cmd + B` | Bật/tắt panel điều hướng |
| `Ctrl/Cmd + L` | Bật/tắt panel AI · trong Agent: panel shell |
| `Ctrl/Cmd + /` hoặc `?` | Hiện danh sách phím tắt |
| `Escape` | Đóng modal / overlay |

---

## MCP Server

Clauge có sẵn MCP server với **45+ tools** — `boards_*`, `cards_*`, `notes_*`, `rest_collection_*`, `coworkers_*`, `workspace_*`, `activity_feed`, và `cards_call_coworker`. Server **tự khởi động khi mở app** — không cần flag, không cần setup.

### Kết nối từ Claude Desktop

Thêm vào `claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "clauge": {
      "command": "clauge",
      "args": ["mcp", "serve", "--stdio"]
    }
  }
}
```

### Kết nối từ Cursor / Cline / Continue

Trỏ MCP client tới process Clauge cục bộ (`stdio` hoặc `http://localhost:7421/mcp`).

---

## Cấu trúc dự án

```
Clauge/
├── src/                    # Frontend SvelteKit
│   ├── lib/
│   │   ├── components/    # UI dùng chung (settings, sidebar, topbar, nav...)
│   │   ├── modes/         # 7 mode chính (agent, workspace, rest, sql...)
│   │   ├── shared/        # Primitives, stores, theme
│   │   ├── stores/        # Svelte store toàn cục
│   │   └── utils/         # Helper TypeScript
│   └── routes/            # Route SvelteKit (chỉ +layout & +page)
├── src-tauri/             # Backend Rust (Tauri v2)
│   ├── src/
│   │   ├── modes/         # Logic backend cho từng mode
│   │   ├── shared/        # Module dùng chung
│   │   ├── db/            # SQLite + migration
│   │   └── lib.rs
│   └── tauri.conf.json
├── static/                # Asset tĩnh (icon, font)
└── package.json
```

---

## Khắc phục sự cố

### Build Rust thất bại trên Linux

Cài đủ system dependency:

```bash
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Tauri báo "WebView2 not found" trên Windows

Tải [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) rồi cài.

### App không tìm thấy CLI agent (`claude not found`)

- Kiểm tra `claude --version` chạy được trong terminal
- Khởi động lại Clauge sau khi cài để app đọc lại `PATH`
- Hoặc vào **Cài đặt → Agent** rồi nhập đường dẫn binary thủ công

### `bun install` fail vì lỗi network

Thử dùng mirror npm:

```bash
bun install --registry https://registry.npmmirror.com
```

Hoặc dùng `npm install` thay thế.

---

## Đóng góp

Repo này là fork đã Việt hóa từ [ansxuman/Clauge](https://github.com/ansxuman/Clauge).

- Báo lỗi tại [Issues](https://github.com/ansxuman/Clauge/issues) (bản gốc)
- Đóng góp PR cần ký [Contributor License Agreement (CLA)](CLA.md)

---

## License

Dự án theo giấy phép [PolyForm Noncommercial 1.0.0](LICENSE) — miễn phí cho cá nhân và sử dụng phi thương mại.

---

## Built with

- **Frontend** — SvelteKit + Svelte 5
- **Native shell** — Tauri v2 (Rust)
- **Persistence** — SQLite (cục bộ), tuỳ chọn đồng bộ đám mây có mã hóa
- **Terminal** — `xterm.js` + PTY đa nền tảng
- **MCP** — JSON-RPC server tích hợp, transport stdio và HTTP
