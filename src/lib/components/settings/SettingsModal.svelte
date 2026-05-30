<script lang="ts">
    import ConfirmDialog from "$lib/shared/primitives/ConfirmDialog.svelte";
    import ClaugeAIBalance from "$lib/components/settings/ClaugeAIBalance.svelte";
    import { invoke } from "@tauri-apps/api/core";
    import { cloudPlan, cloudSub, upgradeModalOpen } from "$lib/stores/cloud";
    import AccountTabContent from "$lib/components/settings/AccountTabContent.svelte";
    import { getVersion } from "@tauri-apps/api/app";
    import {
        tabs as sharedTabs,
        activeTabId,
        updateTab,
    } from "$lib/shared/stores/tabs";
    import {
        clearAllChatMessages,
        countAllChatMessages,
        chatHistorySizeBytes,
        purgeOldChatMessages,
    } from "$lib/stores/app";
    import {
        clearHistory as clearRestHistory,
        retentionSeconds,
        DEFAULT_CHAT_RETENTION,
    } from "$lib/modes/rest/stores";
    import {
        countHistory,
        purgeHistory,
        restHistorySizeBytes,
    } from "$lib/modes/rest/commands";
    import {
        workspaceMcpStatus,
        workspaceMcpStart,
        workspaceMcpStop,
        workspaceMcpRegister,
        workspaceMcpUnregister,
        workspaceMcpNewToken,
        type McpStatus,
    } from "$lib/modes/workspace/commands";
    import { mcpStatus as mcpStatusStore } from "$lib/modes/workspace/stores";
    import {
        settings,
        setSetting,
        appearance,
        saveAppearance,
    } from "$lib/stores/settings";
    import { applyTheme, getThemes, getTheme } from "$lib/utils/theme";
    import { showToast } from "$lib/shared/primitives/toast";
  import { errorToast, friendlyError } from '$lib/utils/errors';
    import type { AppearanceConfig } from "$lib/types";
    import {
        testAiKey,
        getAiUsageStats,
        getAiProviderStats,
        resetAiUsage,
    } from "$lib/commands/ai";
    import type { AiUsageStat, AiProviderStat } from "$lib/types/ai";
    import {
        agentGetPlugins,
        agentTogglePlugin,
        agentUninstallPlugin,
        agentGetMarketplacePlugins,
        agentInstallPlugin,
        agentListContexts,
        agentSaveContext,
        agentDeleteContext,
        agentFetchUsageLimits,
        agentFetchCodexUsageLimits,
        agentGetUsageAnalytics,
    } from "$lib/modes/agent/commands";
    import type {
        ClaudePlugin,
        MarketplacePlugin,
        AgentContext,
        UsageAnalytics,
    } from "$lib/modes/agent/types";
    import {
        agentUsageLimits,
        agentUsageAuthStatus,
        agentSessionKey as agentSessionKeyStore,
        agentCodexToken as agentCodexTokenStore,
        agentFooterProvider as agentFooterProviderStore,
        loadAgentUsageLimits,
    } from "$lib/modes/agent/stores";
    import {
        ACCENT_PALETTE,
        THEME_PREVIEW_COLORS,
        FALLBACK_ACCENT_COLOR,
        USAGE_DANGER,
        USAGE_WARN,
    } from "$lib/shared/constants/colors";
    import {
        PROVIDERS as AI_PROVIDER_REGISTRY,
        getDefaultModelFor,
        type ProviderId,
    } from "$lib/shared/ai/providers";
    import { isMac, mod } from "$lib/utils/platform";

    // 'general' is app-wide (currently: Proxy — applies to REST + AI + GitHub
    // + Updater + ClickHouse). 'rest' holds REST-only knobs (timeout, redirects,
    // SSL verify, max body).
    type SettingsTab =
        | "account"
        | "general"
        | "appearance"
        | "shortcuts"
        | "ai"
        | "rest"
        | "agent"
        | "workspace"
        | "sql"
        | "nosql"
        | "explorer"
        | "about";

    let activeTab = $state<SettingsTab>("general");
    let appVersion = $state("");

    getVersion()
        .then((v) => {
            appVersion = v;
        })
        .catch(() => {
            appVersion = "";
        });

    // Settings is now a topbar tab (mode: 'settings'). Visibility +
    // initial sub-tab are derived from the active tab; callers open it
    // via `openSettingsTab(subKey)` which sets tab.key.
    const settingsTab = $derived(
        $sharedTabs.find((t) => t.id === $activeTabId && t.mode === "settings"),
    );
    let show = $derived(!!settingsTab);

    $effect(() => {
        const key = settingsTab?.key ?? null;
        if (!key) return;
        // Map sub-key → activeTab + (optional) agentSubTab. Mirrors the
        // legacy `activeModal === 'settings:*'` mapping but flattened
        // (the 'settings:' prefix is implicit now).
        if (key === "account") activeTab = "account";
        else if (key === "general") activeTab = "general";
        else if (key === "appearance") activeTab = "appearance";
        else if (key === "shortcuts") activeTab = "shortcuts";
        else if (key === "ai") activeTab = "ai";
        else if (key === "ai:byok") {
            activeTab = "ai";
            aiTopTab = "byok";
        } else if (key === "ai:clauge") {
            activeTab = "ai";
            aiTopTab = "clauge";
        }
        else if (key === "rest") activeTab = "rest";
        else if (key === "agent") activeTab = "agent";
        else if (key === "agent:usage") {
            activeTab = "agent";
            agentSubTab = "usage";
        } else if (key === "agent:contexts") {
            activeTab = "agent";
            agentSubTab = "contexts";
        } else if (key === "agent:plugins") {
            activeTab = "agent";
            agentSubTab = "plugins";
        } else if (key === "workspace") activeTab = "workspace";
        else if (key === "sql") activeTab = "sql";
        else if (key === "nosql") activeTab = "nosql";
        else if (key === "explorer") activeTab = "explorer";
        else if (key === "about") activeTab = "about";
    });

    // --- General ---
    let timeout = $derived(Number($settings["request_timeout"] ?? "30000"));
    let followRedirects = $derived(
        ($settings["follow_redirects"] ?? "true") === "true",
    );
    let sslVerification = $derived(
        ($settings["ssl_verification"] ?? "true") === "true",
    );
    let maxResponseSize = $derived(
        Number($settings["max_response_size"] ?? "10"),
    );

    // --- SQL ---
    // Defaults match the previously-hardcoded values in
    // `src-tauri/src/modes/sql/{client,d1_client,clickhouse_client}.rs`
    // and `modes/sql/ai_tools.rs`. Changes apply to NEW connections /
    // queries — already-open pools keep their old timeouts until
    // reconnect.
    let sqlAcquireTimeoutMs = $derived(
        Number($settings["sql_acquire_timeout_ms"] ?? "10000"),
    );
    let sqlIdleTimeoutMin = $derived(
        Number($settings["sql_idle_timeout_min"] ?? "30"),
    );
    let sqlHttpQueryTimeoutSec = $derived(
        Number($settings["sql_http_query_timeout_sec"] ?? "60"),
    );
    let sqlTableListLimit = $derived(
        Number($settings["sql_table_list_limit"] ?? "200"),
    );

    // --- NoSQL ---
    // Defaults match Mongo client config in
    // `src-tauri/src/modes/nosql/client.rs` + the AI-tool find caps in
    // `modes/nosql/ai_tools.rs`.
    let nosqlServerSelectionTimeoutMs = $derived(
        Number($settings["nosql_server_selection_timeout_ms"] ?? "10000"),
    );
    let nosqlConnectTimeoutMs = $derived(
        Number($settings["nosql_connect_timeout_ms"] ?? "10000"),
    );
    let nosqlDefaultFindLimit = $derived(
        Number($settings["nosql_default_find_limit"] ?? "50"),
    );
    let nosqlMaxFindLimit = $derived(
        Number($settings["nosql_max_find_limit"] ?? "100"),
    );

    // --- Explorer ---
    // S3/Azure folder listings can recursively walk every subfolder to
    // compute aggregate folder sizes. On large buckets this slows
    // navigation from sub-second to multi-second. Default OFF; the user
    // opts in when accurate sizes matter more than latency. Backend
    // reads on session open, so changes apply on next reconnect.
    let explorerShowFolderSizes = $derived(
        ($settings["explorer_show_folder_sizes"] ?? "false") === "true",
    );

    // --- Editor ---

    // --- Proxy ---
    let proxyUrl = $derived($settings["proxy_url"] ?? "");
    let proxyAuth = $derived(($settings["proxy_auth"] ?? "false") === "true");
    let proxyUsername = $derived($settings["proxy_username"] ?? "");
    let proxyPassword = $derived($settings["proxy_password"] ?? "");

    // --- Privacy / telemetry ---
    // Telemetry is opt-IN by default (false === sending). The toggle
    // below flips `telemetry_optout`; UI label is positive ("Share
    // anonymous usage data") so the checkbox feels intuitive.
    let telemetryOptedOut = $derived(
        ($settings["telemetry_optout"] ?? "false") === "true",
    );

    // --- Logs ---
    let logDir = $state("");

    $effect(() => {
        if (activeTab === "general" && !logDir) {
            import("$lib/commands/logs").then(({ getLogDir }) =>
                getLogDir()
                    .then((p) => {
                        logDir = p;
                    })
                    .catch(() => {}),
            );
        }
    });

    async function handleOpenLogFolder() {
        try {
            const { openLogFolder } = await import("$lib/commands/logs");
            await openLogFolder();
        } catch {
            showToast("Không thể mở thư mục log", "error");
        }
    }

    // --- Chat History (General) ---
    // Combined retention + size + clear for REST request history (DB) AND
    // AI Assistance chat history (per-mode, localStorage).
    let chatRetention = $derived(
        ($settings["chat_history_retention"] ??
            DEFAULT_CHAT_RETENTION) as string,
    );
    let restHistoryCount = $state<number>(0);
    let aiChatCount = $state<number>(0);
    let aiChatBytes = $state<number>(0);
    let restHistoryBytes = $state<number>(0);
    let showClearChatHistoryConfirm = $state(false);
    /** Combined storage = AI chat localStorage + REST history DB bytes.
     *  Before this was just AI chat, which made the "Storage" stat
     *  understate the real footprint by ignoring the (now-metadata-only)
     *  REST history table. */
    let totalStorageBytes = $derived(aiChatBytes + restHistoryBytes);

    async function refreshHistorySizes() {
        try {
            restHistoryCount = await countHistory();
        } catch {
            restHistoryCount = 0;
        }
        try {
            restHistoryBytes = await restHistorySizeBytes();
        } catch {
            restHistoryBytes = 0;
        }
        aiChatCount = countAllChatMessages();
        aiChatBytes = chatHistorySizeBytes();
    }

    // Refresh sizes whenever the General tab becomes visible (cheap; one COUNT(*)).
    $effect(() => {
        if (activeTab === "general" && show) {
            refreshHistorySizes();
        }
    });

    function formatBytes(bytes: number): string {
        if (!bytes) return "0 B";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    async function handleChatRetentionChange(value: string) {
        await setSetting("chat_history_retention", value);
        // Apply immediately: purge anything beyond the new window so the size
        // reflects the user's choice without waiting for the next app load.
        const seconds = retentionSeconds(value);
        if (seconds !== null) {
            try {
                await purgeHistory(seconds);
            } catch {
                /* non-fatal */
            }
            purgeOldChatMessages(seconds * 1000);
        }
        await refreshHistorySizes();
    }

    async function handleClearChatHistory() {
        try {
            await clearRestHistory();
            clearAllChatMessages();
            await refreshHistorySizes();
            showToast("Đã xóa lịch sử", "success");
        } catch {
            showToast("Không thể xóa lịch sử", "error");
        }
    }

    // ── Workspace MCP server ───────────────────────────────────────────
    // Settings keys: workspace_mcp_port (default 7421), workspace_mcp_token
    // (auto-generated). On enable: start server + write to ~/.claude
    // /settings.json. On disable: stop + remove our entry. The token
    // is regenerable from the UI when the server is stopped.
    let mcpStatus = $state<McpStatus>({ running: false, port: null });
    let mcpPort = $derived(
        Number($settings["workspace_mcp_port"] ?? "7421") || 7421,
    );
    let mcpToken = $derived(($settings["workspace_mcp_token"] ?? "") as string);
    let showMcpToken = $state(false);

    // Auto-move-on-PR-merge toggle. Default ON — the feature is
    // self-disabling for boards whose final column doesn't match the
    // regex, so leaving it on is safe; this toggle is for users who
    // want manual control even on boards that DO match.
    let autoMoveMergedPrs = $derived(
        ($settings["workspace_automove_merged_prs"] ?? "true") === "true",
    );

    async function refreshMcpStatus() {
        try {
            mcpStatus = await workspaceMcpStatus();
            mcpStatusStore.set(mcpStatus);
        } catch {
            /* ignore */
        }
    }

    /** Lazy-init token + load status when the Workspace tab opens.
     *  The Rust setup() task auto-starts the server on app boot, so
     *  by the time this fires we usually just refresh status. The
     *  token-init branch only matters for legacy installs that
     *  somehow wound up without one. */
    $effect(() => {
        if (activeTab === "workspace" && show) {
            refreshMcpStatus();
            if (!mcpToken) {
                workspaceMcpNewToken(mcpPort).catch(() => {});
            }
        }
    });

    async function handleMcpToggle(next: boolean) {
        try {
            if (next) {
                let token = mcpToken;
                if (!token) {
                    // workspaceMcpNewToken persists the value internally.
                    token = await workspaceMcpNewToken(mcpPort);
                }
                await setSetting("workspace_mcp_port", String(mcpPort));
                mcpStatus = await workspaceMcpStart(mcpPort, token);
                mcpStatusStore.set(mcpStatus);
                await workspaceMcpRegister(mcpStatus.port ?? mcpPort, token);
                // Persist the desire — drives auto-start on next app boot.
                await setSetting("workspace_mcp_enabled", "true");
                showToast(
                    `MCP server đang chạy trên :${mcpStatus.port}`,
                    "success",
                );
            } else {
                mcpStatus = await workspaceMcpStop();
                mcpStatusStore.set(mcpStatus);
                await workspaceMcpUnregister();
                await setSetting("workspace_mcp_enabled", "false");
                showToast("MCP server đã dừng", "success");
            }
        } catch (e) {
            errorToast('Chuyển đổi MCP thất bại', e);
            await refreshMcpStatus();
        }
    }

    async function handleRotateMcpToken() {
        try {
            // workspaceMcpNewToken atomically: generates a new token,
            // persists it, and rewrites ~/.claude.json if an entry
            // exists. Server restart isn't required — the running
            // instance still uses the old token until next start, but
            // ~/.claude.json is back in sync with whatever's persisted
            // for the next start cycle.
            await workspaceMcpNewToken(mcpStatus.port ?? mcpPort);
            if (mcpStatus.running) {
                showToast(
                    "Đã xoay token. Khởi động lại server (tắt + bật) để token mới có hiệu lực.",
                    "success",
                );
            } else {
                showToast("Đã xoay token", "success");
            }
        } catch (e) {
            errorToast('Xoay token thất bại', e);
        }
    }

    async function handleCopyMcpToken() {
        try {
            await navigator.clipboard.writeText(mcpToken);
            showToast("Đã sao chép token", "success");
        } catch {
            /* ignore */
        }
    }

    // AI Assistance state
    let aiTopTab = $state<"clauge" | "byok">("clauge");
    let aiSubTab = $state<"config" | "usage">("config");

    // Clauge AI usage history — fetched from /api/ai/usage via cloud_ai_usage.
    // Worker returns the most recent entries first; we render the last ~30.
    type CloudAiUsageEntry = {
        occurred_at: string;
        operation: string;
        clauge_credits: number;
        cost_usd_micros: number;
        request_id: string;
        mode: string | null;
    };
    let cloudAiUsage = $state<CloudAiUsageEntry[]>([]);
    let cloudAiUsageLoading = $state(false);
    // Cursor for the next page (oldest visible row's occurred_at). When
    // null we've hit the end of history.
    let cloudAiUsageNextBefore = $state<string | null>(null);
    let cloudAiUsageLoadingMore = $state(false);

    const CLOUD_AI_USAGE_PAGE = 30;

    async function loadCloudAiUsage() {
        cloudAiUsageLoading = true;
        try {
            const r = await invoke<{
                entries: CloudAiUsageEntry[];
                next_before: string | null;
            }>("cloud_ai_usage", { limit: CLOUD_AI_USAGE_PAGE });
            cloudAiUsage = r.entries ?? [];
            cloudAiUsageNextBefore = r.next_before;
        } catch {
            cloudAiUsage = [];
            cloudAiUsageNextBefore = null;
        } finally {
            cloudAiUsageLoading = false;
        }
    }

    // Append the next page when the user scrolls near the bottom of the
    // activity table. Cursor is the oldest row's occurred_at returned by
    // the previous response.
    async function loadMoreCloudAiUsage() {
        if (cloudAiUsageLoadingMore) return;
        if (!cloudAiUsageNextBefore) return;
        cloudAiUsageLoadingMore = true;
        try {
            const r = await invoke<{
                entries: CloudAiUsageEntry[];
                next_before: string | null;
            }>("cloud_ai_usage", {
                limit: CLOUD_AI_USAGE_PAGE,
                before: cloudAiUsageNextBefore,
            });
            if (r.entries?.length) {
                cloudAiUsage = [...cloudAiUsage, ...r.entries];
            }
            cloudAiUsageNextBefore = r.next_before;
        } catch {
            // Silent — keep cursor, user can scroll again to retry.
        } finally {
            cloudAiUsageLoadingMore = false;
        }
    }

    // Fires from the activity table's scroll listener. Trigger ~120px
    // before the bottom so the next page is already loading by the time
    // the user reaches it (no perceptible pause).
    function handleActivityScroll(e: Event) {
        const el = e.currentTarget as HTMLElement;
        if (
            el.scrollHeight - el.scrollTop - el.clientHeight < 120 &&
            cloudAiUsageNextBefore
        ) {
            loadMoreCloudAiUsage();
        }
    }

    function fmtUsageTime(iso: string): string {
        try {
            // The worker writes `occurred_at` via SQLite's CURRENT_TIMESTAMP,
            // which returns "YYYY-MM-DD HH:MM:SS" in UTC but WITHOUT any
            // timezone marker. `new Date(naiveString)` treats it as LOCAL,
            // so non-UTC users saw times shifted by their offset. Normalise
            // the SQLite shape to a proper UTC ISO before parsing; leave
            // already-tagged strings (T+Z, T+offset) alone.
            const isNaiveSqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(
                iso,
            );
            const utcIso = isNaiveSqlite ? iso.replace(" ", "T") + "Z" : iso;
            const d = new Date(utcIso);
            return d.toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
            });
        } catch {
            return iso;
        }
    }

    // Distinct color per mode for the per-mode breakdown bars and the
    // MODE column in the activity table. Only the modes that actually
    // host the AI panel (rest / sql / nosql / ssh / explorer) get colors;
    // anything else falls back to muted grey.
    function modeColor(mode: string | null | undefined): string {
        switch (mode) {
            case "sql":
                return "#8b7bf5";
            case "rest":
                return "#f06b9e";
            case "nosql":
                return "#4ec9ff";
            case "ssh":
                return "#2dd4bf";
            case "explorer":
                return "#f59e0b";
            default:
                return "var(--t3, #888)";
        }
    }
    function capitalizeMode(s: string): string {
        if (!s) return "—";
        if (s === "sql" || s === "rest" || s === "ssh") return s.toUpperCase();
        if (s === "nosql") return "NoSQL";
        return s[0].toUpperCase() + s.slice(1);
    }
    // Per-mode credit totals derived from the loaded usage entries. Sorted
    // descending so the heaviest mode comes first in the bar chart.
    type ModeBreakdown = { mode: string; credits: number; percent: number };
    let cloudAiByMode = $derived.by<ModeBreakdown[]>(() => {
        if (cloudAiUsage.length === 0) return [];
        const totals = new Map<string, number>();
        let grand = 0;
        for (const e of cloudAiUsage) {
            const m = e.mode ?? "other";
            totals.set(m, (totals.get(m) ?? 0) + e.clauge_credits);
            grand += e.clauge_credits;
        }
        if (grand === 0) return [];
        return Array.from(totals.entries())
            .map(([mode, credits]) => ({
                mode,
                credits,
                percent: Math.round((credits / grand) * 100),
            }))
            .sort((a, b) => b.credits - a.credits);
    });
    let aiProvider = $state<string>("claude");
    let aiApiKey = $state("");
    let showAiKey = $state(false);
    let aiTestStatus = $state<"idle" | "testing" | "success" | "error">("idle");
    let aiTestMessage = $state("");
    let aiUsageStats = $state<AiUsageStat[]>([]);
    let aiProviderStats = $state<AiProviderStat[]>([]);
    let showResetConfirm = $state(false);

    // Provider/model metadata is sourced from the shared registry mirror
    // (`$lib/shared/ai/providers`) so this component and the Rust backend
    // stay in lockstep. Adding a provider/model is one entry there, zero
    // edits here.
    const FALLBACK_PROVIDER_CONFIG = AI_PROVIDER_REGISTRY[0];
    let currentProviderConfig = $derived(
        getDefaultModelFor(aiProvider as ProviderId) ??
            FALLBACK_PROVIDER_CONFIG,
    );
    let aiHasKey = $derived(!!$settings[`ai_api_key_${aiProvider}`]?.trim());

    // Every provider that has a saved API key — feeds the "Configured
    // providers" list under the Configuration sub-tab so the user always
    // sees what they've set up.
    let configuredProviders = $derived(
        AI_PROVIDER_REGISTRY.filter(
            (p) => !!$settings[p.keySettingName]?.trim(),
        ),
    );

    // --- Clauge AI balance (worker-tracked managed-AI credits) ---
    let cloudCreditsLocal = $state<{
        remaining: number;
        allowance: number;
        resets_at: string | null;
    } | null>(null);
    let cloudSubLocal = $state<{
        status: string;
        cancel_at_period_end: boolean;
    } | null>(null);

    async function loadCloudBalance() {
        try {
            const bal = await invoke<{
                remaining: number;
                allowance: number;
                resetsAt: string | null;
            }>("cloud_ai_balance");
            cloudCreditsLocal = {
                remaining: bal.remaining,
                allowance: bal.allowance,
                resets_at: bal.resetsAt,
            };
        } catch {
            cloudCreditsLocal = null;
        }
    }

    function handleUpgradeClick() {
        upgradeModalOpen.set(true);
    }

    // --- Appearance ---
    let currentTheme = $derived($appearance.theme || "dark-glass");
    let accentColor = $derived(
        $appearance.accentColor || FALLBACK_ACCENT_COLOR,
    );
    // Pro themes can lock the accent — the picker is disabled and a small
    // note tells the user why. `getTheme()` looks up the theme registry.
    let activeThemeDef = $derived(getTheme(currentTheme));
    let accentLocked = $derived(activeThemeDef?.lockAccent === true);

    // Re-export for template usage (Svelte each blocks resolve from script scope).
    const ACCENT_COLORS = ACCENT_PALETTE;

    const THEME_DESCRIPTIONS: Record<string, string> = {
        "dark-glass": "Trong suốt với hiệu ứng làm mờ",
        "dark-solid": "Tối đặc với sắc tím nhẹ",
        midnight: "Đen tuyền, không phân tâm",
        "rose-pine-dawn": "Kem ấm sáng — chị em với Moon",
        atelier:
            "Hồng phấn + hình nền thực vật — sinh vật pixel lang thang dưới chân",
        hearth: "Than ấm với than hồng bay lên — ánh lửa động",
        petal: "Hoàng hôn mận với cánh hoa anh đào rơi",
        celeste: "Tím vũ trụ với những vì sao lấp lánh",
        nord: "Bảng màu xanh xám Bắc Cực",
        light: "Trắng ngà ấm, dễ chịu cho mắt",
    };

    // Clear any previously saved zoom to prevent cursor issues
    $effect(() => {
        document.body.style.zoom = "";
    });

    // Sidebar items. `kind: 'header'` rows render as a small uppercase
    // section label; `kind: 'tab'` rows are the clickable tabs.
    //
    // `icon` is the inner SVG markup (paths/circles/lines) — rendered with
    // `{@html}` inside a fixed-attr <svg>. The mode icons (Agent / REST /
    // etc.) are kept identical to the main Sidebar so users see the same
    // glyph in both places.
    type TabsItem =
        | { kind: "tab"; key: SettingsTab; label: string; icon: string }
        | { kind: "header"; label: string };

    const tabs: TabsItem[] = [
        {
            kind: "tab",
            key: "account",
            label: "Tài khoản",
            icon: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        },
        {
            kind: "tab",
            key: "general",
            label: "Chung",
            icon: '<path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/>',
        },
        {
            kind: "tab",
            key: "appearance",
            label: "Giao diện",
            icon: '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>',
        },
        {
            kind: "tab",
            key: "shortcuts",
            label: "Phím tắt",
            icon: '<path d="M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z"/>',
        },
        {
            kind: "tab",
            key: "ai",
            label: "Trợ lý AI",
            icon: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
        },
        { kind: "header", label: "Chế độ" },
        // Order + glyphs MUST match the main Sidebar (Agent, REST, ...).
        {
            kind: "tab",
            key: "agent",
            label: "Agent",
            icon: '<path d="M12 3l1.6 4.8L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.2L12 3z"/><path d="M18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z"/>',
        },
        {
            kind: "tab",
            key: "workspace",
            label: "Workspace",
            // 2×2 grid — same identity glyph used in the main Sidebar.
            icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
        },
        {
            kind: "tab",
            key: "rest",
            label: "REST",
            icon: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>',
        },
        {
            kind: "tab",
            key: "sql",
            label: "SQL",
            // DB cylinder — matches the SQL tab icon in Topbar.
            icon: '<ellipse cx="12" cy="5" rx="8" ry="2.5"/><path d="M4 5v14c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5"/><path d="M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5"/>',
        },
        {
            kind: "tab",
            key: "nosql",
            label: "NoSQL",
            // Curly braces — matches NoSQL identity in Topbar.
            icon: '<path d="M8 3a2 2 0 00-2 2v4a2 2 0 01-2 2H3a1 1 0 000 2h1a2 2 0 012 2v4a2 2 0 002 2"/><path d="M16 3a2 2 0 012 2v4a2 2 0 002 2h1a1 1 0 010 2h-1a2 2 0 00-2 2v4a2 2 0 01-2 2"/>',
        },
        {
            kind: "tab",
            key: "explorer",
            label: "Explorer",
            // Folder — matches Explorer identity in Topbar.
            icon: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
        },
        {
            kind: "tab",
            key: "about",
            label: "Giới thiệu",
            icon: '<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>',
        },
    ];

    // Platform-aware shortcut list. `m` = "Cmd" on macOS, "Ctrl" elsewhere.
    // Fullscreen + Minimize differ by OS so they're branched.
    const m = mod();
    const SHORTCUTS: { desc: string; keys: string[] }[] = [
        { desc: "Chuyển sang tab thứ N", keys: [m, "1…9"] },
        {
            desc: "Chuyển chế độ (Agent · Workspace · REST · SQL · NoSQL · SSH · Explorer · History)",
            keys: [m, "Shift", "1…8"],
        },
        { desc: "Tab mới (chế độ hiện tại)", keys: [m, "T"] },
        { desc: "Đóng tab đang hoạt động", keys: [m, "W"] },
        { desc: "Gửi yêu cầu / Chạy truy vấn", keys: [m, "Enter"] },
        { desc: "Lưu yêu cầu / truy vấn hiện tại", keys: [m, "S"] },
        { desc: "Bật/tắt thanh điều hướng", keys: [m, "B"] },
        { desc: "Bật/tắt panel AI · trong Agent: panel shell", keys: [m, "L"] },
        { desc: "Hiển thị overlay phím tắt", keys: [m, "/"] },
        { desc: "Hiển thị overlay phím tắt (ngoài input)", keys: ["?"] },
        { desc: "Đóng modal / overlay", keys: ["Esc"] },
        {
            desc: "Bật/tắt toàn màn hình",
            keys: isMac() ? ["Cmd", "Ctrl", "F"] : ["F11"],
        },
        ...(isMac() ? [{ desc: "Thu nhỏ cửa sổ", keys: ["Cmd", "M"] }] : []),
    ];

    async function handleSettingChange(key: string, value: string) {
        await setSetting(key, value);
        // Sync the matching agent-mode store and refresh the footer
        // chip whenever a usage-tracking setting changes.
        if (key === "agent_session_key") {
            agentSessionKeyStore.set(value);
            if (value) {
                loadAgentUsageLimits();
            } else {
                agentUsageLimits.set(null);
                agentUsageAuthStatus.set({
                    state: "unconfigured",
                    message: "",
                });
            }
        } else if (key === "agent_codex_access_token") {
            agentCodexTokenStore.set(value);
            if (value) {
                loadAgentUsageLimits();
            } else {
                agentUsageLimits.set(null);
                agentUsageAuthStatus.set({
                    state: "unconfigured",
                    message: "",
                });
            }
        } else if (key === "agent_footer_usage_provider") {
            if (
                value === "claude" ||
                value === "codex" ||
                value === "gemini" ||
                value === "opencode"
            ) {
                agentFooterProviderStore.set(value);
            }
            // Provider switch — clear stale chip state and re-fetch using
            // the new provider. The dispatcher in loadAgentUsageLimits
            // handles the unconfigured case.
            agentUsageLimits.set(null);
            agentUsageAuthStatus.set({ state: "unconfigured", message: "" });
            loadAgentUsageLimits();
        }
    }

    // Theme preview state for free users. When non-null, a pro theme is
    // being previewed DOM-only (not persisted). previewOriginalTheme is
    // the saved theme we revert to on cancel / close / tab-leave.
    let previewThemeId = $state<string | null>(null);
    let previewOriginalTheme = $state<string | null>(null);

    // What the picker should highlight as active — the previewed theme
    // if one is being tried, else the actually-saved theme.
    let displayTheme = $derived(previewThemeId ?? currentTheme);

    async function handleThemeChange(themeId: string) {
        const themeDef = getTheme(themeId);
        const isPremium = !!themeDef?.premium;
        const isFreeUser = $cloudPlan !== "pro";

        if (isPremium && isFreeUser) {
            // Enter / swap preview mode. Apply DOM-only — do NOT persist.
            if (previewOriginalTheme === null) {
                previewOriginalTheme = currentTheme;
            }
            previewThemeId = themeId;
            applyTheme(themeId, accentColor);
            return;
        }

        // Non-premium pick OR pro user: drop any active preview and persist.
        if (previewThemeId !== null) {
            previewThemeId = null;
            previewOriginalTheme = null;
        }
        applyTheme(themeId, accentColor);
        const config: AppearanceConfig = {
            theme: themeId,
            accentColor: accentColor,
        };
        appearance.set(config);
        await saveAppearance(config);
    }

    // User clicked Cancel in the preview banner — revert to their saved
    // theme and exit preview.
    function cancelThemePreview() {
        if (previewOriginalTheme === null) return;
        applyTheme(previewOriginalTheme, accentColor);
        previewThemeId = null;
        previewOriginalTheme = null;
    }

    // User clicked Upgrade in the preview banner — open the upgrade
    // modal. The plan-flip $effect below handles auto-finalize if the
    // upgrade succeeds; if they dismiss the modal we keep the preview
    // active so they can see it and choose Cancel.
    function upgradeFromThemePreview() {
        upgradeModalOpen.set(true);
    }

    // Auto-revert preview when the user navigates away from Appearance or
    // closes the Settings modal entirely — otherwise they'd return to a
    // pro theme they never actually own.
    $effect(() => {
        if (previewThemeId === null) return;
        if (!show || activeTab !== "appearance") {
            cancelThemePreview();
        }
    });

    // If the user successfully upgrades while a preview is showing, save
    // the previewed theme as their real choice and exit preview mode.
    $effect(() => {
        if (previewThemeId === null) return;
        if ($cloudPlan === "pro") {
            const themeId = previewThemeId;
            previewThemeId = null;
            previewOriginalTheme = null;
            const config: AppearanceConfig = {
                theme: themeId,
                accentColor: accentColor,
            };
            appearance.set(config);
            saveAppearance(config).catch(() => {});
        }
    });

    async function handleAccentChange(color: string) {
        document.documentElement.style.setProperty("--acc", color);
        const config: AppearanceConfig = {
            theme: currentTheme,
            accentColor: color,
        };
        appearance.set(config);
        await saveAppearance(config);
    }

    function handleClose() {
        activeTab = "general";
    }

    async function loadAiSettings() {
        const s = $settings;
        aiProvider = s["ai_provider"] || "claude";
        // Load key for current provider (fallback to legacy ai_api_key for claude)
        aiApiKey = s[`ai_api_key_${aiProvider}`] || "";
        try {
            aiUsageStats = await getAiUsageStats();
            aiProviderStats = await getAiProviderStats();
        } catch {
            aiUsageStats = [];
            aiProviderStats = [];
        }
    }

    async function handleSaveAiKey() {
        const key = aiApiKey.trim();
        if (!key) {
            showToast("Vui lòng nhập API Key trước", "error");
            return;
        }
        aiTestStatus = "testing";
        aiTestMessage = "";
        try {
            const msg = await testAiKey(key, aiProvider);
            aiTestStatus = "success";
            aiTestMessage = msg;
            await handleSettingChange(`ai_api_key_${aiProvider}`, key);
            await handleSettingChange("ai_provider", aiProvider);
            // Also save to legacy key for backward compat
            if (aiProvider === "claude") {
                // Legacy key no longer used — per-provider keys only
            }
            showToast("Đã xác minh và lưu API Key", "success");
        } catch (e: any) {
            aiTestStatus = "error";
            aiTestMessage =
                typeof e === "string" ? e : e.message || "Kiểm tra thất bại";
            showToast("API Key không hợp lệ — chưa lưu", "error");
        }
    }

    async function handleProviderChange(provider: string) {
        aiProvider = provider;
        await handleSettingChange("ai_provider", provider);
        // Load the key for this provider
        const s = $settings;
        aiApiKey = s[`ai_api_key_${provider}`] || "";
        aiTestStatus = "idle";
        aiTestMessage = "";
    }

    async function handleRemoveAiKey() {
        await handleSettingChange(`ai_api_key_${aiProvider}`, "");
        if (aiProvider === "claude") {
            // Legacy key no longer used
        }
        aiApiKey = "";
        aiTestStatus = "idle";
        aiTestMessage = "";
        showToast("Đã xóa API Key", "success");
    }

    async function handleResetUsage() {
        try {
            await resetAiUsage();
            aiUsageStats = [];
            showResetConfirm = false;
            showToast("Đã đặt lại thống kê sử dụng", "success");
        } catch {
            showToast("Không thể đặt lại thống kê", "error");
        }
    }

    function formatTokens(n: number): string {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
        if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
        return n.toString();
    }

    function estimateCost(inputTokens: number, outputTokens: number): string {
        const cost =
            (inputTokens / 1_000_000) * 1.0 + (outputTokens / 1_000_000) * 5.0;
        if (cost < 0.01) return "<$0.01";
        return "$" + cost.toFixed(2);
    }

    function formatModelName(model: string): string {
        const names: Record<string, string> = {
            "claude-haiku-4-5-20251001": "Haiku 4.5",
            "claude-sonnet-4-6-20250514": "Sonnet 4.6",
            "claude-opus-4-7-20250514": "Opus 4.7",
            "llama-3.3-70b-versatile": "Llama 3.3 70B",
            "meta-llama/llama-4-scout-17b-16e-instruct": "Llama 4 Scout 17B",
            "mistral-small-latest": "Mistral Small",
            "mistral-large-latest": "Mistral Large 3",
            "gpt-4.1-mini": "GPT-4.1 Mini",
            "nvidia/nemotron-3-super-120b-a12b": "Nemotron 3 Super 120B",
            "meta-llama/llama-3.3-70b-instruct:free": "Llama 3.3 70B",
            "gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite",
            "qwen/qwen3-32b": "Qwen3 32B",
        };
        return names[model] || model;
    }

    let aiSettingsLoaded = false;
    $effect(() => {
        if (activeTab === "ai" && show && !aiSettingsLoaded) {
            aiSettingsLoaded = true;
            loadAiSettings();
            loadCloudBalance();
            loadCloudAiUsage();
        }
        if (!show) {
            aiSettingsLoaded = false;
        }
    });

    // --- Agent Tab ---
    type AgentSubTab = "general" | "plugins" | "contexts" | "usage";
    let agentSubTab = $state<AgentSubTab>("general");

    // Agent General
    let agentSessionKey = $derived($settings["agent_session_key"] ?? "");
    let agentCodexToken = $derived($settings["agent_codex_access_token"] ?? "");
    let agentFooterProvider = $derived(
        $settings["agent_footer_usage_provider"] ?? "claude",
    );
    let agentSoundEnabled = $derived(
        ($settings["agent_sound_enabled"] ?? "true") === "true",
    );
    let agentDockBounceEnabled = $derived(
        ($settings["agent_dock_bounce_enabled"] ?? "true") === "true",
    );
    let agentRefreshMins = $derived(
        Number($settings["agent_refresh_mins"] ?? "5"),
    );

    // Agent key management
    let agentKeyInput = $state("");
    let showAgentKey = $state(false);
    let agentKeyTestStatus = $state<"idle" | "testing" | "success" | "error">(
        "idle",
    );
    let agentKeyTestMessage = $state("");
    let codexTokenInput = $state("");
    let showCodexToken = $state(false);
    let codexTokenTestStatus = $state<"idle" | "testing" | "success" | "error">(
        "idle",
    );
    let codexTokenTestMessage = $state("");

    // Agent Usage Stats
    let agentUsageData = $state<UsageAnalytics | null>(null);
    let agentUsageLoading = $state(false);
    let agentUsageDays = $state(7);

    const REFRESH_OPTIONS = [
        { value: 5, label: "5 phút" },
        { value: 15, label: "15 phút" },
        { value: 30, label: "30 phút" },
        { value: 60, label: "1 giờ" },
    ];

    function agentLiveColor(pct: number): string {
        if (pct > 80) return USAGE_DANGER;
        if (pct > 50) return USAGE_WARN;
        return "var(--acc)";
    }

    function agentFormatCost(n: number) {
        return n < 0.01 && n > 0 ? "<$0.01" : "$" + n.toFixed(2);
    }
    function agentFormatTokens(n: number) {
        return n >= 1_000_000
            ? (n / 1_000_000).toFixed(1) + "M"
            : n >= 1_000
              ? (n / 1_000).toFixed(1) + "K"
              : String(n);
    }
    function agentDecodeName(s: string) {
        return s.replace(/-/g, "/");
    }

    async function handleSaveAgentKey() {
        const key = agentKeyInput.trim();
        if (!key) {
            showToast("Vui lòng nhập session key trước", "error");
            return;
        }
        agentKeyTestStatus = "testing";
        agentKeyTestMessage = "";
        try {
            await agentFetchUsageLimits(key);
            agentKeyTestStatus = "success";
            agentKeyTestMessage = "Đã xác minh session key";
            await handleSettingChange("agent_session_key", key);
            showToast("Đã xác minh và lưu session key", "success");
        } catch (e: any) {
            agentKeyTestStatus = "error";
            agentKeyTestMessage =
                typeof e === "string"
                    ? e
                    : e.message || "Session key không hợp lệ hoặc đã hết hạn";
            showToast("Session key không hợp lệ — chưa lưu", "error");
        }
    }

    async function handleRemoveAgentKey() {
        await handleSettingChange("agent_session_key", "");
        agentKeyInput = "";
        agentKeyTestStatus = "idle";
        agentKeyTestMessage = "";
        showToast("Đã xóa session key", "success");
    }

    async function handleSaveCodexToken() {
        const token = codexTokenInput.trim();
        if (!token) return;
        codexTokenTestStatus = "testing";
        codexTokenTestMessage = "";
        try {
            await agentFetchCodexUsageLimits(token);
            codexTokenTestStatus = "success";
            codexTokenTestMessage = "Đã xác minh Codex token";
            await handleSettingChange("agent_codex_access_token", token);
            showToast("Đã xác minh và lưu Codex token", "success");
        } catch (e: any) {
            codexTokenTestStatus = "error";
            codexTokenTestMessage =
                typeof e === "string"
                    ? e
                    : e.message || "Codex token không hợp lệ hoặc đã hết hạn";
            showToast("Codex token không hợp lệ — chưa lưu", "error");
        }
    }

    async function handleRemoveCodexToken() {
        await handleSettingChange("agent_codex_access_token", "");
        codexTokenInput = "";
        codexTokenTestStatus = "idle";
        codexTokenTestMessage = "";
        showToast("Đã xóa Codex access token", "success");
    }

    /** Auto-commit on blur / Enter for the Claude session-key field —
     *  fires only when the input has a non-empty value that differs from
     *  the currently-saved key. Keeps the user out of "click Save after
     *  every paste" purgatory. Verification + save happens inside
     *  handleSaveAgentKey, which already updates the inline status. */
    function commitAgentKeyIfChanged() {
        const v = agentKeyInput.trim();
        if (!v || v === agentSessionKey) return;
        handleSaveAgentKey();
    }

    /** Same auto-commit pattern for the Codex access-token field. */
    function commitCodexTokenIfChanged() {
        const v = codexTokenInput.trim();
        if (!v || v === agentCodexToken) return;
        handleSaveCodexToken();
    }

    async function loadAgentUsage() {
        agentUsageLoading = true;
        try {
            // Provider tracks the footer toggle so Settings reflects
            // the same scope as the floating Usage Dashboard.
            agentUsageData = await agentGetUsageAnalytics(
                agentUsageDays,
                agentFooterProvider,
            );
        } catch {
            agentUsageData = null;
        }
        agentUsageLoading = false;
    }

    function selectAgentUsageDays(d: number) {
        agentUsageDays = d;
        loadAgentUsage();
    }

    // Agent Plugins
    type PluginView = "installed" | "marketplace";
    let pluginView = $state<PluginView>("installed");
    let installedPlugins = $state<ClaudePlugin[]>([]);
    let marketplacePlugins = $state<MarketplacePlugin[]>([]);
    let pluginSearchQuery = $state("");
    let filteredMarketplacePlugins = $derived(
        pluginSearchQuery.trim()
            ? marketplacePlugins.filter(
                  (p) =>
                      p.name
                          .toLowerCase()
                          .includes(pluginSearchQuery.toLowerCase()) ||
                      p.description
                          .toLowerCase()
                          .includes(pluginSearchQuery.toLowerCase()),
              )
            : marketplacePlugins,
    );

    // Agent Contexts
    let agentContexts = $state<AgentContext[]>([]);
    let editingContext = $state<AgentContext | null>(null);
    let editContextName = $state("");
    let editContextContent = $state("");
    let isNewContext = $state(false);
    let deleteConfirmId = $state<string | null>(null);

    // Provider tabs. Claude uses marketplace-directory + CLI subcommand
    // model; Codex's plugin lifecycle lives in its TUI (`/plugins`
    // slash command) so we list/toggle by parsing ~/.codex/config.toml
    // and show an "install inside Codex" hint. OpenCode is npm-based
    // (no marketplace) — excluded.
    const PLUGIN_PROVIDER_TABS: { id: string; label: string }[] = [
        { id: "claude", label: "Claude" },
        { id: "codex", label: "Codex" },
    ];
    let pluginProvider = $state<string>("claude");

    async function loadAgentPlugins() {
        try {
            installedPlugins = await agentGetPlugins(pluginProvider);
        } catch {
            installedPlugins = [];
        }
        try {
            marketplacePlugins =
                await agentGetMarketplacePlugins(pluginProvider);
        } catch {
            marketplacePlugins = [];
        }
    }

    async function loadAgentContexts() {
        try {
            agentContexts = await agentListContexts();
        } catch {
            agentContexts = [];
        }
    }

    async function handleTogglePlugin(name: string, enabled: boolean) {
        try {
            await agentTogglePlugin(name, enabled, pluginProvider);
            installedPlugins = installedPlugins.map((p) =>
                p.name === name ? { ...p, enabled } : p,
            );
            showToast(`Plugin đã ${enabled ? "bật" : "tắt"}`, "success");
        } catch {
            showToast("Không thể chuyển trạng thái plugin", "error");
        }
    }

    async function handleUninstallPlugin(name: string, marketplace: string) {
        try {
            await agentUninstallPlugin(name, marketplace, pluginProvider);
            installedPlugins = installedPlugins.filter((p) => p.name !== name);
            marketplacePlugins = marketplacePlugins.map((p) =>
                p.name === name ? { ...p, installed: false } : p,
            );
            showToast("Đã gỡ cài đặt plugin", "success");
        } catch {
            showToast("Không thể gỡ cài đặt plugin", "error");
        }
    }

    async function handleInstallPlugin(name: string, marketplace: string) {
        try {
            await agentInstallPlugin(name, marketplace, pluginProvider);
            marketplacePlugins = marketplacePlugins.map((p) =>
                p.name === name ? { ...p, installed: true } : p,
            );
            await loadAgentPlugins();
            showToast("Đã cài đặt plugin", "success");
        } catch {
            showToast("Không thể cài đặt plugin", "error");
        }
    }

    // Switching tabs reloads the list against the new provider's tooling.
    // Codex has no marketplace browser in Clauge, so we lock its view
    // to 'installed' — flipping to 'marketplace' there would show
    // perpetual-empty state and confuse users.
    function selectPluginProvider(id: string) {
        if (pluginProvider === id) return;
        pluginProvider = id;
        if (id === "codex") pluginView = "installed";
        installedPlugins = [];
        marketplacePlugins = [];
        loadAgentPlugins();
    }

    function startEditContext(ctx: AgentContext) {
        editingContext = ctx;
        editContextName = ctx.name;
        editContextContent = ctx.content;
        isNewContext = false;
    }

    function startNewContext() {
        editingContext = null;
        editContextName = "";
        editContextContent = "";
        isNewContext = true;
    }

    function cancelEditContext() {
        editingContext = null;
        isNewContext = false;
        editContextName = "";
        editContextContent = "";
    }

    async function handleSaveAgentContext() {
        const name = editContextName.trim();
        const content = editContextContent.trim();
        if (!name || !content) {
            showToast("Tên và nội dung là bắt buộc", "error");
            return;
        }
        try {
            await agentSaveContext({ id: editingContext?.id, name, content });
            await loadAgentContexts();
            cancelEditContext();
            showToast("Đã lưu bối cảnh", "success");
        } catch {
            showToast("Không thể lưu bối cảnh", "error");
        }
    }

    async function handleDeleteAgentContext(id: string) {
        try {
            await agentDeleteContext(id);
            agentContexts = agentContexts.filter((c) => c.id !== id);
            deleteConfirmId = null;
            if (editingContext?.id === id) cancelEditContext();
            showToast("Đã xóa bối cảnh", "success");
        } catch {
            showToast("Không thể xóa bối cảnh", "error");
        }
    }

    let agentSettingsLoaded = false;
    $effect(() => {
        if (activeTab === "agent" && show && !agentSettingsLoaded) {
            agentSettingsLoaded = true;
            loadAgentPlugins();
            loadAgentContexts();
            agentKeyInput = $settings["agent_session_key"] ?? "";
            codexTokenInput = $settings["agent_codex_access_token"] ?? "";
        }
        if (!show) {
            agentSettingsLoaded = false;
            agentSubTab = "general";
            cancelEditContext();
            agentKeyTestStatus = "idle";
            agentKeyTestMessage = "";
            showAgentKey = false;
            showCodexToken = false;
        }
    });

    // Reload Usage Stats whenever the panel is open AND the footer
    // provider toggle changes — picking OpenCode in the dropdown
    // should immediately retarget the analytics query, same as the
    // floating Usage Dashboard. The dependency on agentFooterProvider
    // makes the effect re-run.
    $effect(() => {
        const _ = agentFooterProvider; // dependency
        if (agentSubTab === "usage" && show) {
            loadAgentUsage();
        }
    });
