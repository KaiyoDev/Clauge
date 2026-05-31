<script lang="ts">
    import "../app.css";
    // Install the console.* → Rust log forwarder BEFORE any other
    // import runs, so startup-time `console.log` / errors / unhandled
    // rejections from imported modules land in the rolling log file
    // alongside Rust events. Idempotent.
    import { installLogForwarder } from "$lib/utils/log";
    installLogForwarder();
    import Sidebar from "$lib/components/sidebar/Sidebar.svelte";
    import NavPanel from "$lib/components/nav/NavPanel.svelte";
    import Topbar from "$lib/components/topbar/Topbar.svelte";
    import StatusBar from "$lib/components/statusbar/StatusBar.svelte";
    import CatsParade from "$lib/components/effects/CatsParade.svelte";
    import Embers from "$lib/components/effects/Embers.svelte";
    import PetalFall from "$lib/components/effects/PetalFall.svelte";
    import Starfield from "$lib/components/effects/Starfield.svelte";
    import Toast from "$lib/shared/primitives/Toast.svelte";
    import ContextMenu from "$lib/shared/primitives/ContextMenu.svelte";
    import EnvManagerModal from "$lib/components/env/EnvManagerModal.svelte";
    import {
        loadAgentSessions,
        loadAgentContexts,
    } from "$lib/modes/agent/stores";
    import { getPurposeColor } from "$lib/modes/agent/ai/prompt";
    import NewSessionModal from "$lib/modes/agent/components/NewSessionModal.svelte";
    import EditSessionModal from "$lib/modes/agent/components/EditSessionModal.svelte";
    import UsageDashboard from "$lib/modes/agent/components/UsageDashboard.svelte";
    import NewWorkspaceModal from "$lib/modes/workspace/components/NewWorkspaceModal.svelte";
    import {
        loadWorkspaces,
        createNote,
        createBoard,
        activeWorkspaceId,
        workspaces as workspacesStore,
        notesByWorkspace,
        boardsByWorkspace,
        loadNotes as loadWorkspaceNotes,
        loadBoards as loadWorkspaceBoards,
        loadMcpStatus,
        refreshInboxUnread,
    } from "$lib/modes/workspace/stores";
    import { showContextMenu } from "$lib/shared/primitives/contextmenu";
    import favicon from "$lib/assets/favicon.svg";

    import { onMount, onDestroy } from "svelte";
    import {
        loadCollections,
        clearActiveRequest,
        collections,
    } from "$lib/modes/rest/stores";
    import { loadEnvironments } from "$lib/modes/rest/stores";
    import {
        loadConnections as loadSqlConnections,
        loadSqlScripts,
        showSqlConnectionDialog,
        editingSqlConnection,
        handleSqlConnectionSave,
        showSqlDisconnectConfirm,
        sqlDisconnectTarget,
        disconnectFromDb,
        connections as sqlConnections,
    } from "$lib/modes/sql/stores";
    import { showToast } from "$lib/shared/primitives/toast";
    import ConfirmDialog from "$lib/shared/primitives/ConfirmDialog.svelte";
    import {
        loadNoSqlConnections,
        showNoSqlConnectionDialog,
        editingNoSqlConnection,
        handleNoSqlConnectionSave,
        nosqlConnections,
    } from "$lib/modes/nosql/stores";
    import SqlConnectionDialog from "$lib/modes/sql/components/ConnectionDialog.svelte";
    import NoSqlConnectionDialog from "$lib/modes/nosql/components/ConnectionDialog.svelte";
    import {
        loadSettings,
        loadAppearance,
        appearance,
    } from "$lib/stores/settings";
    import { listen } from "@tauri-apps/api/event";
    import { activeModal, aiPanelOpen, mode } from "$lib/stores/app";
    import {
        agentSessionKey,
        agentCodexToken,
        agentFooterProvider,
        loadAgentUsageLimits,
        loadAgentClaudePlan,
        agentSessions,
        activeAgentSession,
    } from "$lib/modes/agent/stores";
    import {
        sshProfiles,
        activeSshProfile,
        loadSshProfiles,
    } from "$lib/modes/ssh/stores";
    import type { SshProfile } from "$lib/modes/ssh/types";
    import {
        explorerConnections,
        loadExplorerConnections,
        activeExplorerConnection,
    } from "$lib/modes/explorer/stores";
    import type { ExplorerConnection } from "$lib/modes/explorer/types";
    import { getSetting } from "$lib/commands/settings";
    import AIPanel from "$lib/components/ai/AIPanel.svelte";
    import {
        tabs,
        addTab,
        activeTabId,
        activateTab,
        openSettingsTab,
        closeTab,
    } from "$lib/shared/stores/tabs";
    import type { AgentSession } from "$lib/modes/agent/types";
    import {
        setupGlobalShortcuts,
        teardownGlobalShortcuts,
    } from "$lib/utils/shortcuts";
    import { isLinux } from "$lib/utils/platform";
    import { applyTheme } from "$lib/utils/theme";
    import ShortcutsOverlay from "$lib/shared/primitives/ShortcutsOverlay.svelte";
    import SaveRequestDialog from "$lib/shared/primitives/SaveRequestDialog.svelte";
    import Onboarding from "$lib/components/onboarding/Onboarding.svelte";
    import RestoreNotice from "$lib/components/RestoreNotice.svelte";
    import WhatsNewModal from "$lib/shared/primitives/WhatsNewModal.svelte";
    import UpdateNotification from "$lib/shared/primitives/UpdateNotification.svelte";
    import SshAuthPromptsModal from "$lib/modes/ssh/components/SshAuthPromptsModal.svelte";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { get } from "svelte/store";
    import {
        SSH_EVENT,
        AGENT_EVENT,
        APP_EVENT,
        EXPLORER_EVENT,
        WORKSPACE_EVENT,
    } from "$lib/shared/constants/events";
    import {
        USAGE_LIMITS_POLL_INTERVAL_MS,
        SPLASH_FADE_OUT_MS,
    } from "$lib/shared/constants/timings";
    import { DEFAULT_ACCENT_COLOR } from "$lib/shared/constants/colors";

    let { children } = $props();

    let showSaveDialog = $state(false);
    let saveDialogTabId = $state(-1);
    let _syncIntervalRemovedInPart2: null = null;
    let usageLimitsInterval: ReturnType<typeof setInterval> | null = null;
    let updateCheckInterval: ReturnType<typeof setInterval> | null = null;

    let showNewSessionModal = $state(false);
    let showEditSessionModal = $state(false);
    let showUsageDashboard = $state(false);
    let showNewWorkspaceModal = $state(false);
    // When set, NewWorkspaceModal runs in edit mode (pre-fills name +
    // project, calls workspaceUpdate). Cleared on modal close.
    let editingWorkspace = $state<
        import("$lib/modes/workspace/types").Workspace | null
    >(null);
    let editSessionTarget = $state<AgentSession | null>(null);
    let showSessionPicker = $state(false);

    function handleAgentNewSession() {
        showNewSessionModal = true;
    }

    function handleNewWorkspace() {
        editingWorkspace = null;
        showNewWorkspaceModal = true;
    }

    function handleEditWorkspace(e: Event) {
        const detail = (e as CustomEvent).detail;
        if (detail?.workspace) {
            editingWorkspace = detail.workspace;
            showNewWorkspaceModal = true;
        }
    }

    /** Topbar + button handler. No workspaces → modal directly. With
     *  workspaces → categorized context menu: each workspace name as a
     *  pseudo-header, its notes + boards inline, and "Create new" at the
     *  bottom (mirrors SQL/SSH pattern). */
    async function handleWorkspaceAddTab(e: Event) {
        const detail = (e as CustomEvent).detail;
        const x = detail?.x ?? 290;
        const y = detail?.y ?? 48;
        const ws = get(workspacesStore);
        if (ws.length === 0) {
            showNewWorkspaceModal = true;
            return;
        }
        // Make sure each workspace has its notes + boards loaded.
        await Promise.all(
            ws.flatMap((w) => [
                get(notesByWorkspace).has(w.id)
                    ? Promise.resolve()
                    : loadWorkspaceNotes(w.id),
                get(boardsByWorkspace).has(w.id)
                    ? Promise.resolve()
                    : loadWorkspaceBoards(w.id),
            ]),
        );
        const items: any[] = [];
        const notesMap = get(notesByWorkspace);
        const boardsMap = get(boardsByWorkspace);
        // Icons must match the workspace identity used elsewhere — 2×2 grid
        // for the workspace itself, document + kanban for its items.
        const wsIcon =
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
        const noteIcon =
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="1.6"/><line x1="8.5" y1="8.5" x2="15.5" y2="8.5"/><line x1="8.5" y1="12" x2="15.5" y2="12"/><line x1="8.5" y1="15.5" x2="13" y2="15.5"/></svg>';
        const boardIcon =
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="6" width="3.5" height="12" rx="0.6"/><rect x="10.25" y="6" width="3.5" height="7" rx="0.6"/><rect x="16.5" y="6" width="3.5" height="10" rx="0.6"/></svg>';
        const {
            tabs: tabsStore,
            addTab,
            activateTab,
        } = await import("$lib/shared/stores/tabs");
        const openItem = (
            kind: "note" | "board",
            id: string,
            label: string,
        ) => {
            const key = `${kind}:${id}`;
            const existing = get(tabsStore).find(
                (t) => t.mode === "workspace" && t.key === key,
            );
            if (existing) activateTab(existing.id);
            else
                addTab(
                    label,
                    "workspace",
                    key,
                    kind === "note" ? "var(--acc)" : "#a78bfa",
                );
            mode.set("workspace");
        };

        ws.forEach((w, idx) => {
            // Workspace name as a clickable header — activates the workspace
            // and closes the menu. Lets the user "open" a workspace in one
            // click without picking a specific item.
            items.push({
                label: w.name.toUpperCase(),
                icon: wsIcon,
                action: () => {
                    activeWorkspaceId.set(w.id);
                    mode.set("workspace");
                },
            });
            const notes = notesMap.get(w.id) ?? [];
            const boards = boardsMap.get(w.id) ?? [];
            boards.forEach((b) => {
                items.push({
                    label: b.name,
                    icon: boardIcon,
                    action: () => openItem("board", b.id, b.name),
                });
            });
            notes.forEach((n) => {
                items.push({
                    label: n.title || "Chưa đặt tên",
                    icon: noteIcon,
                    action: () => openItem("note", n.id, n.title || "Chưa đặt tên"),
                });
            });
            if (idx < ws.length - 1)
                items.push({ label: "", action: () => {}, separator: true });
        });
        showContextMenu(x, y, items, {
            scrollable: true,
            stickyFooter: {
                label: "Tạo workspace mới",
                icon: plusIcon,
                action: () => {
                    showNewWorkspaceModal = true;
                },
            },
        });
    }

    async function handleNewNote(e: Event) {
        const detail = (e as CustomEvent).detail;
        const wsId = detail?.workspaceId ?? get(activeWorkspaceId);
        if (!wsId) return;
        try {
            // Auto-link: if there's an active agent session and its
            // project_path matches this workspace's project_path, hand the
            // session id to the note on creation. The user explicitly asked
            // for this — saves a tap on every new note inside an active
            // session's project. Mismatch (or no active session) → null,
            // and the user can still link manually from the note properties.
            const ws = get(workspacesStore).find((w) => w.id === wsId);
            const session = get(activeAgentSession);
            const linkedSessionId =
                session &&
                ws?.projectPath &&
                session.projectPath === ws.projectPath
                    ? session.id
                    : null;
            const note = await createNote(wsId, "Chưa đặt tên", linkedSessionId);
            // Open the new note in a Topbar tab.
            const {
                addTab,
                activateTab,
                tabs: tabsStore,
            } = await import("$lib/shared/stores/tabs");
            const key = `note:${note.id}`;
            const existing = get(tabsStore).find(
                (t) => t.mode === "workspace" && t.key === key,
            );
            if (existing) activateTab(existing.id);
            else addTab(note.title, "workspace", key, "var(--acc)");
            mode.set("workspace");
        } catch (e) {
            showToast(`Không thể tạo ghi chú: ${e}`, "error");
        }
    }

    async function handleNewBoard(e: Event) {
        const detail = (e as CustomEvent).detail;
        const wsId = detail?.workspaceId ?? get(activeWorkspaceId);
        if (!wsId) return;
        try {
            const board = await createBoard(wsId, "Bảng mới");
            const {
                addTab,
                activateTab,
                tabs: tabsStore,
            } = await import("$lib/shared/stores/tabs");
            const key = `board:${board.id}`;
            const existing = get(tabsStore).find(
                (t) => t.mode === "workspace" && t.key === key,
            );
            if (existing) activateTab(existing.id);
            else addTab(board.name, "workspace", key, "#a78bfa");
            mode.set("workspace");
        } catch (e) {
            showToast(`Không thể tạo bảng: ${e}`, "error");
        }
    }

    function handleAgentShowUsageDashboard() {
        showUsageDashboard = true;
    }

    function handleAgentEditSession(e: Event) {
        const detail = (e as CustomEvent).detail;
        if (detail?.session) {
            editSessionTarget = detail.session;
            showEditSessionModal = true;
        }
    }

    let pickerX = $state(290);
    let pickerY = $state(48);

    function handleAgentAddTab(e: Event) {
        const detail = (e as CustomEvent).detail;
        if (detail?.x) pickerX = detail.x;
        if (detail?.y) pickerY = detail.y;
        const sessions = get(agentSessions);
        if (sessions.length === 0) {
            window.dispatchEvent(new CustomEvent(AGENT_EVENT.NEW_SESSION));
        } else {
            showSessionPicker = true;
        }
    }

    function openSessionTab(session: AgentSession) {
        const currentTabs = get(tabs);
        const existing = currentTabs.find(
            (t) => t.mode === "agent" && t.key === session.id,
        );
        if (existing) {
            activateTab(existing.id);
        } else {
            addTab(
                session.title,
                "agent",
                session.id,
                getPurposeColor(session.purpose),
            );
        }
        activeAgentSession.set(session);
        showSessionPicker = false;
    }

    function pickerNewSession() {
        showSessionPicker = false;
        window.dispatchEvent(new CustomEvent(AGENT_EVENT.NEW_SESSION));
    }

    const sshIcon =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>';
    const folderIcon =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
    const plusIcon =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

    async function handleSshAddTab(e: Event) {
        const detail = (e as CustomEvent).detail;
        const x = detail?.x ?? 290;
        const y = detail?.y ?? 48;
        if (get(sshProfiles).length === 0) {
            try {
                await loadSshProfiles();
            } catch {
                /* ignore */
            }
        }
        if (get(sshProfiles).length === 0) {
            window.dispatchEvent(new CustomEvent(SSH_EVENT.NEW_PROFILE));
            return;
        }
        const items = get(sshProfiles).map((profile: SshProfile) => ({
            label: profile.name,
            sub: `${profile.username}@${profile.host}${profile.port !== 22 ? `:${profile.port}` : ""}`,
            icon: sshIcon,
            action: () => {
                activeSshProfile.set(profile);
                window.dispatchEvent(
                    new CustomEvent(SSH_EVENT.OPEN_TAB, { detail: profile }),
                );
            },
        }));
        showContextMenu(x, y, items, {
            scrollable: true,
            stickyFooter: {
                label: "Profile SSH mới",
                icon: plusIcon,
                action: () =>
                    window.dispatchEvent(
                        new CustomEvent(SSH_EVENT.NEW_PROFILE),
                    ),
            },
        });
    }

    async function handleExplorerAddTab(e: Event) {
        const detail = (e as CustomEvent).detail;
        const x = detail?.x ?? 290;
        const y = detail?.y ?? 48;
        if (get(explorerConnections).length === 0) {
            try {
                await loadExplorerConnections();
            } catch {
                /* ignore */
            }
        }
        if (get(explorerConnections).length === 0) {
            window.dispatchEvent(
                new CustomEvent(EXPLORER_EVENT.ADD_CONNECTION),
            );
            return;
        }
        const items = get(explorerConnections).map(
            (conn: ExplorerConnection) => ({
                label: conn.name,
                sub: explorerSubLine(conn) || explorerKindBadge(conn.kind),
                icon: folderIcon,
                action: () => {
                    activeExplorerConnection.set(conn);
                    window.dispatchEvent(
                        new CustomEvent(EXPLORER_EVENT.OPEN_TAB, {
                            detail: conn,
                        }),
                    );
                },
            }),
        );
        showContextMenu(x, y, items, {
            scrollable: true,
            stickyFooter: {
                label: "Kết nối mới",
                icon: plusIcon,
                action: () =>
                    window.dispatchEvent(
                        new CustomEvent(EXPLORER_EVENT.ADD_CONNECTION),
                    ),
            },
        });
    }

    function explorerKindBadge(kind: string): string {
        switch (kind) {
            case "sftp":
                return "SFTP";
            case "ftp":
                return "FTP";
            case "s3":
                return "S3";
            case "azure_blob":
                return "Azure";
            default:
                return kind.toUpperCase();
        }
    }

    function explorerSubLine(conn: ExplorerConnection): string {
        if (conn.kind === "sftp" || conn.kind === "ftp") {
            const u = conn.username ?? "";
            const h = conn.host ?? "";
            const portSuffix =
                conn.port &&
                ((conn.kind === "sftp" && conn.port !== 22) ||
                    (conn.kind === "ftp" && conn.port !== 21))
                    ? `:${conn.port}`
                    : "";
            return h ? `${u}${u ? "@" : ""}${h}${portSuffix}` : "";
        }
        if (conn.kind === "s3") return conn.s3Bucket ?? "";
        if (conn.kind === "azure_blob")
            return `${conn.azureAccount ?? ""}/${conn.azureContainer ?? ""}`;
        return "";
    }

    async function handleDragStart(e: MouseEvent) {
        if (e.buttons !== 1) return;
        const win = getCurrentWindow();
        if (e.detail === 2) {
            win.toggleMaximize();
        } else {
            win.startDragging();
        }
    }

    // Global drag handler: any element with data-drag-region attr
    function handleGlobalMousedown(e: MouseEvent) {
        const target = e.target as HTMLElement;
        if (
            target.closest("[data-drag-region]") &&
            !target.closest(
                'button, input, select, textarea, a, [role="button"]',
            )
        ) {
            handleDragStart(e);
        }
    }

    async function handleSqlDisconnectConfirm() {
        const target = get(sqlDisconnectTarget);
        if (!target) return;
        try {
            await disconnectFromDb(target.id);
            showToast(`Đã ngắt kết nối khỏi ${target.name}`, "success");
        } catch (err: any) {
            showToast(err.toString(), "error");
        }
        sqlDisconnectTarget.set(null);
    }

    function handleSaveNewRequest(e: Event) {
        const detail = (e as CustomEvent).detail;
        saveDialogTabId = detail?.tabId ?? get(activeTabId);
        showSaveDialog = true;
    }

    function handleTabClosePrompt(e: Event) {
        // This event is handled by Topbar component via its own listener
    }

    onDestroy(() => {
        teardownGlobalShortcuts();
        window.removeEventListener(
            APP_EVENT.SAVE_NEW_REQUEST,
            handleSaveNewRequest,
        );
        window.removeEventListener(
            AGENT_EVENT.NEW_SESSION,
            handleAgentNewSession,
        );
        window.removeEventListener(
            AGENT_EVENT.EDIT_SESSION,
            handleAgentEditSession,
        );
        window.removeEventListener(
            AGENT_EVENT.SHOW_USAGE_DASHBOARD,
            handleAgentShowUsageDashboard,
        );
        window.removeEventListener(AGENT_EVENT.ADD_TAB, handleAgentAddTab);
        window.removeEventListener(SSH_EVENT.ADD_TAB, handleSshAddTab);
        window.removeEventListener(
            EXPLORER_EVENT.ADD_TAB,
            handleExplorerAddTab,
        );
        window.removeEventListener(
            WORKSPACE_EVENT.NEW_WORKSPACE,
            handleNewWorkspace,
        );
        window.removeEventListener(WORKSPACE_EVENT.NEW_NOTE, handleNewNote);
        window.removeEventListener(WORKSPACE_EVENT.NEW_BOARD, handleNewBoard);
        window.removeEventListener(
            WORKSPACE_EVENT.ADD_TAB,
            handleWorkspaceAddTab,
        );
        window.removeEventListener(
            WORKSPACE_EVENT.EDIT_WORKSPACE,
            handleEditWorkspace,
        );
        // Periodic sync removed in Part 2 — Rust scheduler handles auto-push now.
        if (usageLimitsInterval) clearInterval(usageLimitsInterval);
        if (updateCheckInterval) clearInterval(updateCheckInterval);
    });

    function applyAppearanceOnStartup() {
        const config = get(appearance);
        // OS-aware default. On Linux, native vibrancy/blur isn't available
        // (and on older Windows the acrylic fallback is shaky), so when
        // the user hasn't picked a theme yet, start with an opaque one.
        // macOS gets the glass theme as designed. The user can switch
        // freely from Settings — this only affects first boot.
        const defaultTheme = isLinux() ? "dark-solid" : "dark-glass";
        applyTheme(
            config.theme || defaultTheme,
            config.accentColor || DEFAULT_ACCENT_COLOR,
        );
    }


    // Disable macOS autocorrect/autocapitalize on all inputs
    function disableAutocorrect(el: Element) {
        el.setAttribute("autocorrect", "off");
        el.setAttribute("autocapitalize", "off");
        if (!el.hasAttribute("spellcheck"))
            el.setAttribute("spellcheck", "false");
    }

    onMount(async () => {
        // Fade out splash screen now that the layout is mounted
        requestAnimationFrame(() => {
            const splash = document.getElementById("clauge-splash");
            if (splash) {
                splash.classList.add("fade-out");
                setTimeout(() => splash.remove(), SPLASH_FADE_OUT_MS);
            }
        });
        setupGlobalShortcuts();
        window.addEventListener(
            APP_EVENT.SAVE_NEW_REQUEST,
            handleSaveNewRequest,
        );
        window.addEventListener(AGENT_EVENT.NEW_SESSION, handleAgentNewSession);
        window.addEventListener(
            AGENT_EVENT.EDIT_SESSION,
            handleAgentEditSession,
        );
        window.addEventListener(
            AGENT_EVENT.SHOW_USAGE_DASHBOARD,
            handleAgentShowUsageDashboard,
        );
        window.addEventListener(AGENT_EVENT.ADD_TAB, handleAgentAddTab);
        window.addEventListener(SSH_EVENT.ADD_TAB, handleSshAddTab);
        window.addEventListener(EXPLORER_EVENT.ADD_TAB, handleExplorerAddTab);
        window.addEventListener(
            WORKSPACE_EVENT.NEW_WORKSPACE,
            handleNewWorkspace,
        );
        window.addEventListener(WORKSPACE_EVENT.NEW_NOTE, handleNewNote);
        window.addEventListener(WORKSPACE_EVENT.NEW_BOARD, handleNewBoard);
        window.addEventListener(WORKSPACE_EVENT.ADD_TAB, handleWorkspaceAddTab);
        window.addEventListener(
            WORKSPACE_EVENT.EDIT_WORKSPACE,
            handleEditWorkspace,
        );

        // Apply to existing and future inputs/textareas
        document
            .querySelectorAll("input, textarea")
            .forEach(disableAutocorrect);
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node instanceof HTMLElement) {
                        if (node.matches("input, textarea"))
                            disableAutocorrect(node);
                        node.querySelectorAll("input, textarea").forEach(
                            disableAutocorrect,
                        );
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Block right-click and reload shortcuts in production
        if (!import.meta.env.DEV) {
            document.addEventListener("contextmenu", (e) => e.preventDefault());
            document.addEventListener("keydown", (e) => {
                // Block Cmd+R, Cmd+Shift+R, F5
                if ((e.metaKey || e.ctrlKey) && e.key === "r")
                    e.preventDefault();
                if (e.key === "F5") e.preventDefault();
                // Block Cmd+Shift+I (dev tools)
                if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "I")
                    e.preventDefault();
            });
        }

        // Window focus/blur for custom traffic light dimming
        window.addEventListener("blur", () =>
            document.body.classList.add("window-blurred"),
        );
        window.addEventListener("focus", () =>
            document.body.classList.remove("window-blurred"),
        );
        await Promise.all([
            loadCollections(),
            loadEnvironments(),
            loadSettings(),
            loadAppearance(),
            loadSqlConnections(),
            loadSqlScripts(),
            loadNoSqlConnections(),
            loadAgentSessions(),
            loadAgentContexts(),
            loadExplorerConnections(),
            loadWorkspaces(),
            loadMcpStatus(),
            refreshInboxUnread(),
            // (Pre-warm of agent CLI install probes was removed: the
            // New Session modal no longer disables provider tiles based
            // on the result. The spawn-time install check still surfaces
            // the per-provider install guide on first run.)
        ]);

        applyAppearanceOnStartup();

        // Apply chat-history retention once settings are loaded. Backend purges
        // the REST history table; client purges per-mode AI chat in localStorage.
        try {
            const { settings } = await import("$lib/stores/settings");
            const { retentionSeconds } = await import("$lib/modes/rest/stores");
            const { purgeHistory } = await import("$lib/modes/rest/commands");
            const { purgeOldChatMessages } = await import("$lib/stores/app");
            const { get } = await import("svelte/store");
            const seconds = retentionSeconds(
                get(settings)["chat_history_retention"],
            );
            if (seconds !== null) {
                purgeHistory(seconds).catch(() => {});
                purgeOldChatMessages(seconds * 1000);
            }
        } catch {
            /* non-fatal */
        }

        // Refresh MCP status — the Rust setup() task auto-starts the
        // server in the background on app boot, we just need to pull
        // the current state into the frontend store so the topbar
        // indicator + Settings page render correctly on first paint.
        try {
            const { loadMcpStatus } =
                await import("$lib/modes/workspace/stores");
            await loadMcpStatus();
        } catch (e) {
            console.warn("MCP status refresh failed:", e);
        }

        // ── Deep-link: bản local thuần đã gỡ OAuth/cloud. Không còn xử lý
        //    clauge:// (oauth-callback / upgrade / checkout-success). ────────

        // No default tab — user creates tabs by clicking "+" or opening a request

        // ── REST: refresh on MCP-driven mutations ─────────────────────
        // Existing Tauri commands don't emit events because the frontend
        // re-fetches itself after its own calls. MCP writes (agent →
        // workspace MCP server → REST repos) bypass that loop, so we
        // listen here and reload the matching store. Payload:
        // `{ kind: 'collections' | 'requests', collectionId?: string }`.
        listen<{ kind: string; collectionId: string | null }>("rest:changed", async (event) => {
            try {
                const { loadCollections } = await import("$lib/modes/rest/stores");
                await loadCollections();
            } catch (e) {
                console.warn("[REST] refresh-on-change failed:", e);
            }
        }).catch((e) => console.warn("[REST] change listener failed:", e));

        // ── Auto-move workspace cards when their PR merges ──────────────
        // Same focus-debounce pattern. Walks loaded boards, checks each
        // card-with-pr_url's host state via gh/glab, moves the merged
        // ones to the board's first "Done"-like column. Quiet on errors
        // (missing CLI / no network / no access). 5-min debounce
        // matches the cloud pull so we don't double-spam network.
        let lastPrPoll = 0;
        window.addEventListener("focus", async () => {
            if (Date.now() - lastPrPoll < 5 * 60_000) return;
            lastPrPoll = Date.now();
            try {
                const { autoMoveMergedPrs } = await import(
                    "$lib/modes/workspace/autoMove"
                );
                await autoMoveMergedPrs();
            } catch (e) {
                console.warn("[Workspace] auto-move poll:", e);
            }
        });

        // Check for updates silently on startup and show What's New if version changed.
        // Then re-check every 6 hours so long-running sessions don't miss releases.
        try {
            const { checkAndDownloadUpdate, checkWhatsNew } =
                await import("$lib/utils/updater");
            const { getVersion } = await import("@tauri-apps/api/app");
            getVersion()
                .then((v: string) => {
                    checkWhatsNew(v);
                })
                .catch(() => {});
            checkAndDownloadUpdate();
            updateCheckInterval = setInterval(
                () => { checkAndDownloadUpdate().catch(() => {}); },
                6 * 60 * 60_000,
            );
        } catch {
            // Updater not available in dev mode
        }

        // Load Claude plan from keychain
        loadAgentClaudePlan();

        // Hydrate Agent footer credentials + provider from settings, then
        // start the usage-limits poll. Either provider being configured is
        // enough to start polling — the dispatcher inside loadAgentUsageLimits
        // picks which API to hit based on `agentFooterProvider`.
        try {
            const [claudeKey, codexToken, footerProvider] = await Promise.all([
                getSetting("agent_session_key"),
                getSetting("agent_codex_access_token"),
                getSetting("agent_footer_usage_provider"),
            ]);
            if (claudeKey) agentSessionKey.set(claudeKey);
            if (codexToken) agentCodexToken.set(codexToken);
            if (footerProvider === "claude" || footerProvider === "codex") {
                agentFooterProvider.set(footerProvider);
            }
            const haveCreds =
                (claudeKey && (footerProvider ?? "claude") === "claude") ||
                (codexToken && footerProvider === "codex");
            if (haveCreds) {
                loadAgentUsageLimits();
                usageLimitsInterval = setInterval(() => {
                    if (get(mode) === "agent") loadAgentUsageLimits();
                }, USAGE_LIMITS_POLL_INTERVAL_MS);
            }
        } catch {
            /* ignore */
        }
    });