</script>

{#if show}
    <div class="stg-pane glass-surface" role="region" aria-label="Cài đặt">
        <div class="stg-layout">
            <!-- Tab sidebar -->
            <div class="stg-tabs">
                {#each tabs as item}
                    {#if item.kind === "header"}
                        <span class="stg-tab-section">{item.label}</span>
                    {:else}
                        <button
                            class="stg-tab"
                            class:active={activeTab === item.key}
                            onclick={() => {
                                if (settingsTab)
                                    updateTab(settingsTab.id, {
                                        key: item.key,
                                    });
                                else activeTab = item.key;
                            }}
                        >
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                {@html item.icon}
                            </svg>
                            {item.label}
                        </button>
                    {/if}
                {/each}
            </div>

            <!-- Content pane -->
            <div class="stg-content">
                {#if activeTab === "account"}
                    <AccountTabContent />
                {:else if activeTab === "general"}
                    <div class="stg-card-stack">
                        <!-- Proxy card -->
                        <section class="stg-card">
                            <header class="stg-card-hd">
                                <span class="stg-card-icon" aria-hidden="true">
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="14"
                                        height="14"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                    >
                                        <circle cx="12" cy="12" r="10" /><path
                                            d="M2 12h20"
                                        /><path
                                            d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
                                        />
                                    </svg>
                                </span>
                                <div class="stg-card-titles">
                                    <h3 class="stg-card-title">Proxy</h3>
                                    <p class="stg-card-sub">
                                        Áp dụng cho toàn hệ thống. Để trống để
                                        kết nối trực tiếp.
                                    </p>
                                </div>
                            </header>
                            <div class="stg-card-body">
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >URL Proxy</label
                                    >
                                    <input
                                        class="stg-input stg-card-input-lg"
                                        type="text"
                                        placeholder="http://proxy:8080"
                                        value={proxyUrl}
                                        onchange={(e) =>
                                            handleSettingChange(
                                                "proxy_url",
                                                e.currentTarget.value,
                                            )}
                                    />
                                </div>
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Xác thực Proxy</label
                                    >
                                    <label class="stg-toggle">
                                        <input
                                            type="checkbox"
                                            checked={proxyAuth}
                                            onchange={(e) =>
                                                handleSettingChange(
                                                    "proxy_auth",
                                                    String(
                                                        e.currentTarget.checked,
                                                    ),
                                                )}
                                        />
                                        <span class="stg-toggle-slider"></span>
                                    </label>
                                </div>
                                {#if proxyAuth}
                                    <div class="stg-card-row">
                                        <label class="stg-card-row-label"
                                            >Tên đăng nhập</label
                                        >
                                        <input
                                            class="stg-input"
                                            type="text"
                                            value={proxyUsername}
                                            placeholder="tên đăng nhập"
                                            onchange={(e) =>
                                                handleSettingChange(
                                                    "proxy_username",
                                                    e.currentTarget.value,
                                                )}
                                        />
                                    </div>
                                    <div class="stg-card-row">
                                        <label class="stg-card-row-label"
                                            >Mật khẩu</label
                                        >
                                        <input
                                            class="stg-input"
                                            type="password"
                                            value={proxyPassword}
                                            placeholder="mật khẩu"
                                            onchange={(e) =>
                                                handleSettingChange(
                                                    "proxy_password",
                                                    e.currentTarget.value,
                                                )}
                                        />
                                    </div>
                                {/if}
                            </div>
                        </section>

                        <!-- Logs card -->
                        <section class="stg-card">
                            <header class="stg-card-hd">
                                <span class="stg-card-icon" aria-hidden="true">
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="14"
                                        height="14"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                    >
                                        <path
                                            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                                        /><polyline
                                            points="14 2 14 8 20 8"
                                        /><line
                                            x1="9"
                                            y1="13"
                                            x2="15"
                                            y2="13"
                                        /><line
                                            x1="9"
                                            y1="17"
                                            x2="15"
                                            y2="17"
                                        />
                                    </svg>
                                </span>
                                <div class="stg-card-titles">
                                    <h3 class="stg-card-title">Log</h3>
                                    <p class="stg-card-sub">
                                        Tệp log theo từng giờ, sắp xếp theo
                                        ngày. Log cũ hơn 30 ngày sẽ tự động
                                        bị xóa.
                                    </p>
                                </div>
                            </header>
                            <div class="stg-card-body">
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Thư mục log</label
                                    >
                                    <div class="log-path-row">
                                        <span class="log-path">{logDir}</span>
                                        <button
                                            class="log-open-btn"
                                            onclick={handleOpenLogFolder}
                                            title="Mở trong trình quản lý tệp"
                                            aria-label="Mở thư mục log"
                                        >
                                            <svg
                                                width="14"
                                                height="14"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                aria-hidden="true"
                                            >
                                                <path
                                                    d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                                                />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <!-- Chat History card -->
                        <section class="stg-card">
                            <header class="stg-card-hd">
                                <span class="stg-card-icon" aria-hidden="true">
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="14"
                                        height="14"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                    >
                                        <path
                                            d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                                        />
                                    </svg>
                                </span>
                                <div class="stg-card-titles">
                                    <h3 class="stg-card-title">Lịch sử trò chuyện</h3>
                                    <p class="stg-card-sub">
                                        Áp dụng cho mục Lịch sử (nhật ký
                                        yêu cầu/phản hồi) và trò chuyện Trợ
                                        lý AI trên mọi chế độ.
                                    </p>
                                </div>
                            </header>

                            <!-- Stat strip: prominent counts, scannable. -->
                            <div class="stg-card-stats">
                                <div class="stg-card-stat">
                                    <span class="stg-card-stat-num"
                                        >{restHistoryCount.toLocaleString()}</span
                                    >
                                    <span class="stg-card-stat-lbl"
                                        >Yêu cầu</span
                                    >
                                </div>
                                <div
                                    class="stg-card-stat-divider"
                                    aria-hidden="true"
                                ></div>
                                <div class="stg-card-stat">
                                    <span class="stg-card-stat-num"
                                        >{aiChatCount.toLocaleString()}</span
                                    >
                                    <span class="stg-card-stat-lbl"
                                        >Tin nhắn AI</span
                                    >
                                </div>
                                <div
                                    class="stg-card-stat-divider"
                                    aria-hidden="true"
                                ></div>
                                <div class="stg-card-stat">
                                    <span class="stg-card-stat-num"
                                        >{formatBytes(totalStorageBytes)}</span
                                    >
                                    <span class="stg-card-stat-lbl"
                                        >Bộ nhớ</span
                                    >
                                </div>
                            </div>

                            <div class="stg-card-body">
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Tự động xóa sau</label
                                    >
                                    <select
                                        class="stg-select stg-card-input-lg"
                                        value={chatRetention}
                                        onchange={(e) =>
                                            handleChatRetentionChange(
                                                e.currentTarget.value,
                                            )}
                                    >
                                        <option value="24h">24 Giờ</option>
                                        <option value="7d">7 Ngày</option>
                                        <option value="30d"
                                            >30 Ngày (mặc định)</option
                                        >
                                        <option value="1y">1 Năm</option>
                                        <option value="never">Không bao giờ</option>
                                    </select>
                                </div>
                                <div class="stg-card-row stg-card-row-action">
                                    <div class="stg-card-row-action-text">
                                        <span class="stg-card-row-label"
                                            >Xóa toàn bộ lịch sử trò chuyện</span
                                        >
                                        <span class="stg-card-row-help"
                                            >Xóa mọi nhật ký yêu cầu và cuộc
                                            trò chuyện AI. Thao tác này không
                                            thể hoàn tác.</span
                                        >
                                    </div>
                                    <button
                                        class="stg-card-danger-btn"
                                        onclick={() =>
                                            (showClearChatHistoryConfirm = true)}
                                    >
                                        <svg
                                            viewBox="0 0 24 24"
                                            width="12"
                                            height="12"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            aria-hidden="true"
                                        >
                                            <polyline
                                                points="3 6 5 6 21 6"
                                            /><path
                                                d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
                                            /><path d="M10 11v6" /><path
                                                d="M14 11v6"
                                            />
                                        </svg>
                                        <span>Xóa lịch sử</span>
                                    </button>
                                </div>
                            </div>
                        </section>

                        <!-- Privacy / telemetry card -->
                        <section class="stg-card">
                            <header class="stg-card-hd">
                                <span class="stg-card-icon" aria-hidden="true">
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="14"
                                        height="14"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                    >
                                        <path
                                            d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
                                        />
                                    </svg>
                                </span>
                                <div class="stg-card-titles">
                                    <h3 class="stg-card-title">Quyền riêng tư</h3>
                                    <p class="stg-card-sub">
                                        Giúp cải thiện Clauge bằng dữ liệu sử
                                        dụng ẩn danh.
                                    </p>
                                </div>
                            </header>
                            <div class="stg-card-body">
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Chia sẻ dữ liệu sử dụng ẩn danh</label
                                    >
                                    <label class="stg-toggle">
                                        <input
                                            type="checkbox"
                                            checked={!telemetryOptedOut}
                                            onchange={(e) =>
                                                handleSettingChange(
                                                    "telemetry_optout",
                                                    String(
                                                        !e.currentTarget
                                                            .checked,
                                                    ),
                                                )}
                                        />
                                        <span class="stg-toggle-slider"></span>
                                    </label>
                                </div>
                            </div>
                        </section>
                    </div>
                {:else if activeTab === "workspace"}
                    <div class="stg-card-stack">
                        <section class="stg-card">
                            <header class="stg-card-hd">
                                <span class="stg-card-icon" aria-hidden="true">
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="14"
                                        height="14"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        ><polyline
                                            points="16 18 22 12 16 6"
                                        /><polyline
                                            points="8 6 2 12 8 18"
                                        /></svg
                                    >
                                </span>
                                <div class="stg-card-titles">
                                    <h3 class="stg-card-title">MCP Server</h3>
                                    <p class="stg-card-sub">
                                        MCP server cục bộ cho phép các coding
                                        agent hỗ trợ MCP đọc và chỉnh sửa Ghi
                                        chú và Bảng của bạn thông qua tool
                                        call. Cấu hình của mỗi agent đã cài đặt
                                        được đăng ký tự động khi bật.
                                    </p>
                                </div>
                                <span
                                    class="stg-card-pill"
                                    class:on={mcpStatus.running}
                                >
                                    <span class="stg-card-pill-dot"></span>
                                    {mcpStatus.running
                                        ? `Đang chạy · :${mcpStatus.port}`
                                        : "Đã dừng"}
                                </span>
                            </header>

                            <div class="stg-card-body">
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Bật MCP server</label
                                    >
                                    <label class="stg-toggle">
                                        <input
                                            type="checkbox"
                                            checked={mcpStatus.running}
                                            onchange={(e) =>
                                                handleMcpToggle(
                                                    e.currentTarget.checked,
                                                )}
                                        />
                                        <span class="stg-toggle-slider"></span>
                                    </label>
                                </div>

                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Port</label
                                    >
                                    <input
                                        class="stg-input"
                                        type="number"
                                        min="1024"
                                        max="65535"
                                        value={mcpPort}
                                        disabled={mcpStatus.running}
                                        onchange={(e) =>
                                            (mcpPort =
                                                Number(e.currentTarget.value) ||
                                                7421)}
                                    />
                                </div>

                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Token xác thực</label
                                    >
                                    <div class="stg-card-token-row">
                                        <input
                                            class="stg-input stg-card-input-lg"
                                            type={showMcpToken
                                                ? "text"
                                                : "password"}
                                            value={mcpToken}
                                            readonly
                                        />
                                        <button
                                            class="stg-card-mini-btn"
                                            onclick={() =>
                                                (showMcpToken = !showMcpToken)}
                                            title={showMcpToken
                                                ? "Ẩn"
                                                : "Hiện"}
                                        >
                                            {showMcpToken ? "Ẩn" : "Hiện"}
                                        </button>
                                        <button
                                            class="stg-card-mini-btn"
                                            onclick={handleCopyMcpToken}
                                            title="Sao chép">Sao chép</button
                                        >
                                        <button
                                            class="stg-card-mini-btn"
                                            onclick={handleRotateMcpToken}
                                            disabled={mcpStatus.running}
                                            title="Tạo token mới"
                                            >Xoay</button
                                        >
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section class="stg-card">
                            <header class="stg-card-hd">
                                <span class="stg-card-icon" aria-hidden="true">
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="14"
                                        height="14"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        ><path
                                            d="M3 7h18M3 12h12M3 17h18"
                                        /></svg
                                    >
                                </span>
                                <div class="stg-card-titles">
                                    <h3 class="stg-card-title">
                                        Tự động hóa bảng
                                    </h3>
                                    <p class="stg-card-sub">
                                        Khi PR của một thẻ được merge trên
                                        GitHub hoặc GitLab, tự động chuyển thẻ
                                        đó sang cột cuối cùng của bảng. Kiểm
                                        tra khi ứng dụng được focus, giới hạn
                                        tần suất 5 phút. Luồng thẻ nhận một bình
                                        luận hệ thống để có thể theo dõi việc
                                        di chuyển.
                                    </p>
                                </div>
                            </header>
                            <div class="stg-card-body">
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Tự động chuyển thẻ khi PR được merge</label
                                    >
                                    <label class="stg-toggle">
                                        <input
                                            type="checkbox"
                                            checked={autoMoveMergedPrs}
                                            onchange={(e) =>
                                                handleSettingChange(
                                                    "workspace_automove_merged_prs",
                                                    String(
                                                        e.currentTarget.checked,
                                                    ),
                                                )}
                                        />
                                        <span class="stg-toggle-slider"></span>
                                    </label>
                                </div>
                            </div>
                        </section>
                    </div>
                {:else if activeTab === "rest"}
                    <div class="stg-card-stack">
                        <section class="stg-card">
                            <header class="stg-card-hd">
                                <span class="stg-card-icon" aria-hidden="true">
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="14"
                                        height="14"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                    >
                                        <path
                                            d="M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0z"
                                        /><path d="M12 8v4l3 2" />
                                    </svg>
                                </span>
                                <div class="stg-card-titles">
                                    <h3 class="stg-card-title">
                                        Cài đặt yêu cầu
                                    </h3>
                                    <p class="stg-card-sub">
                                        Giá trị mặc định áp dụng cho mọi yêu
                                        cầu REST bạn gửi.
                                    </p>
                                </div>
                            </header>
                            <div class="stg-card-body">
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Thời gian chờ yêu cầu (ms)</label
                                    >
                                    <input
                                        class="stg-input"
                                        type="number"
                                        value={timeout}
                                        min="1000"
                                        step="1000"
                                        onchange={(e) =>
                                            handleSettingChange(
                                                "request_timeout",
                                                e.currentTarget.value,
                                            )}
                                    />
                                </div>
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Theo dõi chuyển hướng</label
                                    >
                                    <label class="stg-toggle">
                                        <input
                                            type="checkbox"
                                            checked={followRedirects}
                                            onchange={(e) =>
                                                handleSettingChange(
                                                    "follow_redirects",
                                                    String(
                                                        e.currentTarget.checked,
                                                    ),
                                                )}
                                        />
                                        <span class="stg-toggle-slider"></span>
                                    </label>
                                </div>
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Xác minh SSL</label
                                    >
                                    <label class="stg-toggle">
                                        <input
                                            type="checkbox"
                                            checked={sslVerification}
                                            onchange={(e) =>
                                                handleSettingChange(
                                                    "ssl_verification",
                                                    String(
                                                        e.currentTarget.checked,
                                                    ),
                                                )}
                                        />
                                        <span class="stg-toggle-slider"></span>
                                    </label>
                                </div>
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Kích thước phản hồi tối đa (MB)</label
                                    >
                                    <input
                                        class="stg-input"
                                        type="number"
                                        value={maxResponseSize}
                                        min="1"
                                        max="100"
                                        onchange={(e) =>
                                            handleSettingChange(
                                                "max_response_size",
                                                e.currentTarget.value,
                                            )}
                                    />
                                </div>
                            </div>
                        </section>
                    </div>
                {:else if activeTab === "appearance"}
                    <div class="stg-section">
                        <span class="stg-section-label">Giao diện</span>
                        <div class="theme-grid">
                            {#each getThemes() as theme}
                                <button
                                    class="theme-card"
                                    class:active={displayTheme === theme.id}
                                    class:locked={theme.premium &&
                                        $cloudPlan !== "pro"}
                                    onclick={() => handleThemeChange(theme.id)}
                                >
                                    <div class="theme-preview">
                                        {#each THEME_PREVIEW_COLORS[theme.id] || [] as color, i}
                                            <div
                                                class="theme-preview-bar"
                                                style="background:{color}; opacity:{0.6 +
                                                    i * 0.2}"
                                            ></div>
                                        {/each}
                                    </div>
                                    <div class="theme-info">
                                        <span class="theme-name"
                                            >{theme.name}</span
                                        >
                                        <span class="theme-desc"
                                            >{THEME_DESCRIPTIONS[theme.id] ||
                                                theme.description}</span
                                        >
                                    </div>
                                    {#if theme.premium}
                                        <span class="pro-badge">PRO</span>
                                    {/if}
                                </button>
                            {/each}
                        </div>

                        {#if previewThemeId}
                            {@const previewName =
                                getTheme(previewThemeId)?.name ?? "Giao diện"}
                            <div class="theme-preview-banner" role="alert">
                                <div class="theme-preview-info">
                                    <span class="theme-preview-eyebrow"
                                        >ĐANG XEM TRƯỚC</span
                                    >
                                    <strong class="theme-preview-name"
                                        >{previewName}</strong
                                    >
                                    <p class="theme-preview-sub">
                                        Đây là giao diện cao cấp. Nâng cấp để
                                        giữ lại, hoặc hủy để quay về giao diện
                                        hiện tại.
                                    </p>
                                </div>
                                <div class="theme-preview-actions">
                                    <button
                                        class="theme-preview-btn"
                                        onclick={cancelThemePreview}
                                    >
                                        Hủy
                                    </button>
                                    <button
                                        class="theme-preview-btn theme-preview-btn-primary"
                                        onclick={upgradeFromThemePreview}
                                    >
                                        Nâng cấp lên Pro
                                    </button>
                                </div>
                            </div>
                        {/if}
                    </div>

                    <div class="stg-section">
                        <span class="stg-section-label">Màu nhấn</span>
                        {#if accentLocked}
                            <div class="stg-accent-locked-note">
                                <svg
                                    viewBox="0 0 24 24"
                                    width="14"
                                    height="14"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.8"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    aria-hidden="true"
                                    ><rect
                                        x="3"
                                        y="11"
                                        width="18"
                                        height="11"
                                        rx="2"
                                    /><path d="M7 11V7a5 5 0 0110 0v4" /></svg
                                >
                                <span
                                    ><strong>{activeThemeDef?.name}</strong> đã cung
                                    cấp màu nhấn riêng. Chọn giao diện khác để tùy chỉnh.</span
                                >
                            </div>
                        {/if}
                        <div
                            class="stg-swatches"
                            class:stg-swatches-disabled={accentLocked}
                        >
                            {#each ACCENT_COLORS as color}
                                <button
                                    class="stg-swatch"
                                    class:active={accentColor === color.value}
                                    style="background: {color.value}"
                                    title={accentLocked
                                        ? `${activeThemeDef?.name} kiểm soát màu nhấn`
                                        : color.name}
                                    disabled={accentLocked}
                                    onclick={() =>
                                        handleAccentChange(color.value)}
                                ></button>
                            {/each}
                        </div>
                    </div>
                {:else if activeTab === "ai"}
                    <!-- Top-level split: Clauge AI (managed credits + history)
                         vs BYOK (your own keys + per-mode/per-model stats). -->
                    <div class="ai-toptabs">
                        <button
                            class="ai-toptab"
                            class:active={aiTopTab === "clauge"}
                            onclick={() => (aiTopTab = "clauge")}
                        >
                            Clauge AI
                        </button>
                        <button
                            class="ai-toptab"
                            class:active={aiTopTab === "byok"}
                            onclick={() => (aiTopTab = "byok")}
                        >
                            BYOK
                        </button>
                    </div>

                    {#if aiTopTab === "clauge"}
                        {#if $cloudPlan !== "pro"}
                            <!-- Free user: upsell card lives here, full data
                                 panels only appear after upgrade. -->
                            <ClaugeAIBalance
                                plan={$cloudPlan ?? "free"}
                                credits={cloudCreditsLocal}
                                subscription={cloudSubLocal}
                                onUpgradeClick={handleUpgradeClick}
                            />
                        {:else}
                            {@const remaining =
                                cloudCreditsLocal?.remaining ?? 0}
                            {@const allowance =
                                cloudCreditsLocal?.allowance ?? 0}
                            {@const used = Math.max(0, allowance - remaining)}
                            {@const pctRemaining =
                                allowance > 0
                                    ? Math.min(
                                          100,
                                          Math.round(
                                              (remaining / allowance) * 100,
                                          ),
                                      )
                                    : 0}
                            {@const intervalLabel =
                                $cloudSub?.interval === "yearly"
                                    ? "Hàng năm"
                                    : "Hàng tháng"}
                            {@const periodLabel =
                                $cloudSub?.interval === "yearly"
                                    ? "năm nay"
                                    : "tháng này"}
                            <div class="cai2-pane">
                                <!-- Card 1: Credits hero -->
                                <section class="cai2-card">
                                    <header class="cai2-head">
                                        <span
                                            class="cai2-icon"
                                            aria-hidden="true"
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                width="14"
                                                height="14"
                                                fill="currentColor"
                                            >
                                                <path
                                                    d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"
                                                />
                                            </svg>
                                        </span>
                                        <div class="cai2-titles">
                                            <h3 class="cai2-title">Tín dụng</h3>
                                            <p class="cai2-sub">
                                                Phân bổ {intervalLabel}{#if cloudCreditsLocal?.resets_at}
                                                    <span class="cai2-dot"
                                                        >·</span
                                                    >
                                                    đặt lại {new Date(
                                                        cloudCreditsLocal.resets_at,
                                                    ).toLocaleDateString(
                                                        undefined,
                                                        {
                                                            month: "short",
                                                            day: "numeric",
                                                            year: "numeric",
                                                        },
                                                    )}
                                                {/if}
                                            </p>
                                        </div>
                                        {#if cloudSubLocal?.status}
                                            <span class="cai2-status">
                                                {cloudSubLocal.cancel_at_period_end
                                                    ? "Đang hủy"
                                                    : "Hoạt động"}
                                            </span>
                                        {/if}
                                    </header>

                                    <div class="cai2-hero">
                                        <span class="cai2-hero-val"
                                            >{remaining.toLocaleString()}</span
                                        >
                                        <span class="cai2-hero-tot"
                                            >/ {allowance.toLocaleString()} còn lại</span
                                        >
                                    </div>
                                    <div class="cai2-bar-wrap">
                                        <div
                                            class="cai2-bar"
                                            style="width: {pctRemaining}%"
                                        ></div>
                                    </div>
                                    <p class="cai2-meta">
                                        {used.toLocaleString()} tín dụng đã dùng {periodLabel}
                                    </p>
                                </section>

                                <!-- Card 2: Credits by mode -->
                                {#if cloudAiByMode.length > 0}
                                    <section class="cai2-card">
                                        <header class="cai2-head">
                                            <span
                                                class="cai2-icon"
                                                aria-hidden="true"
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    width="14"
                                                    height="14"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2"
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                >
                                                    <line
                                                        x1="18"
                                                        y1="20"
                                                        x2="18"
                                                        y2="10"
                                                    /><line
                                                        x1="12"
                                                        y1="20"
                                                        x2="12"
                                                        y2="4"
                                                    /><line
                                                        x1="6"
                                                        y1="20"
                                                        x2="6"
                                                        y2="14"
                                                    />
                                                </svg>
                                            </span>
                                            <div class="cai2-titles">
                                                <h3 class="cai2-title">
                                                    Tín dụng theo chế độ
                                                </h3>
                                                <p class="cai2-sub">
                                                    Phân tích mức sử dụng trên
                                                    các chế độ {periodLabel}.
                                                </p>
                                            </div>
                                        </header>
                                        <ul class="cai2-mode-list">
                                            {#each cloudAiByMode as m (m.mode)}
                                                <li class="cai2-mode-row">
                                                    <span
                                                        class="cai2-mode-name"
                                                    >
                                                        <span
                                                            class="cai2-mode-dot"
                                                            style="background: {modeColor(
                                                                m.mode,
                                                            )}"
                                                        ></span>
                                                        {capitalizeMode(m.mode)}
                                                    </span>
                                                    <div
                                                        class="cai2-mode-bar-wrap"
                                                    >
                                                        <div
                                                            class="cai2-mode-bar"
                                                            style="width: {m.percent}%; background: {modeColor(
                                                                m.mode,
                                                            )}"
                                                        ></div>
                                                    </div>
                                                    <span class="cai2-mode-val"
                                                        >{m.credits.toLocaleString()}
                                                        cr</span
                                                    >
                                                    <span class="cai2-mode-pct"
                                                        >{m.percent}%</span
                                                    >
                                                </li>
                                            {/each}
                                        </ul>
                                    </section>
                                {/if}

                                <!-- Card 3: Recent activity table -->
                                <section class="cai2-card cai2-card-activity">
                                    <header class="cai2-head">
                                        <span
                                            class="cai2-icon"
                                            aria-hidden="true"
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                width="14"
                                                height="14"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                            >
                                                <circle
                                                    cx="12"
                                                    cy="12"
                                                    r="10"
                                                /><polyline
                                                    points="12 6 12 12 16 14"
                                                />
                                            </svg>
                                        </span>
                                        <div class="cai2-titles">
                                            <h3 class="cai2-title">
                                                Hoạt động gần đây
                                            </h3>
                                        </div>
                                        <span class="cai2-sub-right">
                                            {cloudAiUsage.length}
                                            {cloudAiUsage.length === 1
                                                ? "yêu cầu"
                                                : "yêu cầu"}
                                            {#if cloudAiUsageNextBefore}đã tải ·
                                                cuộn để xem thêm{/if}
                                        </span>
                                    </header>
                                    {#if cloudAiUsageLoading && cloudAiUsage.length === 0}
                                        <p class="cai2-empty">Đang tải…</p>
                                    {:else if cloudAiUsage.length === 0}
                                        <p class="cai2-empty">
                                            Chưa có yêu cầu Clauge AI nào. Bắt
                                            đầu trò chuyện từ bất kỳ chế độ nào
                                            với Clauge AI được chọn trong panel.
                                        </p>
                                    {:else}
                                        <div
                                            class="cai2-table"
                                            onscroll={handleActivityScroll}
                                        >
                                            <div class="cai2-tr cai2-th">
                                                <span>THỜI GIAN</span>
                                                <span>LOẠI</span>
                                                <span>CHẾ ĐỘ</span>
                                                <span class="cai2-th-right"
                                                    >TÍN DỤNG</span
                                                >
                                            </div>
                                            {#each cloudAiUsage as e (e.request_id)}
                                                <div class="cai2-tr">
                                                    <span class="cai2-td-time"
                                                        >{fmtUsageTime(
                                                            e.occurred_at,
                                                        )}</span
                                                    >
                                                    <span class="cai2-td-op"
                                                        >{e.operation}</span
                                                    >
                                                    <span
                                                        class="cai2-td-mode"
                                                        style="color: {modeColor(
                                                            e.mode,
                                                        )}"
                                                    >
                                                        {e.mode
                                                            ? capitalizeMode(
                                                                  e.mode,
                                                              )
                                                            : "—"}
                                                    </span>
                                                    <span class="cai2-td-cost"
                                                        >−{e.clauge_credits.toLocaleString()}
                                                        cr</span
                                                    >
                                                </div>
                                            {/each}
                                            {#if cloudAiUsageLoadingMore}
                                                <div class="cai2-loading-more">
                                                    Đang tải thêm…
                                                </div>
                                            {:else if !cloudAiUsageNextBefore && cloudAiUsage.length >= CLOUD_AI_USAGE_PAGE}
                                                <div
                                                    class="cai2-loading-more cai2-end"
                                                >
                                                    Hết lịch sử
                                                </div>
                                            {/if}
                                        </div>
                                    {/if}
                                </section>
                            </div>
                        {/if}
                    {:else if aiTopTab === "byok"}
                        <!-- AI sub-tabs -->
                        <div class="ai-subtabs">
                            <button
                                class="ai-subtab"
                                class:active={aiSubTab === "config"}
                                onclick={() => (aiSubTab = "config")}
                            >
                                Cấu hình
                            </button>
                            <button
                                class="ai-subtab"
                                class:active={aiSubTab === "usage"}
                                class:disabled={!aiHasKey}
                                onclick={() => {
                                    if (aiHasKey) aiSubTab = "usage";
                                }}
                            >
                                Thống kê sử dụng
                                {#if !aiHasKey}
                                    <svg
                                        class="ai-subtab-lock"
                                        viewBox="0 0 24 24"
                                        width="11"
                                        height="11"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        ><rect
                                            x="3"
                                            y="11"
                                            width="18"
                                            height="11"
                                            rx="2"
                                            ry="2"
                                        /><path
                                            d="M7 11V7a5 5 0 0110 0v4"
                                        /></svg
                                    >
                                {/if}
                            </button>
                        </div>

                        {#if aiSubTab === "config"}
                            <div class="stg-card-stack">
                                <section class="stg-card">
                                    <header class="stg-card-hd">
                                        <span
                                            class="stg-card-icon"
                                            aria-hidden="true"
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                width="14"
                                                height="14"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                            >
                                                <path
                                                    d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
                                                />
                                            </svg>
                                        </span>
                                        <div class="stg-card-titles">
                                            <h3 class="stg-card-title">
                                                Cấu hình
                                            </h3>
                                            <p class="stg-card-sub">
                                                Nhà cung cấp, model và API Key
                                                cho trợ lý AI trong ứng dụng.
                                            </p>
                                        </div>
                                    </header>
                                    <div class="ai-cfg">
                                        <!-- Provider & Model header -->
                                        <div class="ai-cfg-row">
                                            <div class="ai-cfg-field">
                                                <label class="ai-cfg-label"
                                                    >Nhà cung cấp</label
                                                >
                                                <select
                                                    class="ai-cfg-select"
                                                    value={aiProvider}
                                                    onchange={(e) =>
                                                        handleProviderChange(
                                                            e.currentTarget
                                                                .value,
                                                        )}
                                                >
                                                    {#each AI_PROVIDER_REGISTRY as p (p.providerId)}
                                                        <option
                                                            value={p.providerId}
                                                            >{p.providerLabel}</option
                                                        >
                                                    {/each}
                                                </select>
                                            </div>
                                            <div class="ai-cfg-field">
                                                <label class="ai-cfg-label"
                                                    >Model</label
                                                >
                                                <span class="ai-model-tag"
                                                    >{currentProviderConfig.modelLabel}</span
                                                >
                                            </div>
                                        </div>

                                        <!-- Divider -->
                                        <div class="ai-cfg-divider"></div>

                                        <!-- API Key -->
                                        <div class="ai-cfg-section">
                                            <label class="ai-cfg-label"
                                                >API Key</label
                                            >
                                            <div class="ai-key-input-wrap">
                                                <input
                                                    class="ai-cfg-input"
                                                    type={showAiKey
                                                        ? "text"
                                                        : "password"}
                                                    placeholder={currentProviderConfig.keyPlaceholder}
                                                    bind:value={aiApiKey}
                                                />
                                                <button
                                                    class="ai-key-toggle"
                                                    onclick={() =>
                                                        (showAiKey =
                                                            !showAiKey)}
                                                    type="button"
                                                >
                                                    {#if showAiKey}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            width="14"
                                                            height="14"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            stroke-width="1.8"
                                                            ><path
                                                                d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"
                                                            /><line
                                                                x1="1"
                                                                y1="1"
                                                                x2="23"
                                                                y2="23"
                                                            /></svg
                                                        >
                                                    {:else}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            width="14"
                                                            height="14"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            stroke-width="1.8"
                                                            ><path
                                                                d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                                                            /><circle
                                                                cx="12"
                                                                cy="12"
                                                                r="3"
                                                            /></svg
                                                        >
                                                    {/if}
                                                </button>
                                            </div>

                                            {#if aiTestStatus === "success"}
                                                <span
                                                    class="ai-test-result success"
                                                >
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        width="12"
                                                        height="12"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        ><polyline
                                                            points="20 6 9 17 4 12"
                                                        /></svg
                                                    >
                                                    {aiTestMessage}
                                                </span>
                                            {:else if aiTestStatus === "error"}
                                                <span
                                                    class="ai-test-result error"
                                                >
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        width="12"
                                                        height="12"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        ><circle
                                                            cx="12"
                                                            cy="12"
                                                            r="10"
                                                        /><line
                                                            x1="15"
                                                            y1="9"
                                                            x2="9"
                                                            y2="15"
                                                        /><line
                                                            x1="9"
                                                            y1="9"
                                                            x2="15"
                                                            y2="15"
                                                        /></svg
                                                    >
                                                    {aiTestMessage}
                                                </span>
                                            {/if}

                                            <div class="ai-key-actions">
                                                <button
                                                    class="ai-action-btn primary"
                                                    onclick={() =>
                                                        handleSaveAiKey()}
                                                    disabled={!aiApiKey.trim() ||
                                                        aiTestStatus ===
                                                            "testing"}
                                                >
                                                    {#if aiTestStatus === "testing"}
                                                        Đang xác minh...
                                                    {:else}
                                                        Lưu & Xác minh
                                                    {/if}
                                                </button>
                                                {#if aiHasKey}
                                                    <button
                                                        class="ai-action-btn danger"
                                                        onclick={handleRemoveAiKey}
                                                        >Xóa khóa</button
                                                    >
                                                {/if}
                                            </div>
                                        </div>

                                        <!-- Divider -->
                                        <div class="ai-cfg-divider"></div>

                                        <!-- Footer: links + status -->
                                        <div class="ai-cfg-footer">
                                            <div class="ai-cfg-links">
                                                <a
                                                    class="ai-link"
                                                    href={currentProviderConfig.keyUrl}
                                                    target="_blank"
                                                    rel="noopener"
                                                >
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        width="12"
                                                        height="12"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        ><path
                                                            d="M15 3h6v6"
                                                        /><path
                                                            d="M10 14L21 3"
                                                        /><path
                                                            d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"
                                                        /></svg
                                                    >
                                                    Lấy API Key
                                                </a>
                                                <span class="ai-link-sep"
                                                    >&middot;</span
                                                >
                                                <a
                                                    class="ai-link"
                                                    href="https://github.com/mnfst/awesome-free-llm-apis"
                                                    target="_blank"
                                                    rel="noopener"
                                                >
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        width="12"
                                                        height="12"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        ><path
                                                            d="M15 3h6v6"
                                                        /><path
                                                            d="M10 14L21 3"
                                                        /><path
                                                            d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"
                                                        /></svg
                                                    >
                                                    Free LLM APIs
                                                </a>
                                            </div>
                                            {#if aiHasKey}
                                                <span class="ai-status-badge">
                                                    <span class="ai-status-dot"
                                                    ></span>
                                                    Đã kết nối
                                                </span>
                                            {/if}
                                        </div>
                                    </div>
                                </section>

                                <!-- Configured providers list — every provider
                                 with a saved key, count + delete + click-to-edit.
                                 Sits directly under the Configuration card so
                                 the user can see what they have without opening
                                 the provider dropdown. -->
                                <section class="stg-card">
                                    <header class="stg-card-hd">
                                        <span
                                            class="stg-card-icon"
                                            aria-hidden="true"
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                width="14"
                                                height="14"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                            >
                                                <path d="M9 11l3 3L22 4" /><path
                                                    d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"
                                                />
                                            </svg>
                                        </span>
                                        <div class="stg-card-titles">
                                            <h3 class="stg-card-title">
                                                Nhà cung cấp đã cấu hình
                                                <span class="cfg-prov-count"
                                                    >{configuredProviders.length}</span
                                                >
                                            </h3>
                                            <p class="stg-card-sub">
                                                Các khóa bạn đã lưu. Nhấp vào
                                                một dòng để chỉnh sửa, hoặc gỡ
                                                bằng nút xóa.
                                            </p>
                                        </div>
                                    </header>

                                    {#if configuredProviders.length === 0}
                                        <p class="cfg-prov-empty">
                                            Chưa có nhà cung cấp nào được cấu
                                            hình. Lưu một khóa ở trên để thêm.
                                        </p>
                                    {:else}
                                        <ul class="cfg-prov-list">
                                            {#each configuredProviders as p (p.providerId)}
                                                {@const key =
                                                    $settings[
                                                        p.keySettingName
                                                    ] ?? ""}
                                                {@const tail =
                                                    key.length > 4
                                                        ? key.slice(-4)
                                                        : key}
                                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                                <li
                                                    class="cfg-prov-row"
                                                    class:is-active={p.providerId ===
                                                        aiProvider}
                                                    onclick={() =>
                                                        handleProviderChange(
                                                            p.providerId,
                                                        )}
                                                >
                                                    <div class="cfg-prov-info">
                                                        <span
                                                            class="cfg-prov-name"
                                                        >
                                                            {p.providerLabel}
                                                            {#if p.providerId === aiProvider}
                                                                <span
                                                                    class="cfg-prov-active-tag"
                                                                    >Đang dùng</span
                                                                >
                                                            {/if}
                                                        </span>
                                                        <span
                                                            class="cfg-prov-key"
                                                            title="Khóa kết thúc bằng {tail}"
                                                        >
                                                            ••••••••{tail}
                                                        </span>
                                                    </div>
                                                    <button
                                                        class="cfg-prov-del"
                                                        title="Xóa khóa đã lưu cho {p.providerLabel}"
                                                        onclick={(e) => {
                                                            e.stopPropagation();
                                                            handleSettingChange(
                                                                p.keySettingName,
                                                                "",
                                                            );
                                                            if (
                                                                p.providerId ===
                                                                aiProvider
                                                            ) {
                                                                aiApiKey = "";
                                                                aiTestStatus =
                                                                    "idle";
                                                            }
                                                        }}
                                                    >
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            width="13"
                                                            height="13"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            stroke-width="2"
                                                            stroke-linecap="round"
                                                            stroke-linejoin="round"
                                                            ><polyline
                                                                points="3 6 5 6 21 6"
                                                            /><path
                                                                d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
                                                            /></svg
                                                        >
                                                    </button>
                                                </li>
                                            {/each}
                                        </ul>
                                    {/if}
                                </section>
                            </div>
                        {:else if aiSubTab === "usage"}
                            {#if aiUsageStats.length === 0}
                                <div class="ai-usage-empty">
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="36"
                                        height="36"
                                        fill="none"
                                        stroke="var(--t4)"
                                        stroke-width="1.2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        ><path
                                            d="M18 20V10M12 20V4M6 20v-6"
                                        /></svg
                                    >
                                    <p>Chưa ghi nhận lệnh gọi API nào</p>
                                    <span
                                        >Bắt đầu trò chuyện với AI để xem dữ
                                        liệu sử dụng tại đây</span
                                    >
                                </div>
                            {:else}
                                <div class="stg-card-stack">
                                    <section class="stg-card">
                                        <header class="stg-card-hd">
                                            <span
                                                class="stg-card-icon"
                                                aria-hidden="true"
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    width="14"
                                                    height="14"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2"
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    ><line
                                                        x1="18"
                                                        y1="20"
                                                        x2="18"
                                                        y2="10"
                                                    /><line
                                                        x1="12"
                                                        y1="20"
                                                        x2="12"
                                                        y2="4"
                                                    /><line
                                                        x1="6"
                                                        y1="20"
                                                        x2="6"
                                                        y2="14"
                                                    /></svg
                                                >
                                            </span>
                                            <div class="stg-card-titles">
                                                <h3 class="stg-card-title">
                                                    Tổng quan
                                                </h3>
                                                <p class="stg-card-sub">
                                                    Tổng hợp lệnh gọi, token và
                                                    chi phí ước tính trên toàn
                                                    bộ hoạt động AI.
                                                </p>
                                            </div>
                                            {#if showResetConfirm}
                                                <div class="ai-reset-confirm">
                                                    <span>Đặt lại toàn bộ dữ liệu?</span>
                                                    <button
                                                        class="ai-action-btn danger sm"
                                                        onclick={handleResetUsage}
                                                        >Đặt lại</button
                                                    >
                                                    <button
                                                        class="ai-action-btn sm"
                                                        onclick={() =>
                                                            (showResetConfirm = false)}
                                                        >Hủy</button
                                                    >
                                                </div>
                                            {:else}
                                                <button
                                                    class="ai-action-btn sm"
                                                    onclick={() =>
                                                        (showResetConfirm = true)}
                                                >
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        width="11"
                                                        height="11"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="1.8"
                                                        ><polyline
                                                            points="3 6 5 6 21 6"
                                                        /><path
                                                            d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
                                                        /></svg
                                                    >
                                                    Đặt lại
                                                </button>
                                            {/if}
                                        </header>
                                        <div class="stg-card-body">
                                            <div class="ai-summary-grid">
                                                <div class="ai-summary-card">
                                                    <span class="ai-summary-val"
                                                        >{aiUsageStats.reduce(
                                                            (s, v) =>
                                                                s +
                                                                v.totalCalls,
                                                            0,
                                                        )}</span
                                                    >
                                                    <span class="ai-summary-lbl"
                                                        >Tổng lệnh gọi</span
                                                    >
                                                </div>
                                                <div class="ai-summary-card">
                                                    <span class="ai-summary-val"
                                                        >{formatTokens(
                                                            aiUsageStats.reduce(
                                                                (s, v) =>
                                                                    s +
                                                                    v.inputTokens,
                                                                0,
                                                            ),
                                                        )}</span
                                                    >
                                                    <span class="ai-summary-lbl"
                                                        >Token đầu vào</span
                                                    >
                                                </div>
                                                <div class="ai-summary-card">
                                                    <span class="ai-summary-val"
                                                        >{formatTokens(
                                                            aiUsageStats.reduce(
                                                                (s, v) =>
                                                                    s +
                                                                    v.outputTokens,
                                                                0,
                                                            ),
                                                        )}</span
                                                    >
                                                    <span class="ai-summary-lbl"
                                                        >Token đầu ra</span
                                                    >
                                                </div>
                                                <div
                                                    class="ai-summary-card accent"
                                                >
                                                    <span class="ai-summary-val"
                                                        >{estimateCost(
                                                            aiUsageStats.reduce(
                                                                (s, v) =>
                                                                    s +
                                                                    v.inputTokens,
                                                                0,
                                                            ),
                                                            aiUsageStats.reduce(
                                                                (s, v) =>
                                                                    s +
                                                                    v.outputTokens,
                                                                0,
                                                            ),
                                                        )}</span
                                                    >
                                                    <span class="ai-summary-lbl"
                                                        >Chi phí ước tính</span
                                                    >
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    <section class="stg-card">
                                        <header class="stg-card-hd">
                                            <span
                                                class="stg-card-icon"
                                                aria-hidden="true"
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    width="14"
                                                    height="14"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2"
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    ><polygon
                                                        points="12 2 2 7 12 12 22 7 12 2"
                                                    /><polyline
                                                        points="2 17 12 22 22 17"
                                                    /><polyline
                                                        points="2 12 12 17 22 12"
                                                    /></svg
                                                >
                                            </span>
                                            <div class="stg-card-titles">
                                                <h3 class="stg-card-title">
                                                    Theo chế độ
                                                </h3>
                                                <p class="stg-card-sub">
                                                    Phân tích lệnh gọi AI và
                                                    mức tiêu thụ token theo từng
                                                    chế độ.
                                                </p>
                                            </div>
                                        </header>
                                        <div class="stg-card-body">
                                            <div class="ai-table">
                                                <div class="ai-table-head">
                                                    <span>Chế độ</span>
                                                    <span>Lệnh gọi</span>
                                                    <span>Đầu vào</span>
                                                    <span>Đầu ra</span>
                                                    <span>Chi phí</span>
                                                </div>
                                                {#each aiUsageStats as stat}
                                                    <div class="ai-table-row">
                                                        <span
                                                            class="ai-table-label"
                                                        >
                                                            <span
                                                                class="ai-dot"
                                                                data-mode={stat.mode}
                                                            ></span>
                                                            {stat.mode.toUpperCase()}
                                                        </span>
                                                        <span
                                                            class="ai-table-val"
                                                            >{stat.totalCalls}</span
                                                        >
                                                        <span
                                                            class="ai-table-val"
                                                            >{formatTokens(
                                                                stat.inputTokens,
                                                            )}</span
                                                        >
                                                        <span
                                                            class="ai-table-val"
                                                            >{formatTokens(
                                                                stat.outputTokens,
                                                            )}</span
                                                        >
                                                        <span
                                                            class="ai-table-val accent"
                                                            >{estimateCost(
                                                                stat.inputTokens,
                                                                stat.outputTokens,
                                                            )}</span
                                                        >
                                                    </div>
                                                {/each}
                                            </div>
                                        </div>
                                    </section>

                                    {#if aiProviderStats.length > 0}
                                        <section class="stg-card">
                                            <header class="stg-card-hd">
                                                <span
                                                    class="stg-card-icon"
                                                    aria-hidden="true"
                                                >
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        width="14"
                                                        height="14"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                        ><rect
                                                            x="4"
                                                            y="4"
                                                            width="16"
                                                            height="16"
                                                            rx="2"
                                                        /><rect
                                                            x="9"
                                                            y="9"
                                                            width="6"
                                                            height="6"
                                                        /><line
                                                            x1="9"
                                                            y1="2"
                                                            x2="9"
                                                            y2="4"
                                                        /><line
                                                            x1="15"
                                                            y1="2"
                                                            x2="15"
                                                            y2="4"
                                                        /><line
                                                            x1="9"
                                                            y1="20"
                                                            x2="9"
                                                            y2="22"
                                                        /><line
                                                            x1="15"
                                                            y1="20"
                                                            x2="15"
                                                            y2="22"
                                                        /><line
                                                            x1="20"
                                                            y1="9"
                                                            x2="22"
                                                            y2="9"
                                                        /><line
                                                            x1="20"
                                                            y1="15"
                                                            x2="22"
                                                            y2="15"
                                                        /><line
                                                            x1="2"
                                                            y1="9"
                                                            x2="4"
                                                            y2="9"
                                                        /><line
                                                            x1="2"
                                                            y1="15"
                                                            x2="4"
                                                            y2="15"
                                                        /></svg
                                                    >
                                                </span>
                                                <div class="stg-card-titles">
                                                    <h3 class="stg-card-title">
                                                        Theo nhà cung cấp
                                                    </h3>
                                                    <p class="stg-card-sub">
                                                        Chi phí được nhóm theo
                                                        model — hữu ích khi
                                                        chuyển đổi nhà cung cấp.
                                                    </p>
                                                </div>
                                            </header>
                                            <div class="stg-card-body">
                                                <div class="ai-table">
                                                    <div class="ai-table-head">
                                                        <span>Model</span>
                                                        <span>Lệnh gọi</span>
                                                        <span>Đầu vào</span>
                                                        <span>Đầu ra</span>
                                                        <span>Chi phí</span>
                                                    </div>
                                                    {#each aiProviderStats as pstat}
                                                        <div
                                                            class="ai-table-row"
                                                        >
                                                            <span
                                                                class="ai-table-label"
                                                            >
                                                                <span
                                                                    class="ai-dot"
                                                                    style="background: var(--acc)"
                                                                ></span>
                                                                {formatModelName(
                                                                    pstat.model,
                                                                )}
                                                            </span>
                                                            <span
                                                                class="ai-table-val"
                                                                >{pstat.totalCalls}</span
                                                            >
                                                            <span
                                                                class="ai-table-val"
                                                                >{formatTokens(
                                                                    pstat.inputTokens,
                                                                )}</span
                                                            >
                                                            <span
                                                                class="ai-table-val"
                                                                >{formatTokens(
                                                                    pstat.outputTokens,
                                                                )}</span
                                                            >
                                                            <span
                                                                class="ai-table-val accent"
                                                                >{estimateCost(
                                                                    pstat.inputTokens,
                                                                    pstat.outputTokens,
                                                                )}</span
                                                            >
                                                        </div>
                                                    {/each}
                                                </div>
                                                <p class="ai-pricing-note">
                                                    Haiku 4.5: $1.00 / MTok in
                                                    &middot; $5.00 / MTok out
                                                </p>
                                            </div>
                                        </section>
                                    {/if}
                                </div>
                            {/if}
                        {/if}
                    {/if}
                {:else if activeTab === "agent"}
                    <div class="agent-settings-pane">
                        <!-- Agent sub-tabs -->
                        <div class="ai-subtabs">
                            <button
                                class="ai-subtab"
                                class:active={agentSubTab === "general"}
                                onclick={() => (agentSubTab = "general")}
                            >
                                Chung
                            </button>
                            <button
                                class="ai-subtab"
                                class:active={agentSubTab === "plugins"}
                                onclick={() => (agentSubTab = "plugins")}
                            >
                                Plugin
                            </button>
                            <button
                                class="ai-subtab"
                                class:active={agentSubTab === "contexts"}
                                onclick={() => (agentSubTab = "contexts")}
                            >
                                Bối cảnh
                            </button>
                            <button
                                class="ai-subtab"
                                class:active={agentSubTab === "usage"}
                                onclick={() => (agentSubTab = "usage")}
                            >
                                Thống kê sử dụng
                            </button>
                        </div>

                        <div class="agent-settings-scroll">
                            {#if agentSubTab === "general"}
                                <div class="stg-card-stack">
                                    <section class="stg-card agent-usage-card">
                                        <header class="stg-card-hd">
                                            <span
                                                class="stg-card-icon"
                                                aria-hidden="true"
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    width="14"
                                                    height="14"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2"
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    ><path
                                                        d="M18 20V10M12 20V4M6 20v-6"
                                                    /></svg
                                                >
                                            </span>
                                            <div class="stg-card-titles">
                                                <h3 class="stg-card-title">
                                                    Theo dõi mức sử dụng trực tiếp
                                                </h3>
                                                <p class="stg-card-sub">
                                                    Cấu hình giới hạn nhà cung
                                                    cấp hiển thị ở chân Agent.
                                                </p>
                                            </div>
                                            {#if agentFooterProvider === "claude" && agentSessionKey && $agentUsageAuthStatus.state === "valid"}
                                                <span class="ai-status-badge">
                                                    <span class="ai-status-dot"
                                                    ></span>
                                                    Claude đã kết nối
                                                </span>
                                            {:else if agentFooterProvider === "claude" && agentSessionKey && $agentUsageAuthStatus.state === "checking"}
                                                <span
                                                    class="ai-status-badge checking"
                                                >
                                                    <span class="ai-status-dot"
                                                    ></span>
                                                    Đang kiểm tra Claude
                                                </span>
                                            {:else if agentFooterProvider === "claude" && agentSessionKey && $agentUsageAuthStatus.state === "invalid"}
                                                <span
                                                    class="ai-status-badge error"
                                                    title={$agentUsageAuthStatus.message}
                                                >
                                                    <span class="ai-status-dot"
                                                    ></span>
                                                    Claude cần cấu hình lại
                                                </span>
                                            {:else if agentFooterProvider === "codex" && agentCodexToken}
                                                <span class="ai-status-badge">
                                                    <span class="ai-status-dot"
                                                    ></span>
                                                    Codex đã cấu hình
                                                </span>
                                            {:else}
                                                <span
                                                    class="ai-status-badge muted"
                                                >
                                                    Chân trang chưa cấu hình
                                                </span>
                                            {/if}
                                        </header>
                                        <div class="stg-card-body">
                                            <div class="stg-card-row">
                                                <div
                                                    class="stg-card-row-action-text"
                                                >
                                                    <span
                                                        class="stg-card-row-label"
                                                        >Hiển thị ở chân Agent</span
                                                    >
                                                    <span
                                                        class="stg-card-row-help"
                                                    >
                                                        Chọn nhà cung cấp có
                                                        giới hạn trực tiếp hiển
                                                        thị bên cạnh terminal
                                                        Agent.
                                                    </span>
                                                </div>
                                                <select
                                                    class="stg-select"
                                                    value={agentFooterProvider}
                                                    onchange={(e) =>
                                                        handleSettingChange(
                                                            "agent_footer_usage_provider",
                                                            e.currentTarget
                                                                .value,
                                                        )}
                                                >
                                                    <option
                                                        value="claude"
                                                        disabled={!agentSessionKey}
                                                        >Claude Code{agentSessionKey
                                                            ? ""
                                                            : " (chưa cấu hình)"}</option
                                                    >
                                                    <option
                                                        value="codex"
                                                        disabled={!agentCodexToken}
                                                        >Codex{agentCodexToken
                                                            ? ""
                                                            : " (chưa cấu hình)"}</option
                                                    >
                                                    <option value="gemini"
                                                        >Gemini (chỉ dữ liệu
                                                        cục bộ)</option
                                                    >
                                                    <option value="opencode"
                                                        >OpenCode (chỉ dữ liệu
                                                        cục bộ)</option
                                                    >
                                                </select>
                                            </div>

                                            <div
                                                class="stg-card-row stg-card-row-action"
                                            >
                                                <div
                                                    class="stg-card-row-action-text"
                                                >
                                                    <span
                                                        class="stg-card-row-label"
                                                        >Session key của Claude</span
                                                    >
                                                    <span
                                                        class="stg-card-row-help"
                                                    >
                                                        Chỉ dùng để đọc giới
                                                        hạn sử dụng của Claude.
                                                        Tìm trong claude.ai
                                                        DevTools > Application >
                                                        Cookies > sessionKey.
                                                    </span>
                                                    {#if agentKeyTestStatus === "success"}
                                                        <span
                                                            class="ai-test-result success"
                                                        >
                                                            <svg
                                                                viewBox="0 0 24 24"
                                                                width="12"
                                                                height="12"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                stroke-width="2"
                                                                ><polyline
                                                                    points="20 6 9 17 4 12"
                                                                /></svg
                                                            >
                                                            {agentKeyTestMessage}
                                                        </span>
                                                    {:else if agentKeyTestStatus === "error"}
                                                        <span
                                                            class="ai-test-result error"
                                                        >
                                                            <svg
                                                                viewBox="0 0 24 24"
                                                                width="12"
                                                                height="12"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                stroke-width="2"
                                                                ><circle
                                                                    cx="12"
                                                                    cy="12"
                                                                    r="10"
                                                                /><line
                                                                    x1="15"
                                                                    y1="9"
                                                                    x2="9"
                                                                    y2="15"
                                                                /><line
                                                                    x1="9"
                                                                    y1="9"
                                                                    x2="15"
                                                                    y2="15"
                                                                /></svg
                                                            >
                                                            {agentKeyTestMessage}
                                                        </span>
                                                    {:else if agentSessionKey && $agentUsageAuthStatus.state === "invalid"}
                                                        <span
                                                            class="ai-test-result error"
                                                        >
                                                            {$agentUsageAuthStatus.message}
                                                        </span>
                                                    {/if}
                                                </div>
                                                <div
                                                    class="agent-session-key-control"
                                                >
                                                    <div
                                                        class="ai-key-input-wrap"
                                                    >
                                                        <input
                                                            class="ai-cfg-input"
                                                            type={showAgentKey
                                                                ? "text"
                                                                : "password"}
                                                            placeholder="sk-ant-sid01-..."
                                                            bind:value={
                                                                agentKeyInput
                                                            }
                                                            onblur={commitAgentKeyIfChanged}
                                                            onkeydown={(e) => {
                                                                if (
                                                                    e.key ===
                                                                    "Enter"
                                                                ) {
                                                                    e.preventDefault();
                                                                    commitAgentKeyIfChanged();
                                                                }
                                                            }}
                                                        />
                                                        <button
                                                            class="ai-key-toggle"
                                                            onclick={() =>
                                                                (showAgentKey =
                                                                    !showAgentKey)}
                                                            type="button"
                                                            title={showAgentKey
                                                                ? "Ẩn khóa"
                                                                : "Hiện khóa"}
                                                        >
                                                            {#if showAgentKey}
                                                                <svg
                                                                    viewBox="0 0 24 24"
                                                                    width="14"
                                                                    height="14"
                                                                    fill="none"
                                                                    stroke="currentColor"
                                                                    stroke-width="1.8"
                                                                    ><path
                                                                        d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"
                                                                    /><line
                                                                        x1="1"
                                                                        y1="1"
                                                                        x2="23"
                                                                        y2="23"
                                                                    /></svg
                                                                >
                                                            {:else}
                                                                <svg
                                                                    viewBox="0 0 24 24"
                                                                    width="14"
                                                                    height="14"
                                                                    fill="none"
                                                                    stroke="currentColor"
                                                                    stroke-width="1.8"
                                                                    ><path
                                                                        d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                                                                    /><circle
                                                                        cx="12"
                                                                        cy="12"
                                                                        r="3"
                                                                    /></svg
                                                                >
                                                            {/if}
                                                        </button>
                                                    </div>
                                                    <div
                                                        class="agent-session-key-actions"
                                                    >
                                                        {#if agentKeyTestStatus === "testing"}
                                                            <span
                                                                class="ai-test-result"
                                                                >Đang xác minh…</span
                                                            >
                                                        {/if}
                                                        {#if agentSessionKey}
                                                            <button
                                                                class="ai-action-btn danger"
                                                                onclick={handleRemoveAgentKey}
                                                                >Xóa</button
                                                            >
                                                        {/if}
                                                    </div>
                                                </div>
                                            </div>

                                            <div
                                                class="stg-card-row stg-card-row-action"
                                            >
                                                <div
                                                    class="stg-card-row-action-text"
                                                >
                                                    <span
                                                        class="stg-card-row-label"
                                                        >Access token của Codex</span
                                                    >
                                                    <span
                                                        class="stg-card-row-help"
                                                    >
                                                        Lấy từ <strong
                                                            >chatgpt.com/codex/cloud/settings/analytics</strong
                                                        >
                                                        → DevTools → Network →
                                                        <code>wham/usage</code>
                                                        →
                                                        <code
                                                            >authorization</code
                                                        >
                                                        header (sau
                                                        <code>Bearer </code>).
                                                    </span>
                                                    {#if codexTokenTestStatus === "success"}
                                                        <span
                                                            class="ai-test-result success"
                                                        >
                                                            <svg
                                                                viewBox="0 0 24 24"
                                                                width="11"
                                                                height="11"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                stroke-width="2.5"
                                                                stroke-linecap="round"
                                                                ><polyline
                                                                    points="20 6 9 17 4 12"
                                                                /></svg
                                                            >
                                                            {codexTokenTestMessage}
                                                        </span>
                                                    {:else if codexTokenTestStatus === "error"}
                                                        <span
                                                            class="ai-test-result error"
                                                        >
                                                            <svg
                                                                viewBox="0 0 24 24"
                                                                width="11"
                                                                height="11"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                stroke-width="2"
                                                                ><circle
                                                                    cx="12"
                                                                    cy="12"
                                                                    r="10"
                                                                /><line
                                                                    x1="15"
                                                                    y1="9"
                                                                    x2="9"
                                                                    y2="15"
                                                                /><line
                                                                    x1="9"
                                                                    y1="9"
                                                                    x2="15"
                                                                    y2="15"
                                                                /></svg
                                                            >
                                                            {codexTokenTestMessage}
                                                        </span>
                                                    {/if}
                                                </div>
                                                <div
                                                    class="agent-session-key-control"
                                                >
                                                    <div
                                                        class="ai-key-input-wrap"
                                                    >
                                                        <input
                                                            class="ai-cfg-input"
                                                            type={showCodexToken
                                                                ? "text"
                                                                : "password"}
                                                            placeholder="Bearer token..."
                                                            bind:value={
                                                                codexTokenInput
                                                            }
                                                            onblur={commitCodexTokenIfChanged}
                                                            onkeydown={(e) => {
                                                                if (
                                                                    e.key ===
                                                                    "Enter"
                                                                ) {
                                                                    e.preventDefault();
                                                                    commitCodexTokenIfChanged();
                                                                }
                                                            }}
                                                        />
                                                        <button
                                                            class="ai-key-toggle"
                                                            onclick={() =>
                                                                (showCodexToken =
                                                                    !showCodexToken)}
                                                            type="button"
                                                            title={showCodexToken
                                                                ? "Ẩn token"
                                                                : "Hiện token"}
                                                        >
                                                            {#if showCodexToken}
                                                                <svg
                                                                    viewBox="0 0 24 24"
                                                                    width="14"
                                                                    height="14"
                                                                    fill="none"
                                                                    stroke="currentColor"
                                                                    stroke-width="1.8"
                                                                    ><path
                                                                        d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"
                                                                    /><line
                                                                        x1="1"
                                                                        y1="1"
                                                                        x2="23"
                                                                        y2="23"
                                                                    /></svg
                                                                >
                                                            {:else}
                                                                <svg
                                                                    viewBox="0 0 24 24"
                                                                    width="14"
                                                                    height="14"
                                                                    fill="none"
                                                                    stroke="currentColor"
                                                                    stroke-width="1.8"
                                                                    ><path
                                                                        d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                                                                    /><circle
                                                                        cx="12"
                                                                        cy="12"
                                                                        r="3"
                                                                    /></svg
                                                                >
                                                            {/if}
                                                        </button>
                                                    </div>
                                                    <div
                                                        class="agent-session-key-actions"
                                                    >
                                                        {#if codexTokenTestStatus === "testing"}
                                                            <span
                                                                class="ai-test-result"
                                                                >Đang xác minh…</span
                                                            >
                                                        {/if}
                                                        {#if agentCodexToken}
                                                            <button
                                                                class="ai-action-btn danger"
                                                                onclick={handleRemoveCodexToken}
                                                                >Xóa</button
                                                            >
                                                        {/if}
                                                    </div>
                                                </div>
                                            </div>

                                            <div class="stg-card-row">
                                                <div
                                                    class="stg-card-row-action-text"
                                                >
                                                    <span
                                                        class="stg-card-row-label"
                                                        >Tần suất làm mới</span
                                                    >
                                                    <span
                                                        class="stg-card-row-help"
                                                    >
                                                        Tần suất Clauge làm mới
                                                        giới hạn trực tiếp khi
                                                        chế độ Agent đang mở.
                                                    </span>
                                                </div>
                                                <select
                                                    class="stg-select"
                                                    value={agentRefreshMins}
                                                    onchange={(e) =>
                                                        handleSettingChange(
                                                            "agent_refresh_mins",
                                                            e.currentTarget
                                                                .value,
                                                        )}
                                                >
                                                    {#each REFRESH_OPTIONS as opt}
                                                        <option
                                                            value={opt.value}
                                                            >{opt.label}</option
                                                        >
                                                    {/each}
                                                </select>
                                            </div>
                                        </div>
                                    </section>

                                    <section class="stg-card">
                                        <header class="stg-card-hd">
                                            <span
                                                class="stg-card-icon"
                                                aria-hidden="true"
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    width="14"
                                                    height="14"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2"
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    ><path
                                                        d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
                                                    /><path
                                                        d="M13.73 21a2 2 0 0 1-3.46 0"
                                                    /></svg
                                                >
                                            </span>
                                            <div class="stg-card-titles">
                                                <h3 class="stg-card-title">
                                                    Thông báo
                                                </h3>
                                                <p class="stg-card-sub">
                                                    Âm thanh và nảy dock khi một
                                                    phiên agent hoàn thành công
                                                    việc.
                                                </p>
                                            </div>
                                        </header>
                                        <div class="stg-card-body">
                                            <div class="stg-card-row">
                                                <label
                                                    class="stg-card-row-label"
                                                    >Bật cảnh báo âm thanh</label
                                                >
                                                <label class="stg-toggle">
                                                    <input
                                                        type="checkbox"
                                                        checked={agentSoundEnabled}
                                                        onchange={(e) =>
                                                            handleSettingChange(
                                                                "agent_sound_enabled",
                                                                String(
                                                                    e
                                                                        .currentTarget
                                                                        .checked,
                                                                ),
                                                            )}
                                                    />
                                                    <span
                                                        class="stg-toggle-slider"
                                                    ></span>
                                                </label>
                                            </div>
                                            <div class="stg-card-row">
                                                <label
                                                    class="stg-card-row-label"
                                                    >Bật nảy dock</label
                                                >
                                                <label class="stg-toggle">
                                                    <input
                                                        type="checkbox"
                                                        checked={agentDockBounceEnabled}
                                                        onchange={(e) =>
                                                            handleSettingChange(
                                                                "agent_dock_bounce_enabled",
                                                                String(
                                                                    e
                                                                        .currentTarget
                                                                        .checked,
                                                                ),
                                                            )}
                                                    />
                                                    <span
                                                        class="stg-toggle-slider"
                                                    ></span>
                                                </label>
                                            </div>
                                        </div>
                                    </section>
                                </div>
                            {:else if agentSubTab === "plugins"}
                                <!-- Plugins pane lays itself out as a flex column that
                         fills the right pane. The provider tab strip and
                         the Installed/Marketplace toggle stay pinned at
                         the top; only the list itself scrolls. Without
                         this wrapper the whole settings pane scrolls when
                         the list grows, which hides the toggle as you
                         scan plugins. -->
                                <div class="agent-plugins-pane">
                                    <!-- CLI provider tab strip — each provider has its own
                         marketplace + installed list. OpenCode isn't here
                         because its plugins are npm packages with no
                         marketplace concept (handled at the runner level). -->
                                    <div class="plugin-provider-tabs">
                                        {#each PLUGIN_PROVIDER_TABS as t}
                                            <button
                                                class="plugin-provider-tab"
                                                class:active={pluginProvider ===
                                                    t.id}
                                                onclick={() =>
                                                    selectPluginProvider(t.id)}
                                                >{t.label}</button
                                            >
                                        {/each}
                                    </div>

                                    <!-- Installed / Marketplace toggle. Codex doesn't
                         have a Clauge-side marketplace browser (installs
                         happen inside the codex TUI), so we hide that
                         half of the toggle and show only Installed. -->
                                    {#if pluginProvider !== "codex"}
                                        <div class="agent-plugin-views">
                                            <button
                                                class="ai-action-btn"
                                                class:primary={pluginView ===
                                                    "installed"}
                                                onclick={() =>
                                                    (pluginView = "installed")}
                                                >Đã cài đặt</button
                                            >
                                            <button
                                                class="ai-action-btn"
                                                class:primary={pluginView ===
                                                    "marketplace"}
                                                onclick={() =>
                                                    (pluginView =
                                                        "marketplace")}
                                                >Marketplace</button
                                            >
                                        </div>
                                    {/if}

                                    {#if pluginProvider === "codex"}
                                        <div
                                            class="plugin-codex-hint"
                                            role="status"
                                        >
                                            <svg
                                                width="14"
                                                height="14"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                            >
                                                <circle
                                                    cx="12"
                                                    cy="12"
                                                    r="10"
                                                /><line
                                                    x1="12"
                                                    y1="16"
                                                    x2="12"
                                                    y2="12"
                                                /><line
                                                    x1="12"
                                                    y1="8"
                                                    x2="12.01"
                                                    y2="8"
                                                />
                                            </svg>
                                            <span>
                                                Codex cài đặt plugin từ bên
                                                trong giao diện riêng của nó —
                                                chạy <code
                                                    >codex</code
                                                >
                                                trong terminal và dùng lệnh
                                                <code>/plugins</code>. Các
                                                plugin đã cài hiển thị tại đây
                                                và có thể bật hoặc tắt.
                                            </span>
                                        </div>
                                    {/if}

                                    {#if pluginView === "installed"}
                                        {#if installedPlugins.length === 0}
                                            <div class="ai-usage-empty">
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    width="36"
                                                    height="36"
                                                    fill="none"
                                                    stroke="var(--t4)"
                                                    stroke-width="1.2"
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    ><path
                                                        d="M20.5 7.27783L12 12.0001M12 12.0001L3.49997 7.27783M12 12.0001L12 21.5001M14 20.6701L12.7 21.4001C12.2 21.6001 11.8 21.6001 11.3 21.4001L4.8 17.7001C4.3 17.4001 4 16.9001 4 16.3001V7.70011C4 7.10011 4.3 6.60011 4.8 6.30011L11.3 2.60011C11.8 2.40011 12.2 2.40011 12.7 2.60011L19.2 6.30011C19.7 6.60011 20 7.10011 20 7.70011V16.3001"
                                                    /></svg
                                                >
                                                <p>Chưa cài đặt plugin nào</p>
                                                <span
                                                    >Duyệt marketplace để cài
                                                    đặt plugin</span
                                                >
                                            </div>
                                        {:else}
                                            <div class="agent-plugin-list">
                                                {#each installedPlugins as plugin}
                                                    <div
                                                        class="agent-plugin-card"
                                                    >
                                                        <div
                                                            class="agent-plugin-info"
                                                        >
                                                            <span
                                                                class="agent-plugin-name"
                                                                >{plugin.name}</span
                                                            >
                                                            <span
                                                                class="agent-plugin-meta"
                                                            >
                                                                {plugin.marketplace}
                                                                {#if plugin.version}
                                                                    <span
                                                                        class="ai-link-sep"
                                                                        >&middot;</span
                                                                    >
                                                                    v{plugin.version}
                                                                {/if}
                                                            </span>
                                                        </div>
                                                        <div
                                                            class="agent-plugin-actions"
                                                        >
                                                            <label
                                                                class="stg-toggle"
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={plugin.enabled}
                                                                    onchange={() =>
                                                                        handleTogglePlugin(
                                                                            plugin.name,
                                                                            !plugin.enabled,
                                                                        )}
                                                                />
                                                                <span
                                                                    class="stg-toggle-slider"
                                                                ></span>
                                                            </label>
                                                            <button
                                                                class="ai-action-btn danger sm"
                                                                onclick={() =>
                                                                    handleUninstallPlugin(
                                                                        plugin.name,
                                                                        plugin.marketplace,
                                                                    )}
                                                            >
                                                                Gỡ cài đặt
                                                            </button>
                                                        </div>
                                                    </div>
                                                {/each}
                                            </div>
                                        {/if}
                                    {:else}
                                        <div class="agent-marketplace-search">
                                            <input
                                                class="stg-input"
                                                type="text"
                                                style="width: 100%;"
                                                placeholder="Tìm plugin..."
                                                bind:value={pluginSearchQuery}
                                            />
                                        </div>
                                        {#if filteredMarketplacePlugins.length === 0}
                                            <div class="ai-usage-empty">
                                                <p>Không tìm thấy plugin nào</p>
                                            </div>
                                        {:else}
                                            <div class="agent-plugin-list">
                                                {#each filteredMarketplacePlugins as plugin}
                                                    <div
                                                        class="agent-plugin-card"
                                                    >
                                                        <div
                                                            class="agent-plugin-info"
                                                        >
                                                            <span
                                                                class="agent-plugin-name"
                                                                >{plugin.name}</span
                                                            >
                                                            <span
                                                                class="agent-plugin-desc"
                                                                >{plugin.description}</span
                                                            >
                                                            {#if plugin.installs != null}
                                                                <span
                                                                    class="agent-plugin-meta"
                                                                    >{plugin.installs.toLocaleString()}
                                                                    lượt cài</span
                                                                >
                                                            {/if}
                                                        </div>
                                                        <div
                                                            class="agent-plugin-actions"
                                                        >
                                                            {#if plugin.installed}
                                                                <span
                                                                    class="ai-status-badge"
                                                                >
                                                                    <span
                                                                        class="ai-status-dot"
                                                                    ></span>
                                                                    Đã cài đặt
                                                                </span>
                                                            {:else}
                                                                <button
                                                                    class="ai-action-btn primary sm"
                                                                    onclick={() =>
                                                                        handleInstallPlugin(
                                                                            plugin.name,
                                                                            plugin.marketplace,
                                                                        )}
                                                                >
                                                                    Cài đặt
                                                                </button>
                                                            {/if}
                                                        </div>
                                                    </div>
                                                {/each}
                                            </div>
                                        {/if}
                                    {/if}
                                </div>
                                <!-- /.agent-plugins-pane -->
                            {:else if agentSubTab === "contexts"}
                                {#if isNewContext || editingContext}
                                    <!-- Context editor -->
                                    <div class="agent-ctx-editor">
                                        <div
                                            class="stg-field"
                                            style="flex-direction: column; align-items: stretch;"
                                        >
                                            <label class="stg-label">Tên</label
                                            >
                                            <input
                                                class="stg-input"
                                                type="text"
                                                style="width: 100%;"
                                                placeholder="Tên bối cảnh..."
                                                bind:value={editContextName}
                                            />
                                        </div>
                                        <div
                                            class="stg-field"
                                            style="flex-direction: column; align-items: stretch;"
                                        >
                                            <label class="stg-label"
                                                >Nội dung</label
                                            >
                                            <textarea
                                                class="agent-ctx-textarea"
                                                placeholder="Nội dung bối cảnh..."
                                                bind:value={editContextContent}
                                            ></textarea>
                                        </div>
                                        <div class="ai-key-actions">
                                            <button
                                                class="ai-action-btn primary"
                                                onclick={handleSaveAgentContext}
                                                >Lưu</button
                                            >
                                            <button
                                                class="ai-action-btn"
                                                onclick={cancelEditContext}
                                                >Hủy</button
                                            >
                                        </div>
                                    </div>
                                {:else}
                                    <div class="agent-ctx-header">
                                        <span
                                            class="stg-section-label"
                                            style="margin-bottom: 0;"
                                            >Bối cảnh</span
                                        >
                                        <button
                                            class="ai-action-btn primary sm"
                                            onclick={startNewContext}
                                            >Bối cảnh mới</button
                                        >
                                    </div>

                                    {#if agentContexts.length === 0}
                                        <div class="ai-usage-empty">
                                            <svg
                                                viewBox="0 0 24 24"
                                                width="36"
                                                height="36"
                                                fill="none"
                                                stroke="var(--t4)"
                                                stroke-width="1.2"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                ><path
                                                    d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
                                                /><polyline
                                                    points="14 2 14 8 20 8"
                                                /><line
                                                    x1="16"
                                                    y1="13"
                                                    x2="8"
                                                    y2="13"
                                                /><line
                                                    x1="16"
                                                    y1="17"
                                                    x2="8"
                                                    y2="17"
                                                /><polyline
                                                    points="10 9 9 9 8 9"
                                                /></svg
                                            >
                                            <p>Chưa có bối cảnh nào</p>
                                            <span
                                                >Tạo một bối cảnh để gắn vào
                                                các phiên agent</span
                                            >
                                        </div>
                                    {:else}
                                        <div class="agent-plugin-list">
                                            {#each agentContexts as ctx}
                                                <div
                                                    class="agent-plugin-card agent-ctx-card"
                                                    onclick={() =>
                                                        startEditContext(ctx)}
                                                    role="button"
                                                    tabindex="0"
                                                    onkeydown={(e) => {
                                                        if (e.key === "Enter")
                                                            startEditContext(
                                                                ctx,
                                                            );
                                                    }}
                                                >
                                                    <div
                                                        class="agent-plugin-info"
                                                    >
                                                        <span
                                                            class="agent-plugin-name"
                                                            >{ctx.name}</span
                                                        >
                                                        <span
                                                            class="agent-plugin-desc"
                                                            >{ctx.content
                                                                .split("\n")[0]
                                                                .slice(
                                                                    0,
                                                                    80,
                                                                )}{ctx.content
                                                                .length > 80
                                                                ? "..."
                                                                : ""}</span
                                                        >
                                                    </div>
                                                    <div
                                                        class="agent-plugin-actions"
                                                        onclick={(e) => {
                                                            e.stopPropagation();
                                                        }}
                                                    >
                                                        {#if deleteConfirmId === ctx.id}
                                                            <span
                                                                class="ai-reset-confirm"
                                                            >
                                                                <span
                                                                    >Xóa?</span
                                                                >
                                                                <button
                                                                    class="ai-action-btn danger sm"
                                                                    onclick={(
                                                                        e,
                                                                    ) => {
                                                                        e.stopPropagation();
                                                                        handleDeleteAgentContext(
                                                                            ctx.id,
                                                                        );
                                                                    }}
                                                                    >Có</button
                                                                >
                                                                <button
                                                                    class="ai-action-btn sm"
                                                                    onclick={(
                                                                        e,
                                                                    ) => {
                                                                        e.stopPropagation();
                                                                        deleteConfirmId =
                                                                            null;
                                                                    }}
                                                                    >Không</button
                                                                >
                                                            </span>
                                                        {:else}
                                                            <button
                                                                class="ai-action-btn danger sm"
                                                                onclick={(
                                                                    e,
                                                                ) => {
                                                                    e.stopPropagation();
                                                                    deleteConfirmId =
                                                                        ctx.id;
                                                                }}
                                                                >Xóa</button
                                                            >
                                                        {/if}
                                                    </div>
                                                </div>
                                            {/each}
                                        </div>
                                    {/if}
                                {/if}
                            {:else if agentSubTab === "usage"}
                                <!-- Day range selector -->
                                <div class="ud-days">
                                    {#each [7, 14, 30, 90] as d}
                                        <button
                                            class="ud-day-btn"
                                            class:active={agentUsageDays === d}
                                            onclick={() =>
                                                selectAgentUsageDays(d)}
                                            >{d}d</button
                                        >
                                    {/each}
                                    <button
                                        class="ai-action-btn sm"
                                        style="margin-left: auto;"
                                        onclick={loadAgentUsage}
                                    >
                                        <svg
                                            viewBox="0 0 24 24"
                                            width="11"
                                            height="11"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            ><polyline
                                                points="23 4 23 10 17 10"
                                            /><path
                                                d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
                                            /></svg
                                        >
                                        Làm mới
                                    </button>
                                </div>

                                {#if agentUsageLoading}
                                    <div class="ud-loading">
                                        <div class="ud-spinner"></div>
                                        Đang tải phân tích...
                                    </div>
                                {:else if agentUsageData}
                                    <!-- Summary cards -->
                                    <div class="ud-cards">
                                        <div class="ud-card">
                                            <span class="ud-val"
                                                >{agentFormatCost(
                                                    agentUsageData.totalCost,
                                                )}</span
                                            ><span class="ud-lbl"
                                                >Tổng chi phí</span
                                            >
                                        </div>
                                        <div class="ud-card">
                                            <span class="ud-val"
                                                >{agentUsageData.totalApiCalls.toLocaleString()}</span
                                            ><span class="ud-lbl"
                                                >Lệnh gọi API</span
                                            >
                                        </div>
                                        <div class="ud-card">
                                            <span class="ud-val"
                                                >{agentUsageData.totalSessions}</span
                                            ><span class="ud-lbl">Phiên</span
                                            >
                                        </div>
                                        <div class="ud-card">
                                            <span class="ud-val"
                                                >{agentUsageData.cacheHitPercent.toFixed(
                                                    1,
                                                )}%</span
                                            ><span class="ud-lbl"
                                                >Tỷ lệ Cache</span
                                            >
                                        </div>
                                    </div>

                                    <!-- Token breakdown -->
                                    <div class="ud-token-row">
                                        <span
                                            ><strong>In:</strong>
                                            {agentFormatTokens(
                                                agentUsageData.totalInputTokens,
                                            )}</span
                                        >
                                        <span
                                            ><strong>Out:</strong>
                                            {agentFormatTokens(
                                                agentUsageData.totalOutputTokens,
                                            )}</span
                                        >
                                        <span
                                            ><strong>Cache R:</strong>
                                            {agentFormatTokens(
                                                agentUsageData.totalCacheReadTokens,
                                            )}</span
                                        >
                                        <span
                                            ><strong>Cache W:</strong>
                                            {agentFormatTokens(
                                                agentUsageData.totalCacheWriteTokens,
                                            )}</span
                                        >
                                    </div>

                                    <!-- Daily chart -->
                                    {#if agentUsageData.daily.length > 0}
                                        <div class="ud-section-inline">
                                            <div class="ud-section-title">
                                                Hoạt động hàng ngày
                                            </div>
                                            <div class="ud-chart">
                                                {#each agentUsageData.daily.slice(-21) as day}
                                                    {@const maxCost = Math.max(
                                                        ...agentUsageData.daily
                                                            .slice(-21)
                                                            .map((d) => d.cost),
                                                        0.01,
                                                    )}
                                                    <div
                                                        class="ud-bar-wrap"
                                                        title="{day.date}: {agentFormatCost(
                                                            day.cost,
                                                        )} / {day.calls} lệnh gọi"
                                                    >
                                                        <div
                                                            class="ud-bar"
                                                            style="height:{Math.max(
                                                                3,
                                                                (day.cost /
                                                                    maxCost) *
                                                                    100,
                                                            )}%"
                                                        ></div>
                                                        <span class="ud-bar-lbl"
                                                            >{day.date.slice(
                                                                8,
                                                            )}</span
                                                        >
                                                    </div>
                                                {/each}
                                            </div>
                                        </div>
                                    {/if}
                                    <!-- Live Usage + Models -->
                                    <div class="ud-grid">
                                        <div class="ud-section">
                                            <div class="ud-section-title">
                                                Sử dụng trực tiếp
                                            </div>
                                            {#if $agentUsageLimits}
                                                {@const sessionPct =
                                                    $agentUsageLimits.five_hour
                                                        ?.utilization ??
                                                    $agentUsageLimits.standard
                                                        ?.percentUsed ??
                                                    null}
                                                {@const weeklyPct =
                                                    $agentUsageLimits.seven_day
                                                        ?.utilization ??
                                                    $agentUsageLimits.extended
                                                        ?.percentUsed ??
                                                    null}
                                                {@const sonnetPct =
                                                    $agentUsageLimits
                                                        .seven_day_sonnet
                                                        ?.utilization ?? null}
                                                <div class="ud-live-rows">
                                                    {#if sessionPct != null}
                                                        <div
                                                            class="ud-live-row"
                                                        >
                                                            <span
                                                                class="ud-live-lbl"
                                                                >Phiên</span
                                                            >
                                                            <div
                                                                class="ud-live-bar"
                                                            >
                                                                <div
                                                                    class="ud-live-fill"
                                                                    style="width:{sessionPct}%;background:{agentLiveColor(
                                                                        sessionPct,
                                                                    )}"
                                                                ></div>
                                                            </div>
                                                            <span
                                                                class="ud-live-pct"
                                                                style="color:{agentLiveColor(
                                                                    sessionPct,
                                                                )}"
                                                                >{sessionPct.toFixed(
                                                                    1,
                                                                )}%</span
                                                            >
                                                        </div>
                                                    {/if}
                                                    {#if weeklyPct != null}
                                                        <div
                                                            class="ud-live-row"
                                                        >
                                                            <span
                                                                class="ud-live-lbl"
                                                                >Hàng tuần</span
                                                            >
                                                            <div
                                                                class="ud-live-bar"
                                                            >
                                                                <div
                                                                    class="ud-live-fill"
                                                                    style="width:{weeklyPct}%;background:{agentLiveColor(
                                                                        weeklyPct,
                                                                    )}"
                                                                ></div>
                                                            </div>
                                                            <span
                                                                class="ud-live-pct"
                                                                style="color:{agentLiveColor(
                                                                    weeklyPct,
                                                                )}"
                                                                >{weeklyPct.toFixed(
                                                                    1,
                                                                )}%</span
                                                            >
                                                        </div>
                                                    {/if}
                                                    {#if sonnetPct != null}
                                                        <div
                                                            class="ud-live-row"
                                                        >
                                                            <span
                                                                class="ud-live-lbl"
                                                                >Sonnet</span
                                                            >
                                                            <div
                                                                class="ud-live-bar"
                                                            >
                                                                <div
                                                                    class="ud-live-fill"
                                                                    style="width:{sonnetPct}%;background:{agentLiveColor(
                                                                        sonnetPct,
                                                                    )}"
                                                                ></div>
                                                            </div>
                                                            <span
                                                                class="ud-live-pct"
                                                                style="color:{agentLiveColor(
                                                                    sonnetPct,
                                                                )}"
                                                                >{sonnetPct.toFixed(
                                                                    1,
                                                                )}%</span
                                                            >
                                                        </div>
                                                    {/if}
                                                </div>
                                            {:else}
                                                <div
                                                    style="padding:8px 0;font-size:11px;color:var(--t3);"
                                                >
                                                    Đang lấy dữ liệu trực tiếp...
                                                </div>
                                            {/if}
                                        </div>
                                        <div class="ud-section">
                                            <div class="ud-section-title">
                                                Models
                                            </div>
                                            <div class="ud-scroll">
                                                {#each agentUsageData.byModel as m}
                                                    <div class="ud-row">
                                                        <div
                                                            class="ud-row-info"
                                                        >
                                                            <span
                                                                class="ud-row-name"
                                                                >{m.model}</span
                                                            >
                                                            <span
                                                                class="ud-row-meta"
                                                                >{m.calls} lệnh gọi &middot;
                                                                {m.cacheHitPercent.toFixed(
                                                                    0,
                                                                )}% cache</span
                                                            >
                                                        </div>
                                                        <span
                                                            class="ud-row-cost"
                                                            >{agentFormatCost(
                                                                m.cost,
                                                            )}</span
                                                        >
                                                    </div>
                                                {/each}
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Projects + Top Sessions (2-col) -->
                                    <div class="ud-grid">
                                        <div class="ud-section">
                                            <div class="ud-section-title">
                                                Dự án ({agentUsageData
                                                    .byProject.length})
                                            </div>
                                            <div class="ud-scroll">
                                                {#each agentUsageData.byProject as p}
                                                    <div class="ud-row">
                                                        <div
                                                            class="ud-row-info"
                                                        >
                                                            <span
                                                                class="ud-row-name"
                                                                title={p.project}
                                                                >{agentDecodeName(
                                                                    p.project,
                                                                )}</span
                                                            >
                                                            <span
                                                                class="ud-row-meta"
                                                                >{p.sessions} phiên
                                                                &middot; {p.calls}
                                                                lệnh gọi</span
                                                            >
                                                        </div>
                                                        <span
                                                            class="ud-row-cost"
                                                            >{agentFormatCost(
                                                                p.cost,
                                                            )}</span
                                                        >
                                                    </div>
                                                {/each}
                                            </div>
                                        </div>
                                        <div class="ud-section">
                                            <div class="ud-section-title">
                                                Phiên hàng đầu
                                            </div>
                                            <div class="ud-scroll">
                                                {#each agentUsageData.topSessions.slice(0, 6) as s}
                                                    <div class="ud-row">
                                                        <div
                                                            class="ud-row-info"
                                                        >
                                                            <span
                                                                class="ud-row-name"
                                                                title={s.project}
                                                                >{agentDecodeName(
                                                                    s.project,
                                                                )}</span
                                                            >
                                                            <span
                                                                class="ud-row-meta"
                                                                >{s.model} &middot;
                                                                {s.sessionId.slice(
                                                                    0,
                                                                    8,
                                                                )}</span
                                                            >
                                                        </div>
                                                        <span
                                                            class="ud-row-cost"
                                                            >{agentFormatCost(
                                                                s.cost,
                                                            )}</span
                                                        >
                                                    </div>
                                                {/each}
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Tools + Shell (2-col) -->
                                    <div class="ud-grid">
                                        <div class="ud-section">
                                            <div class="ud-section-title">
                                                Công cụ
                                            </div>
                                            <div class="ud-scroll">
                                                {#each agentUsageData.tools.slice(0, 6) as t}
                                                    <div class="ud-tool-row">
                                                        <span
                                                            class="ud-tool-name"
                                                            >{t.name}</span
                                                        >
                                                        <div
                                                            class="ud-tool-bar"
                                                        >
                                                            <div
                                                                class="ud-tool-fill"
                                                                style="width:{Math.max(
                                                                    3,
                                                                    (t.count /
                                                                        (agentUsageData
                                                                            .tools[0]
                                                                            ?.count ||
                                                                            1)) *
                                                                        100,
                                                                )}%"
                                                            ></div>
                                                        </div>
                                                        <span class="ud-tool-ct"
                                                            >{t.count.toLocaleString()}</span
                                                        >
                                                    </div>
                                                {/each}
                                            </div>
                                        </div>
                                        <div class="ud-section">
                                            <div class="ud-section-title">
                                                Shell
                                            </div>
                                            <div class="ud-scroll">
                                                {#each agentUsageData.shellCommands.slice(0, 6) as cmd}
                                                    <div class="ud-tool-row">
                                                        <span
                                                            class="ud-tool-name"
                                                            style="font-family:var(--mono)"
                                                            >{cmd.name}</span
                                                        >
                                                        <div
                                                            class="ud-tool-bar"
                                                        >
                                                            <div
                                                                class="ud-tool-fill"
                                                                style="width:{Math.max(
                                                                    3,
                                                                    (cmd.count /
                                                                        (agentUsageData
                                                                            .shellCommands[0]
                                                                            ?.count ||
                                                                            1)) *
                                                                        100,
                                                                )}%"
                                                            ></div>
                                                        </div>
                                                        <span class="ud-tool-ct"
                                                            >{cmd.count.toLocaleString()}</span
                                                        >
                                                    </div>
                                                {/each}
                                            </div>
                                        </div>
                                    </div>
                                {:else}
                                    <div class="ud-loading">
                                        <svg
                                            viewBox="0 0 24 24"
                                            width="36"
                                            height="36"
                                            fill="none"
                                            stroke="var(--t4)"
                                            stroke-width="1.2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            ><path
                                                d="M18 20V10M12 20V4M6 20v-6"
                                            /></svg
                                        >
                                        <p
                                            style="margin: 0; font-size: 13px; color: var(--t2); font-weight: 500;"
                                        >
                                            Không tìm thấy dữ liệu sử dụng
                                        </p>
                                        <span
                                            style="font-size: 11px; color: var(--t3);"
                                            >Bắt đầu sử dụng các phiên Claude
                                            Code để xem phân tích tại đây</span
                                        >
                                    </div>
                                {/if}
                            {/if}
                        </div>
                    </div>
                {:else if activeTab === "shortcuts"}
                    <div class="stg-section">
                        <span class="stg-section-label">Phím tắt bàn phím</span
                        >
                        <div class="stg-shortcuts">
                            {#each SHORTCUTS as shortcut}
                                <div class="stg-shortcut-row">
                                    <span class="stg-shortcut-desc"
                                        >{shortcut.desc}</span
                                    >
                                    <span class="stg-shortcut-keys">
                                        {#each shortcut.keys as key, i}
                                            <kbd class="kbd">{key}</kbd>
                                            {#if i < shortcut.keys.length - 1}
                                                <span class="stg-shortcut-plus"
                                                    >+</span
                                                >
                                            {/if}
                                        {/each}
                                    </span>
                                </div>
                            {/each}
                        </div>
                    </div>
                {:else if activeTab === "sql"}
                    <div class="stg-card-stack">
                        <section class="stg-card">
                            <header class="stg-card-hd">
                                <span class="stg-card-icon" aria-hidden="true">
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="14"
                                        height="14"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        ><ellipse
                                            cx="12"
                                            cy="5"
                                            rx="8"
                                            ry="2.5"
                                        /><path
                                            d="M4 5v14c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5"
                                        /><path
                                            d="M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5"
                                        /></svg
                                    >
                                </span>
                                <div class="stg-card-titles">
                                    <h3 class="stg-card-title">
                                        Kết nối & Truy vấn
                                    </h3>
                                    <p class="stg-card-sub">
                                        Giá trị mặc định cho kết nối SQL. Thay
                                        đổi thời gian chờ áp dụng cho kết nối
                                        mới — các pool đang mở giữ giá trị hiện
                                        tại đến khi kết nối lại.
                                    </p>
                                </div>
                            </header>
                            <div class="stg-card-body">
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Thời gian chờ lấy pool (ms)</label
                                    >
                                    <input
                                        class="stg-input"
                                        type="number"
                                        value={sqlAcquireTimeoutMs}
                                        min="1000"
                                        step="1000"
                                        onchange={(e) =>
                                            handleSettingChange(
                                                "sql_acquire_timeout_ms",
                                                e.currentTarget.value,
                                            )}
                                    />
                                </div>
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Thời gian chờ pool nhàn rỗi (phút)</label
                                    >
                                    <input
                                        class="stg-input"
                                        type="number"
                                        value={sqlIdleTimeoutMin}
                                        min="1"
                                        step="1"
                                        onchange={(e) =>
                                            handleSettingChange(
                                                "sql_idle_timeout_min",
                                                e.currentTarget.value,
                                            )}
                                    />
                                </div>
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Thời gian chờ truy vấn HTTP (giây)</label
                                    >
                                    <input
                                        class="stg-input"
                                        type="number"
                                        value={sqlHttpQueryTimeoutSec}
                                        min="5"
                                        step="5"
                                        onchange={(e) =>
                                            handleSettingChange(
                                                "sql_http_query_timeout_sec",
                                                e.currentTarget.value,
                                            )}
                                    />
                                </div>
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Giới hạn trình duyệt schema</label
                                    >
                                    <input
                                        class="stg-input"
                                        type="number"
                                        value={sqlTableListLimit}
                                        min="10"
                                        max="10000"
                                        step="10"
                                        onchange={(e) =>
                                            handleSettingChange(
                                                "sql_table_list_limit",
                                                e.currentTarget.value,
                                            )}
                                    />
                                </div>
                            </div>
                        </section>
                    </div>
                {:else if activeTab === "nosql"}
                    <div class="stg-card-stack">
                        <section class="stg-card">
                            <header class="stg-card-hd">
                                <span class="stg-card-icon" aria-hidden="true">
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="14"
                                        height="14"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        ><path
                                            d="M8 3a2 2 0 00-2 2v4a2 2 0 01-2 2H3a1 1 0 000 2h1a2 2 0 012 2v4a2 2 0 002 2"
                                        /><path
                                            d="M16 3a2 2 0 012 2v4a2 2 0 002 2h1a1 1 0 010 2h-1a2 2 0 00-2 2v4a2 2 0 01-2 2"
                                        /></svg
                                    >
                                </span>
                                <div class="stg-card-titles">
                                    <h3 class="stg-card-title">
                                        Kết nối & Truy vấn
                                    </h3>
                                    <p class="stg-card-sub">
                                        Giá trị mặc định cho kết nối NoSQL.
                                        Thời gian chờ áp dụng cho kết nối mới;
                                        giới hạn find chi phối cả trình xem tài
                                        liệu và đường truy vấn của công cụ AI.
                                    </p>
                                </div>
                            </header>
                            <div class="stg-card-body">
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Thời gian chờ chọn server (ms)</label
                                    >
                                    <input
                                        class="stg-input"
                                        type="number"
                                        value={nosqlServerSelectionTimeoutMs}
                                        min="1000"
                                        step="1000"
                                        onchange={(e) =>
                                            handleSettingChange(
                                                "nosql_server_selection_timeout_ms",
                                                e.currentTarget.value,
                                            )}
                                    />
                                </div>
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Thời gian chờ kết nối (ms)</label
                                    >
                                    <input
                                        class="stg-input"
                                        type="number"
                                        value={nosqlConnectTimeoutMs}
                                        min="1000"
                                        step="1000"
                                        onchange={(e) =>
                                            handleSettingChange(
                                                "nosql_connect_timeout_ms",
                                                e.currentTarget.value,
                                            )}
                                    />
                                </div>
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Giới hạn find mặc định</label
                                    >
                                    <input
                                        class="stg-input"
                                        type="number"
                                        value={nosqlDefaultFindLimit}
                                        min="1"
                                        step="10"
                                        onchange={(e) =>
                                            handleSettingChange(
                                                "nosql_default_find_limit",
                                                e.currentTarget.value,
                                            )}
                                    />
                                </div>
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Giới hạn find tối đa</label
                                    >
                                    <input
                                        class="stg-input"
                                        type="number"
                                        value={nosqlMaxFindLimit}
                                        min="1"
                                        step="10"
                                        onchange={(e) =>
                                            handleSettingChange(
                                                "nosql_max_find_limit",
                                                e.currentTarget.value,
                                            )}
                                    />
                                </div>
                            </div>
                        </section>
                    </div>
                {:else if activeTab === "explorer"}
                    <div class="stg-card-stack">
                        <section class="stg-card">
                            <header class="stg-card-hd">
                                <span class="stg-card-icon" aria-hidden="true">
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="14"
                                        height="14"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        ><path
                                            d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
                                        /></svg
                                    >
                                </span>
                                <div class="stg-card-titles">
                                    <h3 class="stg-card-title">Liệt kê</h3>
                                    <p class="stg-card-sub">
                                        Giá trị mặc định cho trình duyệt tệp
                                        Explorer. Tổng hợp kích thước thư mục
                                        sẽ duyệt qua mọi đối tượng trong từng
                                        thư mục con — chính xác, nhưng thêm
                                        N×trang lượt truy vấn cho mỗi lần liệt
                                        kê trên object store (S3, Azure). Tắt
                                        giúp điều hướng thư mục nhanh trên các
                                        bucket lớn. Thay đổi có hiệu lực ở lần
                                        kết nối tiếp theo.
                                    </p>
                                </div>
                            </header>
                            <div class="stg-card-body">
                                <div class="stg-card-row">
                                    <label class="stg-card-row-label"
                                        >Hiển thị kích thước thư mục (S3, Azure)</label
                                    >
                                    <label class="stg-toggle">
                                        <input
                                            type="checkbox"
                                            checked={explorerShowFolderSizes}
                                            onchange={(e) =>
                                                handleSettingChange(
                                                    "explorer_show_folder_sizes",
                                                    String(
                                                        e.currentTarget.checked,
                                                    ),
                                                )}
                                        />
                                        <span class="stg-toggle-slider"></span>
                                    </label>
                                </div>
                            </div>
                        </section>
                    </div>
                {:else if activeTab === "about"}
                    <div class="stg-card-stack stg-about">
                        <section class="stg-card stg-card-bare about-identity">
                            <div class="about-header">
                                <span class="about-app-name">Clauge</span>
                                <span class="about-version"
                                    >v{appVersion || "—"}</span
                                >
                            </div>
                            <p class="about-desc">
                                Siêu ứng dụng desktop đa nền tảng tích hợp AI
                                dành cho lập trình viên. Một vỏ, nhiều công cụ.
                            </p>
                        </section>

                        <section class="stg-card">
                            <header class="stg-card-hd">
                                <span class="stg-card-icon" aria-hidden="true">
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="14"
                                        height="14"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        ><polyline
                                            points="12 2 2 7 12 12 22 7 12 2"
                                        /><polyline
                                            points="2 17 12 22 22 17"
                                        /><polyline
                                            points="2 12 12 17 22 12"
                                        /></svg
                                    >
                                </span>
                                <div class="stg-card-titles">
                                    <h3 class="stg-card-title">Tech Stack</h3>
                                    <p class="stg-card-sub">
                                        Clauge được xây dựng trên nền tảng nào.
                                    </p>
                                </div>
                            </header>
                            <div class="stg-card-body">
                                <div class="about-tech-grid">
                                    <span class="about-tech-pill">
                                        <svg
                                            viewBox="0 0 106 106"
                                            class="tech-icon"
                                            ><path
                                                d="M103.3 53.1c0-3.8-2-7.2-5.2-10.2-2.1-2-4.7-3.7-7.6-5.2.4-3.5.3-6.7-.4-9.5-1-4-3.2-7-6.5-8.9-3.1-1.8-6.8-2.2-10.6-1.4-2.6.5-5.3 1.6-8 3.1-2.4-2.6-5-4.8-7.8-6.4-4-2.3-8-3.3-11.8-2.8-3.9.5-7.2 2.4-9.6 5.6-1.7 2.3-2.9 5.1-3.7 8.2-3.4-.6-6.6-.6-9.4 0-4 .9-7.2 3-9.3 6.2-2 3-2.5 6.7-1.8 10.5.5 2.6 1.5 5.4 3 8.2-2.7 2.3-4.9 4.9-6.5 7.6-2.3 3.9-3.3 7.9-2.8 11.7.5 3.9 2.4 7.2 5.7 9.6 2.3 1.7 5.2 2.9 8.3 3.6-.6 3.4-.6 6.6 0 9.4.9 3.9 3 7.1 6.2 9.2 3 2 6.7 2.6 10.5 1.9 2.6-.5 5.4-1.6 8.2-3.1 2.4 2.7 5 4.9 7.7 6.5 3.9 2.3 7.9 3.3 11.7 2.8 3.9-.5 7.2-2.4 9.6-5.7 1.7-2.3 2.9-5.2 3.7-8.3 3.4.6 6.6.6 9.4 0 4-.9 7.2-3 9.3-6.2 2-3 2.5-6.7 1.8-10.5-.5-2.6-1.5-5.4-3-8.2 2.7-2.4 4.9-5 6.5-7.7 2.3-3.9 3.3-7.9 2.8-11.7z"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="6"
                                            /></svg
                                        >
                                        Rust
                                    </span>
                                    <span class="about-tech-pill">
                                        <svg
                                            viewBox="0 0 128 128"
                                            class="tech-icon"
                                            ><path
                                                d="M64 0C28.6 0 0 28.6 0 64s28.6 64 64 64 64-28.6 64-64S99.4 0 64 0zm0 110c-25.4 0-46-20.6-46-46S38.6 18 64 18s46 20.6 46 46-20.6 46-46 46z"
                                                fill="currentColor"
                                            /><circle
                                                cx="64"
                                                cy="64"
                                                r="24"
                                                fill="currentColor"
                                            /></svg
                                        >
                                        Tauri v2
                                    </span>
                                    <span class="about-tech-pill">
                                        <svg
                                            viewBox="0 0 24 24"
                                            class="tech-icon"
                                            ><path
                                                d="M12.1 2L1 21h22L12.1 2z"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="1.5"
                                                stroke-linejoin="round"
                                            /></svg
                                        >
                                        SvelteKit
                                    </span>
                                    <span class="about-tech-pill">
                                        <svg
                                            viewBox="0 0 24 24"
                                            class="tech-icon"
                                            ><rect
                                                x="2"
                                                y="3"
                                                width="20"
                                                height="18"
                                                rx="2"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="1.5"
                                            /><text
                                                x="12"
                                                y="16"
                                                text-anchor="middle"
                                                font-size="10"
                                                font-weight="700"
                                                font-family="sans-serif"
                                                fill="currentColor">TS</text
                                            ></svg
                                        >
                                        TypeScript
                                    </span>
                                    <span class="about-tech-pill">
                                        <svg
                                            viewBox="0 0 24 24"
                                            class="tech-icon"
                                            ><ellipse
                                                cx="12"
                                                cy="6"
                                                rx="8"
                                                ry="3"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="1.5"
                                            /><path
                                                d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="1.5"
                                            /><path
                                                d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="1.5"
                                            /></svg
                                        >
                                        SQLite
                                    </span>
                                    <span class="about-tech-pill">
                                        <svg
                                            viewBox="0 0 24 24"
                                            class="tech-icon"
                                            ><polyline
                                                points="16 18 22 12 16 6"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="1.5"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                            /><polyline
                                                points="8 6 2 12 8 18"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="1.5"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                            /></svg
                                        >
                                        CodeMirror
                                    </span>
                                </div>
                            </div>
                        </section>

                        <section class="stg-card">
                            <header class="stg-card-hd">
                                <span class="stg-card-icon" aria-hidden="true">
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="14"
                                        height="14"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        ><path
                                            d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
                                        /><path
                                            d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
                                        /></svg
                                    >
                                </span>
                                <div class="stg-card-titles">
                                    <h3 class="stg-card-title">Liên kết</h3>
                                    <p class="stg-card-sub">
                                        Dự án, lỗi, nhà phát triển, website.
                                    </p>
                                </div>
                            </header>
                            <div class="stg-card-body">
                                <div class="about-links">
                                    <a
                                        class="about-link-btn"
                                        href="https://github.com/ansxuman/Clauge"
                                        target="_blank"
                                        rel="noopener"
                                        title="Kho GitHub"
                                    >
                                        <svg viewBox="0 0 24 24"
                                            ><path
                                                d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22"
                                            /></svg
                                        >
                                        <span>Dự án</span>
                                    </a>
                                    <a
                                        class="about-link-btn"
                                        href="https://github.com/ansxuman/Clauge/issues/new/choose"
                                        target="_blank"
                                        rel="noopener"
                                        title="Báo lỗi"
                                    >
                                        <svg viewBox="0 0 24 24"
                                            ><circle
                                                cx="12"
                                                cy="12"
                                                r="10"
                                            /><path
                                                d="M12 8v4M12 16h.01"
                                            /></svg
                                        >
                                        <span>Báo lỗi</span>
                                    </a>
                                    <a
                                        class="about-link-btn"
                                        href="https://github.com/ansxuman"
                                        target="_blank"
                                        rel="noopener"
                                        title="Nhà phát triển"
                                    >
                                        <svg viewBox="0 0 24 24"
                                            ><path
                                                d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"
                                            /><circle
                                                cx="12"
                                                cy="7"
                                                r="4"
                                            /></svg
                                        >
                                        <span>Nhà phát triển</span>
                                    </a>
                                    <a
                                        class="about-link-btn"
                                        href="https://clauge.in/"
                                        target="_blank"
                                        rel="noopener"
                                        title="Website"
                                    >
                                        <svg viewBox="0 0 24 24"
                                            ><circle
                                                cx="12"
                                                cy="12"
                                                r="10"
                                            /><line
                                                x1="2"
                                                y1="12"
                                                x2="22"
                                                y2="12"
                                            /><path
                                                d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"
                                            /></svg
                                        >
                                        <span>Website</span>
                                    </a>
                                    <a
                                        class="about-link-btn"
                                        href="https://x.com/clauge_in"
                                        target="_blank"
                                        rel="noopener"
                                        title="X / Twitter"
                                    >
                                        <svg viewBox="0 0 24 24"
                                            ><path
                                                d="M4 4l7.5 9.5L4.5 20H7l5.7-6.2L17 20h3l-7.8-9.9L19.5 4H17l-5.2 5.7L8 4H4z"
                                            /></svg
                                        >
                                        <span>X / Twitter</span>
                                    </a>
                                    <a
                                        class="about-link-btn"
                                        href="mailto:support@clauge.in"
                                        title="Hỗ trợ qua Email"
                                    >
                                        <svg viewBox="0 0 24 24"
                                            ><rect
                                                x="3"
                                                y="5"
                                                width="18"
                                                height="14"
                                                rx="2"
                                            /><path
                                                d="M3 7l9 6 9-6"
                                            /></svg
                                        >
                                        <span>Email</span>
                                    </a>
                                </div>
                            </div>
                        </section>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<ConfirmDialog
    bind:show={showClearChatHistoryConfirm}
    title="Xóa lịch sử"
    message={`Thao tác này sẽ xóa ${restHistoryCount.toLocaleString()} yêu cầu khỏi mục Lịch sử và ${aiChatCount.toLocaleString()} tin nhắn trò chuyện Trợ lý AI trên mọi chế độ.\n\nThao tác này không thể hoàn tác.`}
    confirmText="Xóa lịch sử"
    onconfirm={handleClearChatHistory}
/>

<style>
    @import "./SettingsModal.svelte.css";

    /* Settings pane — rendered inside the 'settings' panel slot in
       +page.svelte. Fills the panel (which is the workspace area). */
    .stg-pane {
        flex: 1;
        min-width: 0;
        min-height: 0;
        display: flex;
        background: var(--c);
    }
    /* In glass mode, bump Settings' background opacity so its dense
       text + form rows stay legible (var(--c) is rgba 0.40 — fine
       for chrome surfaces, too translucent for a full content panel).
       glass-surface adds the backdrop-filter blur via app.css. */
    :global(body.glass-mode) .stg-pane {
        background: var(--modal-bg);
    }

    /* ------- Settings cards ------- */
    /* Reusable across all settings tabs (General / REST / AI / Agent /
     About). Each .stg-card has a header (icon + title + subtitle) and a
     body of .stg-card-row rows. */

    .stg-card-stack {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .stg-card {
        border: 1px solid var(--b1);
        border-radius: 10px;
        background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.025) 0%,
            rgba(255, 255, 255, 0.005) 100%
        );
        overflow: hidden;
    }
    /* Frameless variant — no border, no background. Used by the About
     identity block so the app name/version doesn't read as "boxed in". */
    .stg-card.stg-card-bare {
        border: none;
        background: none;
        overflow: visible;
    }
    .about-identity {
        padding: 8px 4px 16px;
    }
    .about-identity .about-header {
        margin-bottom: 6px;
    }
    .about-identity .about-desc {
        margin: 0;
    }

    .stg-card-hd {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 16px 12px;
    }
    /* Pin the last child of the header to the right (used for trailing
     actions like the AI Overview "Reset" button). The .stg-card-titles
     keeps its natural width so the action floats. */
    .stg-card-hd > :last-child:not(.stg-card-titles):not(.stg-card-icon) {
        margin-left: auto;
        flex-shrink: 0;
    }

    .stg-card-icon {
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        border: 1px solid var(--b1);
        background: var(--surface-hover);
        color: var(--t2);
    }

    .stg-card-titles {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }

    .stg-card-title {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        color: var(--t1);
        font-family: var(--ui);
        letter-spacing: 0;
        text-transform: none;
    }

    .stg-card-sub {
        margin: 0;
        font-size: 11.5px;
        line-height: 1.5;
        color: var(--t3);
        font-family: var(--ui);
    }

    .stg-card-body {
        padding: 4px 16px 14px;
        display: flex;
        flex-direction: column;
    }

    .stg-card-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 0;
        border-top: 1px solid var(--b-subtle, rgba(255, 255, 255, 0.05));
    }
    .stg-card-row:first-child {
        border-top: none;
    }

    .stg-card-row-label {
        font-size: 11.5px;
        font-weight: 500;
        color: var(--t2);
        font-family: var(--ui);
        white-space: nowrap;
    }

    .stg-card-row-help {
        display: block;
        margin-top: 2px;
        font-size: 11px;
        color: var(--t4);
        font-family: var(--ui);
        line-height: 1.4;
        white-space: normal;
    }

    .stg-card-row-action {
        align-items: flex-start;
    }

    .stg-card-row-action-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
    }

    .stg-card-input-lg {
        flex: 1;
        min-width: 0;
        max-width: 240px;
    }

    /* Stat strip — sits between the card header and body. Big numbers,
     small uppercase labels. Mono font keeps everything aligned. */
    .stg-card-stats {
        display: flex;
        align-items: stretch;
        gap: 0;
        margin: 2px 16px 6px;
        padding: 10px 4px;
        border-top: 1px solid var(--b-subtle, rgba(255, 255, 255, 0.05));
        border-bottom: 1px solid var(--b-subtle, rgba(255, 255, 255, 0.05));
    }

    .stg-card-stat {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 0 8px;
        text-align: center;
        min-width: 0;
    }

    .stg-card-stat-num {
        font-family: var(--mono);
        font-size: 16px;
        font-weight: 600;
        color: var(--t1);
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
    }

    .stg-card-stat-lbl {
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--t4);
        font-family: var(--ui);
        font-weight: 500;
    }

    .stg-card-stat-divider {
        width: 1px;
        background: var(--b1);
        margin: 4px 0;
    }

    .stg-card-danger-btn {
        flex-shrink: 0;
        height: 30px;
        padding: 0 14px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 6px;
        border: 1px solid var(--b1);
        background: transparent;
        color: var(--err);
        font-size: 11.5px;
        font-family: var(--ui);
        font-weight: 500;
        cursor: default;
        transition:
            border-color 0.12s,
            background 0.12s,
            color 0.12s;
    }
    .stg-card-danger-btn:hover {
        border-color: var(--err);
        background: rgba(240, 68, 68, 0.08);
    }
    .stg-card-danger-btn:active {
        transform: translateY(1px);
    }

    /* ── MCP card extras ───────────────────────────────────────── */
    .stg-card-mono {
        font-family: var(--mono);
        font-size: 11px;
        background: var(--surface-hover);
        padding: 1px 5px;
        border-radius: 3px;
        color: var(--t2);
    }
    .stg-card-pill {
        margin-left: auto;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 12px;
        border: 1px solid var(--b1);
        background: var(--surface-hover);
        font-family: var(--mono);
        font-size: 10.5px;
        color: var(--t3);
    }
    .stg-card-pill.on {
        border-color: color-mix(in srgb, var(--ok, #1dc880) 40%, var(--b1));
        background: color-mix(in srgb, var(--ok, #1dc880) 10%, transparent);
        color: var(--ok, #1dc880);
    }
    .stg-card-pill-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--t4);
    }
    .stg-card-pill.on .stg-card-pill-dot {
        background: var(--ok, #1dc880);
        box-shadow: 0 0 6px var(--ok, #1dc880);
    }

    .stg-card-token-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        min-width: 0;
    }
    .stg-card-mini-btn {
        flex-shrink: 0;
        height: 26px;
        padding: 0 10px;
        border-radius: 5px;
        border: 1px solid var(--b1);
        background: transparent;
        color: var(--t2);
        font-family: var(--ui);
        font-size: 11px;
        cursor: default;
        transition:
            border-color 0.12s,
            color 0.12s;
    }
    .stg-card-mini-btn:hover:not(:disabled) {
        border-color: var(--b2);
        color: var(--t1);
    }
    .stg-card-mini-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    /* CLI provider tab strip above the plugins panel. Hairline underline
     * on the active tab so it reads as "scope filter" rather than a
     * primary CTA. */
    .plugin-provider-tabs {
        display: flex;
        gap: 4px;
        border-bottom: 1px solid var(--b1);
        margin-bottom: 12px;
    }
    .plugin-provider-tab {
        padding: 8px 14px;
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--t3);
        font-family: var(--ui);
        font-size: 12.5px;
        font-weight: 500;
        cursor: default;
        transition:
            color 0.12s,
            border-color 0.12s;
    }
    .plugin-provider-tab:hover {
        color: var(--t1);
    }
    .plugin-provider-tab.active {
        color: var(--t1);
        border-bottom-color: var(--acc);
    }

    .plugin-codex-hint {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 10px 12px;
        margin: 8px 0 12px;
        background: color-mix(in srgb, var(--acc) 8%, transparent);
        border: 1px solid color-mix(in srgb, var(--acc) 25%, var(--b1));
        border-radius: 8px;
        font-size: 12px;
        line-height: 1.55;
        color: var(--t2);
        font-family: var(--ui);
    }
    .plugin-codex-hint svg {
        flex-shrink: 0;
        margin-top: 2px;
        color: var(--acc);
    }
    .plugin-codex-hint code {
        font-family: var(--mono, monospace);
        font-size: 11px;
        background: var(--c);
        border: 1px solid var(--b1);
        border-radius: 4px;
        padding: 0 5px;
        color: var(--t1);
    }

    /* BYOK add button */
    .byok-add-btn {
        padding: 5px 12px;
        border-radius: var(--radius-md, 6px);
        border: 1px solid var(--b2, var(--b1));
        background: transparent;
        color: var(--t2);
        font-family: var(--ui);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition:
            background 0.12s,
            border-color 0.12s,
            color 0.12s;
    }
    .byok-add-btn:hover {
        background: var(--surface-hover);
        border-color: var(--acc);
        color: var(--t1);
    }

    /* BYOK multi-config section */
    .byok-section {
        margin-top: 1.5rem;
    }
    .byok-section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;
    }
    .byok-section-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        font-family: var(--ui);
        color: var(--t1);
    }
    .byok-empty-state {
        color: var(--t3);
        font-size: 0.875rem;
        font-family: var(--ui);
        text-align: center;
        padding: 1.5rem;
    }
    .byok-config-list {
        list-style: none;
        padding: 0;
        margin: 0;
    }
    .byok-config-row {
        display: grid;
        grid-template-columns: 1fr auto;
        grid-template-areas:
            "info actions"
            "stats stats";
        column-gap: 0.5rem;
        row-gap: 0.45rem;
        align-items: center;
        padding: 0.75rem 1rem;
        border: 1px solid var(--b1);
        border-radius: var(--radius-md, 6px);
        margin-bottom: 0.5rem;
        background: var(--surface-hover, transparent);
    }
    .byok-config-info {
        grid-area: info;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
    }
    .byok-config-actions {
        grid-area: actions;
    }
    .byok-config-stats {
        grid-area: stats;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11.5px;
        color: var(--t3);
        font-family: var(--ui);
        padding-top: 0.4rem;
        border-top: 1px dashed color-mix(in srgb, var(--b1) 80%, transparent);
    }
    .byok-stat {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }
    .byok-stat strong {
        color: var(--t2);
        font-weight: 600;
    }
    .byok-stat.muted {
        font-style: italic;
        opacity: 0.7;
    }
    .byok-stat-sep {
        opacity: 0.5;
    }
    .byok-config-label {
        font-weight: 500;
        font-family: var(--ui);
        font-size: 13px;
        color: var(--t1);
    }
    .byok-default-badge {
        padding: 0.125rem 0.5rem;
        font-size: 0.7rem;
        font-family: var(--ui);
        background: var(--acc);
        color: #fff;
        border-radius: 3px;
        flex-shrink: 0;
    }
    .byok-config-provider {
        color: var(--t3);
        font-size: 0.85rem;
        font-family: var(--ui);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .byok-config-actions-inner {
        display: flex;
        gap: 0.5rem;
        flex-shrink: 0;
    }
    .byok-btn-link {
        background: transparent;
        border: 0;
        color: var(--acc);
        cursor: pointer;
        font-size: 0.85rem;
        font-family: var(--ui);
        padding: 0;
    }
    .byok-btn-link.danger {
        color: var(--err, #ff6b6b);
    }
    .byok-btn-link:hover {
        text-decoration: underline;
    }
</style>