</script>

<svelte:head>
    <link rel="icon" href={favicon} />
</svelte:head>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="app-shell" onmousedown={handleGlobalMousedown}>
    <Sidebar />
    <NavPanel />
    <div class="app-content">
        <Topbar />
        <div class="app-workspace">
            {@render children()}
        </div>
        <StatusBar />
    </div>
    <AIPanel />
</div>

<!-- Premium theme decorations — each renders nothing for non-matching themes. -->
<CatsParade />
<Embers />
<PetalFall />
<Starfield />

{#if showSessionPicker}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="session-picker-overlay"
        onmousedown={() => (showSessionPicker = false)}
    ></div>
    <div class="session-picker" style="top:{pickerY}px;left:{pickerX}px;">
        <div class="session-picker-header">Mở phiên Agent</div>
        <div class="session-picker-list">
            {#each $agentSessions as session (session.id)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    class="session-picker-item"
                    onmousedown={(e) => {
                        e.stopPropagation();
                        openSessionTab(session);
                    }}
                >
                    <span class="session-picker-title">{session.title}</span>
                    <span
                        class="session-picker-badge"
                        style="color: {getPurposeColor(
                            session.purpose,
                        )}; border-color: {getPurposeColor(session.purpose)};"
                        >{session.purpose}</span
                    >
                </div>
            {/each}
        </div>
        <div class="session-picker-footer">
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <button
                class="session-picker-new"
                onmousedown={(e) => {
                    e.stopPropagation();
                    pickerNewSession();
                }}
            >
                + Phiên mới
            </button>
        </div>
    </div>
{/if}

<Toast />
<RestoreNotice />
<ContextMenu />
<EnvManagerModal />
<ShortcutsOverlay
    show={$activeModal === "shortcuts"}
    onclose={() => activeModal.set(null)}
/>
<SaveRequestDialog bind:show={showSaveDialog} tabId={saveDialogTabId} />
<Onboarding />
<WhatsNewModal />
<UpdateNotification />
<SshAuthPromptsModal />
<ConfirmDialog
    bind:show={$showSqlDisconnectConfirm}
    title="Ngắt kết nối"
    message={`Bạn có chắc muốn ngắt kết nối khỏi "${$sqlDisconnectTarget?.name ?? ""}"?`}
    confirmText="Ngắt kết nối"
    onconfirm={handleSqlDisconnectConfirm}
/>
<SqlConnectionDialog
    bind:show={$showSqlConnectionDialog}
    editConnection={$editingSqlConnection}
    onsave={handleSqlConnectionSave}
    onclose={() => editingSqlConnection.set(null)}
/>
<NoSqlConnectionDialog
    bind:show={$showNoSqlConnectionDialog}
    connection={$editingNoSqlConnection}
    onsave={handleNoSqlConnectionSave}
    onclose={() => editingNoSqlConnection.set(null)}
/>
<NewSessionModal bind:show={showNewSessionModal} />
<NewWorkspaceModal
    bind:show={showNewWorkspaceModal}
    editing={editingWorkspace}
    onclose={() => {
        editingWorkspace = null;
    }}
/>
<EditSessionModal
    bind:show={showEditSessionModal}
    bind:session={editSessionTarget}
/>
<UsageDashboard bind:show={showUsageDashboard} />

<style>
    .app-shell {
        display: flex;
        height: 100vh;
        width: 100vw;
        overflow: hidden;
    }
    .app-content {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--c);
    }
    .app-workspace {
        flex: 1;
        min-height: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        position: relative;
    }

    .session-picker-overlay {
        position: fixed;
        inset: 0;
        z-index: 999;
    }

    .session-picker {
        position: fixed;
        z-index: 1000;
        background: var(--n);
        border: 1px solid var(--b1);
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        min-width: 280px;
        max-width: 360px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .session-picker-header {
        padding: 10px 14px 8px;
        font-size: 11px;
        font-family: var(--ui);
        color: var(--t3);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        border-bottom: 1px solid var(--b1);
    }

    .session-picker-list {
        max-height: 320px;
        overflow-y: auto;
        padding: 4px 0;
    }

    .session-picker-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 14px;
        cursor: pointer;
        transition: background 0.12s;
    }

    .session-picker-item:hover {
        background: var(--b1);
    }

    .session-picker-title {
        font-size: 13px;
        font-family: var(--ui);
        color: var(--t1);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .session-picker-footer {
        border-top: 1px solid var(--b1);
        padding: 6px 8px;
    }

    .session-picker-new {
        width: 100%;
        background: none;
        border: none;
        cursor: pointer;
        padding: 7px 10px;
        border-radius: var(--radius-md, 6px);
        font-size: 13px;
        font-family: var(--ui);
        color: var(--agent, #d2a8ff);
        text-align: left;
        transition: background 0.12s;
    }

    .session-picker-new:hover {
        background: var(--b1);
    }
</style>
