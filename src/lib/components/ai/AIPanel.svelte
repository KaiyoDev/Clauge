<script lang="ts">
  import { mod } from '$lib/utils/platform';
  const m = mod();
  import { aiPanelOpen, aiPanelOpenPerMode, mode, getModeChatMessages, setModeChatMessages, clearModeChatMessages, type AppMode } from '$lib/stores/app';
  import { settings } from '$lib/stores/settings';
  import { loadCollections } from '$lib/modes/rest/stores';
  import { activeTabId, draftRequests, openSettingsTab } from '$lib/shared/stores/tabs';
  import { sendChatMessage, generateSessionId } from '$lib/services/ai-chat';
  import { REST_SYSTEM_PROMPT, REST_TOOLS } from '$lib/modes/rest/ai/prompt';
  import { SQL_SYSTEM_PROMPT, SQL_TOOLS } from '$lib/modes/sql/ai/prompt';
  import { NOSQL_SYSTEM_PROMPT, NOSQL_TOOLS } from '$lib/modes/nosql/ai/prompt';
  import { buildSshSystemPrompt, SSH_TOOLS } from '$lib/modes/ssh/ai/prompt';
  import { activeSshProfile } from '$lib/modes/ssh/stores';
  import { redactSecrets } from '$lib/modes/ssh/ai/safety';
  import { showToast } from '$lib/shared/primitives/toast';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import type { AIMessage, ChatMessage, ChatContext, AIActionBlock } from '$lib/types/ai';
  import { get } from 'svelte/store';
  import { onDestroy, onMount } from 'svelte';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { highlightJSON } from '$lib/shared/utils/json-highlight';
  import SshExecuteConfirmModal from '$lib/modes/ssh/components/SshExecuteConfirmModal.svelte';
  import { executeAndCaptureOnSsh } from '$lib/modes/ssh/ai/execute';
  import { parseShell, type RenderAs } from '$lib/modes/ssh/ai/parsers';
  import { digestForModel } from '$lib/modes/ssh/ai/digest';
  import { getSshAutoRun, setSshAutoRun, getAiPanelWidth, setAiPanelWidth } from '$lib/shared/constants/storage';
  import { aiEvent } from '$lib/shared/constants/events';
  import { COPY_FEEDBACK_MS } from '$lib/shared/constants/timings';
  import AIConfigSelector from './AIConfigSelector.svelte';

  marked.setOptions({ breaks: true, gfm: true });

  function renderMarkdown(text: string): string {
    if (!text) return '';
    const html = marked.parse(text) as string;
    return DOMPurify.sanitize(html);
  }

  // Adds a small "Copy" button to the top-right of every <pre> block rendered
  // in the chat. Mode-agnostic — works for SSH commands, SQL queries, JSON, etc.
  // Re-runs on mutation so it covers blocks streamed in mid-message.
  function copyCodeBlockDecorator(node: HTMLElement) {
    const ICON_COPY = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    const ICON_CHECK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 13 10 18 19 7"></polyline></svg>';

    function decorate() {
      const blocks = node.querySelectorAll('pre');
      blocks.forEach((pre) => {
        if ((pre as HTMLElement).dataset.copyDecorated === '1') return;
        (pre as HTMLElement).dataset.copyDecorated = '1';
        const preEl = pre as HTMLElement;
        if (getComputedStyle(preEl).position === 'static') {
          preEl.style.position = 'relative';
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ai-copy-btn';
        btn.innerHTML = ICON_COPY;
        btn.title = 'Sao chép';
        btn.setAttribute('aria-label', 'Sao chép code vào clipboard');
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const code = pre.querySelector('code');
          const text = (code?.textContent ?? pre.textContent ?? '').replace(/\n$/, '');
          try {
            await navigator.clipboard.writeText(text);
            btn.innerHTML = ICON_CHECK;
            btn.classList.add('copied');
            setTimeout(() => {
              btn.innerHTML = ICON_COPY;
              btn.classList.remove('copied');
            }, COPY_FEEDBACK_MS);
          } catch { /* clipboard denied — silent */ }
        });
        preEl.appendChild(btn);
      });
    }

    decorate();
    const observer = new MutationObserver(() => decorate());
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    return {
      destroy() { observer.disconnect(); },
    };
  }

  let messages = $state<AIMessage[]>([]);
  let inputText = $state('');
  let isStreaming = $state(false);
  // svelte-ignore non_reactive_update -- DOM handle (bind:this), chỉ dùng imperative, không đọc reactive
  let chatContainer: HTMLDivElement;
  let cleanup: (() => void) | null = null;
  let currentChatMode = $state('');


  // SSH confirmation modal state — driven by ai:tool_pending events from Rust.
  let sshModalShow = $state(false);
  let sshModalCommand = $state('');
  let sshModalReason = $state('');
  let sshModalTarget = $state('');
  let sshModalToolUseId = $state('');
  let sshModalDecision: ((approved: boolean) => void) | null = null;

  function openSshConfirmModal(command: string, reason: string, target: string, toolUseId: string): Promise<boolean> {
    sshModalCommand = command;
    sshModalReason = reason;
    sshModalTarget = target;
    sshModalToolUseId = toolUseId;
    sshModalShow = true;
    return new Promise<boolean>((resolve) => {
      sshModalDecision = resolve;
    });
  }

  function handleSshApprove() {
    sshModalShow = false;
    const r = sshModalDecision; sshModalDecision = null;
    r?.(true);
  }

  function handleSshCancel() {
    sshModalShow = false;
    const r = sshModalDecision; sshModalDecision = null;
    r?.(false);
  }

  // Per-chat-session tool_pending listener. Installed in sendMessage when SSH
  // mode is active; lives until that chat session's stream completes.
  let activeChatSessionId: string | null = null;

  // ── SSH auto-execute (power-user mode) ─────────────────────────────────────
  // Skips the confirmation modal — AI-invoked execute_shell calls run immediately.
  // Output still streams into the terminal so the user sees what happened.
  // Persisted in localStorage; first-time enable shows a one-time warning.
  let sshAutoRun = $state(false);
  let sshAutoRunWarnShow = $state(false);

  onMount(() => {
    sshAutoRun = getSshAutoRun();
  });

  function toggleSshAutoRun() {
    if (sshAutoRun) {
      // Turning off — silent
      sshAutoRun = false;
      setSshAutoRun(false);
    } else {
      // Turning on — confirm first so the user is unambiguous about what they're enabling
      sshAutoRunWarnShow = true;
    }
  }

  function confirmEnableAutoRun() {
    sshAutoRun = true;
    setSshAutoRun(true);
    sshAutoRunWarnShow = false;
  }

  async function handleSshToolPending(payload: { toolUseId: string; tool: string; command: string; reason: string; renderAs?: string }) {
    if (payload.tool !== 'execute_shell') return;
    const profile = get(activeSshProfile);
    if (!profile) {
      await invoke('ai_resolve_pending_tool', {
        toolUseId: payload.toolUseId,
        output: '[ERROR] No active SSH profile.',
      });
      return;
    }
    // Auto-run mode: skip the modal, execute immediately. User opted in via the
    // header toggle and saw the warning. Output still streams to the visible terminal.
    if (!sshAutoRun) {
      const target = `${profile.username}@${profile.host}`;
      const approved = await openSshConfirmModal(payload.command, payload.reason, target, payload.toolUseId);
      if (!approved) {
        try {
          await invoke('ai_resolve_pending_tool', {
            toolUseId: payload.toolUseId,
            output: '[USER CANCELLED] User declined to run this command.',
          });
        } catch (_) { /* swallow — chat may have ended */ }
        return;
      }
    }
    let safeRaw = '';
    let errored = false;
    try {
      const raw = await executeAndCaptureOnSsh(profile.id, payload.command);
      safeRaw = redactSecrets(raw);
    } catch (e) {
      errored = true;
      safeRaw = `[ERROR] ${e instanceof Error ? e.message : String(e)}`;
    }
    const hint = (payload.renderAs ?? 'auto') as RenderAs;
    const parsed = parseShell(safeRaw, hint);
    const digest = errored
      ? safeRaw
      : (digestForModel(parsed, safeRaw) || '[INFO] Command produced no output.');

    try {
      await invoke('ai_resolve_pending_tool', {
        toolUseId: payload.toolUseId,
        output: digest,
      });
    } catch (_) { /* swallow */ }
  }

  // Resizable panel width
  const MIN_WIDTH = 300;
  const MAX_WIDTH = 700;
  const DEFAULT_WIDTH = 380;
  let panelWidth = $state(getAiPanelWidth(DEFAULT_WIDTH));
  let isDragging = $state(false);

  function startDrag(e: MouseEvent) {
    e.preventDefault();
    isDragging = true;
    const startX = e.clientX;
    const startWidth = panelWidth;

    function onMove(e: MouseEvent) {
      // Panel is on the right, so dragging left increases width
      const delta = startX - e.clientX;
      panelWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
    }

    function onUp() {
      isDragging = false;
      setAiPanelWidth(panelWidth);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Load persisted messages when mode changes
  $effect(() => {
    const m = $mode;
    if (m !== currentChatMode) {
      // Don't switch message arrays while streaming — would corrupt callback references
      if (isStreaming) return;
      // Save current mode's messages before switching
      if (currentChatMode && messages.length > 0) {
        setModeChatMessages(currentChatMode, messages.filter(m => !m.isStreaming));
      }
      currentChatMode = m;
      messages = getModeChatMessages(m);
      // Scroll to bottom after loading persisted messages
      requestAnimationFrame(() => scrollToBottom());
    }
  });

  // Scroll to bottom when panel opens
  $effect(() => {
    if ($aiPanelOpen && messages.length > 0) {
      requestAnimationFrame(() => scrollToBottom());
    }
  });

  // Persist messages after streaming completes
  $effect(() => {
    if (!isStreaming && currentChatMode && messages.length > 0) {
      setModeChatMessages(currentChatMode, messages);
    }
  });

  // Nhà cung cấp AI đang dùng — một id BYOK từ danh mục PROVIDERS, lưu phẳng
  // trong settings dưới khóa `ai_provider`. Mặc định là 'claude'.
  let activeProvider = $derived<string>(
    $settings['ai_provider'] || 'claude'
  );

  // Panel is usable when the active BYOK provider has its key configured.
  let hasApiKey = $derived(
    !!$settings[`ai_api_key_${activeProvider}`]?.trim()
  );

  const modeColors: Record<AppMode, string> = {
    rest: 'var(--acc)',
    sql: 'var(--acc)',
    nosql: 'var(--acc)',
    agent: 'var(--acc)',
    ssh: 'var(--ssh)',
    explorer: 'var(--explorer)',
    workspace: 'var(--acc)',
    history: 'var(--t2)',
  };

  const modeLabels: Record<AppMode, string> = {
    rest: 'REST',
    sql: 'SQL',
    nosql: 'NoSQL',
    agent: 'Agent',
    ssh: 'SSH',
    explorer: 'Explorer',
    workspace: 'Workspace',
    history: 'Lịch sử',
  };

  const modePlaceholders: Record<AppMode, string> = {
    rest: 'vd. POST tạo user với email và role',
    sql: 'vd. top 10 user chi nhiều nhất 30 ngày qua',
    nosql: 'vd. tìm user pro không hoạt động 7 ngày',
    agent: 'Hỏi về các phiên agent của bạn',
    ssh: 'vd. xem dung lượng đĩa trên server này',
    explorer: 'vd. liệt kê tệp lớn trong /var/log',
    workspace: 'Hỏi về ghi chú hoặc bảng của bạn',
    history: 'Hỏi về lịch sử yêu cầu của bạn',
  };

  const modeGuideText: Record<AppMode, string> = {
    rest: 'Mô tả yêu cầu API bạn cần — method, endpoint, headers, body — và tôi sẽ tạo cho bạn.',
    sql: 'Mô tả dữ liệu bạn cần và tôi sẽ viết truy vấn SQL. Hoạt động với các CSDL đã kết nối.',
    nosql: 'Mô tả thứ bạn đang tìm và tôi sẽ tạo truy vấn MongoDB, bộ lọc hoặc aggregation pipeline.',
    agent: 'Chế độ Agent có sẵn trợ lý AI tích hợp qua phiên Claude Code.',
    ssh: 'Yêu cầu lệnh shell để chạy trên server đã kết nối. Lệnh đề xuất hiện dưới dạng code block kèm nút Chèn — lệnh nguy hiểm bị chặn.',
    explorer: 'Duyệt storage từ xa bằng ngôn ngữ tự nhiên: liệt kê, tìm kiếm, đọc, tải lên, tải xuống, đổi tên, xóa. Thao tác thay đổi cần bạn xác nhận.',
    workspace: 'Yêu cầu trợ lý tìm ghi chú, tóm tắt board hoặc soạn trang. Agent ở chế độ Agent có thể chỉnh sửa workspace trực tiếp.',
    history: 'Hỏi về lịch sử yêu cầu của bạn và tôi sẽ giúp bạn tìm điều cần.',
  };

  const toolLabels: Record<string, string> = {
    get_current_request: 'Đang đọc yêu cầu hiện tại...',
    get_current_response: 'Đang đọc phản hồi...',
    list_collections: 'Đang duyệt collection...',
    get_request_details: 'Đang đọc chi tiết yêu cầu...',
    list_environments: 'Đang kiểm tra môi trường...',
    get_history: 'Đang kiểm tra lịch sử...',
    apply_request: 'Đang chuẩn bị yêu cầu...',
    execute_request: 'Đang thực thi yêu cầu...',
    create_request: 'Đang tạo yêu cầu...',
    execute_current_request: 'Đang thực thi yêu cầu hiện tại...',
    execute_collection: 'Đang chạy collection...',
    generate_curl: 'Đang tạo cURL...',
    switch_environment: 'Đang chuyển môi trường...',
    rename_request: 'Đang đổi tên yêu cầu...',
    delete_request: 'Đang xóa yêu cầu...',
    duplicate_request: 'Đang nhân bản yêu cầu...',
    create_collection: 'Đang tạo collection...',
    // SQL tools
    list_connections: 'Đang liệt kê kết nối...',
    list_databases: 'Đang liệt kê CSDL...',
    list_tables: 'Đang liệt kê bảng...',
    describe_table: 'Đang đọc schema bảng...',
    execute_query: 'Đang thực thi truy vấn...',
    apply_query: 'Đang ghi truy vấn vào editor...',
    list_schemas: 'Đang liệt kê schema...',
    // NoSQL tools
    list_nosql_connections: 'Đang liệt kê kết nối...',
    list_nosql_databases: 'Đang liệt kê CSDL...',
    list_nosql_collections: 'Đang liệt kê collection...',
    find_documents: 'Đang tìm tài liệu...',
    count_documents: 'Đang đếm tài liệu...',
    aggregate: 'Đang chạy aggregation...',
    apply_nosql_query: 'Đang ghi truy vấn...',
    redis_list_keys: 'Đang liệt kê khóa Redis...',
    redis_execute: 'Đang thực thi lệnh Redis...',
    sample_documents: 'Đang lấy mẫu tài liệu...',
    insert_documents: 'Đang chèn tài liệu...',
    get_collection_stats: 'Đang lấy thống kê collection...',
    // REST extras
    set_env_variable: 'Đang đặt biến môi trường...',
    search_history: 'Đang tìm trong lịch sử...',
    // SQL extras
    get_schema: 'Đang tải schema CSDL...',
    explain_query: 'Đang chạy EXPLAIN...',
    // (query_result handled as action card)
  };

  // Sync AI panel open state per mode
  $effect(() => {
    const currentMode = $mode;
    const perMode = $aiPanelOpenPerMode;
    aiPanelOpen.set(perMode[currentMode] ?? false);
  });

  onDestroy(() => {
    cleanup?.();
  });

  function close() {
    aiPanelOpen.set(false);
    aiPanelOpenPerMode.update(m => ({ ...m, [$mode]: false }));
  }

  function openAiSettings() {
    close();
    openSettingsTab('ai');
  }

  function openAiByokSettings() {
    close();
    openSettingsTab('ai:byok');
  }

  function openAccountSettings() {
    close();
    openSettingsTab('account');
  }

  function cancelStreaming() {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    // Mark the last message as complete
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.isStreaming) {
      lastMsg.isStreaming = false;
      lastMsg.toolIndicator = undefined;
      if (!lastMsg.content) {
        lastMsg.content = '[Đã hủy]';
      }
    }
    isStreaming = false;
  }

  function clearChat() {
    if (isStreaming) cancelStreaming();
    messages = [];
    clearModeChatMessages($mode);
  }

  function scrollToBottom() {
    if (chatContainer) {
      requestAnimationFrame(() => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      });
    }
  }

  // Local guidance shown in the chat when the SQL tab isn't yet set up
  // to answer a database question. Mirrors the statuses produced by
  // gatherSqlContext(). Returned as plain markdown so the existing
  // renderer handles emphasis/inline-code formatting consistently.
  function sqlContextGuidance(status: string): string {
    if (status === 'no_sql_tab') {
      return "Tôi cần một **tab truy vấn SQL** đang mở để biết làm việc với CSDL nào. Nhấn nút **+** trên thanh tab (hoặc chọn một kết nối từ thanh bên) rồi thử lại.";
    }
    if (status === 'no_binding') {
      return "Tab SQL này chưa gắn với kết nối nào. Hãy chọn một kết nối từ **bộ chọn kết nối** phía trên editor, rồi hỏi lại.";
    }
    if (status === 'database_unselected') {
      return "Đã có kết nối, nhưng chưa chọn **CSDL** cho tab này. Hãy chọn một CSDL từ dropdown cạnh tên kết nối, rồi hỏi lại.";
    }
    return "Tôi cần một tab truy vấn SQL đang mở có gắn kết nối và CSDL trước khi có thể giúp viết truy vấn.";
  }

  // Same idea for NoSQL. Driver-aware so Redis users see "DB index" while
  // MongoDB users see "database". Scope is always the database (not the
  // collection), per the agreed UX: AI works across the whole DB the
  // active tab points at, regardless of which collection is highlighted.
  function nosqlContextGuidance(status: string, driver?: string): string {
    const isRedis = driver === 'redis';
    const dbWord = isRedis ? 'DB index (0-15)' : 'CSDL';
    if (status === 'no_nosql_tab') {
      return "Tôi cần một **tab NoSQL** đang mở để biết làm việc với CSDL nào. Nhấp đúp vào một collection hoặc key prefix trong thanh bên (hoặc chọn một kết nối) rồi thử lại.";
    }
    if (status === 'no_connection') {
      return "Tab NoSQL này chưa gắn với kết nối nào. Hãy chọn một kết nối từ **bộ chọn kết nối** phía trên editor, rồi hỏi lại.";
    }
    if (status === 'disconnected') {
      return "Kết nối gắn với tab này chưa hoạt động. Nhấn vào kết nối trong thanh bên để kết nối lại, rồi hỏi lại.";
    }
    if (status === 'no_database') {
      return `Chưa chọn ${dbWord} trong tab này. Hãy chọn một mục từ dropdown phía trên editor, rồi hỏi lại.`;
    }
    return "Tôi cần một tab NoSQL đang mở có gắn kết nối và CSDL trước khi có thể giúp.";
  }

  async function gatherContext(): Promise<ChatContext> {
    const currentMode = get(mode);
    if (currentMode === 'sql') {
      const { gatherSqlContext } = await import('$lib/modes/sql/ai/context');
      return gatherSqlContext();
    }
    if (currentMode === 'nosql') {
      const { gatherNosqlContext } = await import('$lib/modes/nosql/ai/context');
      return gatherNosqlContext();
    }
    if (currentMode === 'explorer') {
      const { gatherExplorerContext } = await import('$lib/modes/explorer/ai/context');
      return gatherExplorerContext();
    }
    const { gatherRestContext } = await import('$lib/modes/rest/ai/context');
    return gatherRestContext();
  }

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || isStreaming) return;

    // Telemetry: bucketed count of user-sent AI chat messages over 24h.
    // Fire-and-forget; never awaited or rethrown so a registry blip
    // (e.g. backend not yet ready on cold boot) can't block the send.
    invoke('telemetry_bump', { key: 'ai.chat' }).catch(() => {});

    // Resolve provider + api key (BYOK — gọi thẳng nhà cung cấp, không qua
    // máy chủ trung gian). Mặc định 'claude'.
    const provider = $settings['ai_provider'] || 'claude';
    let apiKey = $settings[`ai_api_key_${provider}`] || '';
    let extraHeaders: Record<string, string> | undefined;

    // Add user message
    messages.push({
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });

    // Add empty assistant message for streaming
    messages.push({
      role: 'assistant',
      content: '',
      isStreaming: true,
      timestamp: Date.now(),
    });

    inputText = '';
    isStreaming = true;
    scrollToBottom();

    // Gather context
    const context = await gatherContext();

    // Short-circuit: SQL + NoSQL chats need a bound connection + database
    // before the LLM can answer anything useful. If the user hasn't set
    // one up, reply locally with guidance instead of burning a Clauge AI
    // credit (or a BYOK API call) on an unanswerable prompt. Status is
    // computed in the mode's gather*Context() and surfaced as the
    // `target_status` env var; NoSQL also exposes `target_driver` so we
    // can phrase the message for Mongo vs Redis.
    const currentChatMode = get(mode);
    const targetStatus = context.envVars?.find(v => v.key === 'target_status')?.value;
    if (targetStatus && targetStatus !== 'ready') {
      let guidance: string | null = null;
      if (currentChatMode === 'sql') {
        guidance = sqlContextGuidance(targetStatus);
      } else if (currentChatMode === 'nosql') {
        const driver = context.envVars?.find(v => v.key === 'target_driver')?.value;
        guidance = nosqlContextGuidance(targetStatus, driver);
      }
      if (guidance) {
        const lastIdx = messages.length - 1;
        messages[lastIdx].content = guidance;
        messages[lastIdx].isStreaming = false;
        isStreaming = false;
        scrollToBottom();
        return;
      }
    }

    // Build chat history for API (only role + content, exclude current streaming msg)
    const chatHistory: ChatMessage[] = messages
      .filter(m => !m.isStreaming)
      .map(m => ({ role: m.role, content: m.content }));

    const sessionId = generateSessionId();
    activeChatSessionId = sessionId;
    const lastIdx = messages.length - 1;

    // Listen for SSH execute_shell tool_pending events for THIS chat session.
    // Cleaned up in onDestroy below + when a new chat starts (cleanup chain).
    let _toolPendingOff: UnlistenFn | null = null;
    if (currentChatMode === 'ssh' || get(mode) === 'ssh') {
      _toolPendingOff = await listen<{ toolUseId: string; tool: string; command: string; reason: string; renderAs?: string }>(
        aiEvent.toolPending(sessionId),
        (e) => { handleSshToolPending(e.payload); },
      );
    }

    const MODEL_MAP: Record<string, string> = {
      claude: 'claude-haiku-4-5-20251001',
      groq: 'meta-llama/llama-4-scout-17b-16e-instruct',
      mistral: 'mistral-large-latest',
      openai_gh: 'gpt-4.1-mini',
      nvidia: 'nvidia/nemotron-3-super-120b-a12b',
      openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
      openai_direct: 'gpt-4.1-mini',
      gemini: 'gemini-3.1-flash-lite',
      clauge: 'clauge-managed',
    };
    const modelId = MODEL_MAP[provider] || 'claude-haiku-4-5-20251001';

    cleanup?.();
    const currentMode = get(mode);
    let systemPrompt: string;
    let tools: any[];
    if (currentMode === 'sql') {
      systemPrompt = SQL_SYSTEM_PROMPT;
      tools = SQL_TOOLS;
    } else if (currentMode === 'nosql') {
      systemPrompt = NOSQL_SYSTEM_PROMPT;
      tools = NOSQL_TOOLS;
    } else if (currentMode === 'ssh') {
      // SSH mode: prompt declares safety rules; execute_shell tool is bidirectional
      // (Rust blocks on user approval modal + captures terminal output before
      // returning the result). Output is redacted before reaching the model.
      const profile = get(activeSshProfile);
      systemPrompt = buildSshSystemPrompt(profile ? { username: profile.username, host: profile.host } : null);
      tools = SSH_TOOLS;
    } else if (currentMode === 'explorer') {
      const { EXPLORER_SYSTEM_PROMPT, EXPLORER_TOOLS } = await import('$lib/modes/explorer/ai/prompt');
      systemPrompt = EXPLORER_SYSTEM_PROMPT;
      tools = EXPLORER_TOOLS as unknown as any[];
    } else {
      systemPrompt = REST_SYSTEM_PROMPT;
      tools = REST_TOOLS;
    }

    const streamCleanup = await sendChatMessage(
      apiKey,
      chatHistory,
      context,
      sessionId,
      systemPrompt,
      tools,
      {
        onText: (text) => {
          messages[lastIdx].content += text;
          scrollToBottom();
        },
        onToolStart: (toolName) => {
          messages[lastIdx].toolIndicator = toolLabels[toolName] || `Đang dùng ${toolName}...`;
          scrollToBottom();
        },
        onToolEnd: (_toolName) => {
          messages[lastIdx].toolIndicator = undefined;
        },
        onAction: (action, data) => {
          const existing = messages[lastIdx].actions ?? [];
          existing.push({ type: action as any, data });
          messages[lastIdx].actions = [...existing];
          // Refresh stores when data changes
          if (action === 'request_created' || action === 'request_modified' || action === 'collection_created') {
            loadCollections();
          }
          if (action === 'switch_environment') {
            import('$lib/modes/rest/stores').then(({ setActiveEnv }) => {
              setActiveEnv(data.environmentId);
            });
          }
          if (action === 'apply_query' && data.query) {
            Promise.all([
              import('$lib/modes/sql/stores'),
              import('$lib/shared/stores/tabs'),
              import('$lib/stores/app'),
            ]).then(([{ applyAiQuery }, { addTab, tabs: tabStore, activeTabId: activeTabStore }, { mode: modeStore }]) => {
              modeStore.set('sql');
              const currentTabs = get(tabStore);
              const sqlTab = currentTabs.find(t => t.mode === 'sql');
              if (!sqlTab) {
                const tab = addTab('Truy vấn AI', 'sql', null, 'var(--sql)');
                activeTabStore.set(tab.id);
              } else {
                activeTabStore.set(sqlTab.id);
              }
              requestAnimationFrame(() => applyAiQuery(data.query));
            }).catch(() => { /* sql store import failed */ });
          }
          if (action === 'ai_execute_sql' && data.query) {
            Promise.all([
              import('$lib/modes/sql/stores'),
              import('$lib/stores/app'),
            ]).then(([{ triggerAiSqlExecution }, { mode: modeStore }]) => {
              modeStore.set('sql');
              requestAnimationFrame(() => {
                triggerAiSqlExecution(data.query, data.connectionId, data.database);
              });
            });
          }
          if (action === 'apply_nosql_query' && data.query) {
            Promise.all([
              import('$lib/modes/nosql/stores'),
              import('$lib/shared/stores/tabs'),
              import('$lib/stores/app'),
            ]).then(([{ applyAiNoSqlQuery }, { addTab, tabs: tabStore, activeTabId: activeTabStore }, { mode: modeStore }]) => {
              modeStore.set('nosql');
              const currentTabs = get(tabStore);
              const nosqlTab = currentTabs.find(t => t.mode === 'nosql');
              if (!nosqlTab) {
                const tab = addTab('Truy vấn AI', 'nosql', null, 'var(--nosql)');
                activeTabStore.set(tab.id);
              } else {
                activeTabStore.set(nosqlTab.id);
              }
              requestAnimationFrame(() => applyAiNoSqlQuery(data.query));
            }).catch(() => { /* nosql store import failed */ });
          }
          if (action === 'ai_execute_nosql' && data.filter) {
            Promise.all([
              import('$lib/modes/nosql/stores'),
              import('$lib/stores/app'),
            ]).then(([{ triggerAiNoSqlExecution }, { mode: modeStore }]) => {
              modeStore.set('nosql');
              requestAnimationFrame(() => {
                triggerAiNoSqlExecution(data.filter, data.connectionId, data.database, data.collection);
              });
            });
          }
          scrollToBottom();
        },
        onDone: (_inputTokens, _outputTokens, _toolRounds) => {
          messages[lastIdx].isStreaming = false;
          isStreaming = false;
          scrollToBottom();
        },
        onError: (error) => {
          // Raw provider errors go to console for debugging; the chat bubble
          // only ever shows a short, sanitised message.
          console.error('[AI error]', error);
          const errLower = (error || '').toLowerCase();
          let mapped: AIMessage['error'];
          if (errLower.includes('rate limit') || errLower.includes('429') || errLower.includes('too many')) {
            mapped = { type: 'rate_limit', message: 'Bị giới hạn tốc độ. Chờ một lát rồi thử lại.' };
          } else if (errLower.includes('invalid api key') || errLower.includes('401') || errLower.includes('unauthorized') || errLower.includes('sign in required')) {
            mapped = { type: 'auth', message: 'API key không hợp lệ. Kiểm tra lại key trong Cài đặt.' };
          } else if (errLower.includes('connection failed') || errLower.includes('network') || errLower.includes('timed out') || errLower.includes('timeout') || errLower.includes('econnref') || errLower.includes('dns')) {
            mapped = { type: 'generic', message: 'Sự cố mạng. Kiểm tra kết nối rồi thử lại.' };
          } else if (errLower.includes('500') || errLower.includes('502') || errLower.includes('503') || errLower.includes('504') || errLower.includes('service unavailable') || errLower.includes('internal server')) {
            mapped = { type: 'generic', message: 'Dịch vụ AI tạm thời không khả dụng. Thử lại sau giây lát.' };
          } else if (errLower.includes('400') || errLower.includes('422') || errLower.includes('bad request') || errLower.includes('invalid request')) {
            mapped = { type: 'generic', message: 'Không xử lý được yêu cầu đó. Thử diễn đạt lại.' };
          } else if (
            errLower.includes('credits') ||
            errLower.includes('insufficient_credits') ||
            errLower.includes('insufficient') ||
            errLower.includes('quota') ||
            errLower.includes('402') ||
            errLower.includes('payment required')
          ) {
            // Clauge AI returns 402 with {"error":"INSUFFICIENT_CREDITS","message":"out of Clauge AI credits this cycle",...}.
            // Other providers use 402 / "insufficient_quota" for billing exhaustion.
            if (provider === 'clauge') {
              mapped = {
                type: 'credits',
                message: "Bạn đã hết credit Clauge AI cho chu kỳ này. Nạp thêm tại Cài đặt → Tài khoản để tiếp tục dùng Clauge AI, hoặc chuyển sang API key của riêng bạn.",
              };
            } else {
              mapped = {
                type: 'credits',
                message: 'Đã hết credit với nhà cung cấp AI của bạn. Kiểm tra thanh toán tài khoản hoặc đổi nhà cung cấp trong Cài đặt.',
              };
            }
          } else {
            mapped = { type: 'generic', message: 'Đã xảy ra lỗi. Thử lại.' };
          }
          if (mapped) mapped.provider = provider;
          messages[lastIdx].error = mapped;
          messages[lastIdx].isStreaming = false;
          isStreaming = false;
          scrollToBottom();
        },
      },
      provider,
      modelId,
      currentMode,
      extraHeaders,
    );

    // Combine the chat-stream cleanup with the per-session SSH listener cleanup.
    cleanup = () => {
      try { streamCleanup(); } catch (_) {}
      if (_toolPendingOff) { try { _toolPendingOff(); } catch (_) {} }
    };
  }

  function applyRequest(action: AIActionBlock) {
    if (action.applied) return;
    const data = action.data;
    const tabId = get(activeTabId);

    draftRequests.update(drafts => {
      const current = drafts.get(tabId) || {};
      const updated = { ...current };
      if (data.method) updated.method = data.method;
      if (data.url) updated.url = data.url;
      if (data.body) updated.body = data.body;
      if (data.body_type) updated.bodyType = data.body_type;
      if (data.headers) {
        updated.headers = data.headers.map((h: any) => ({
          key: h.key, value: h.value, enabled: 1,
        }));
      }
      if (data.params) {
        updated.params = data.params.map((p: any) => ({
          key: p.key, value: p.value, enabled: 1,
        }));
      }
      drafts.set(tabId, updated);
      return new Map(drafts);
    });

    action.applied = true;
    showToast('Đã áp dụng yêu cầu vào tab đang mở', 'success');
  }

  function retryLastMessage() {
    // Remove the failed assistant message
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'assistant') {
      messages.pop();
    }
    // Get the last user message content
    const lastUser = messages[messages.length - 1];
    if (lastUser?.role === 'user') {
      const text = lastUser.content;
      messages.pop();
      inputText = text;
      // Use tick to let state update, then send
      import('svelte').then(({ tick }) => tick()).then(() => sendMessage());
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      sendMessage();
    }
  }

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 80) + 'px';
  }
</script>

<!-- Workspace, agent, and history modes don't wire up a system prompt
     or tools for the AI panel — opening it would render an empty,
     useless chat. Topbar already hides the toggle button in those
     modes; this guard makes sure stray sources (settings / persisted
     `aiPanelOpenPerMode`) can't bring the panel back. -->
{#if $mode !== 'workspace' && $mode !== 'agent' && $mode !== 'history'}
<aside
  class="ai-panel"
  class:open={$aiPanelOpen}
  class:dragging={isDragging}
  style:width={$aiPanelOpen ? panelWidth + 'px' : '0px'}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ai-drag-handle" onmousedown={startDrag}></div>
  <div class="ai-inner" style:width={panelWidth + 'px'}>
    <!-- Header -->
    <div class="ai-header">
      <div class="ai-header-left">
        <svg class="sparkle-icon" viewBox="0 0 24 24"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/></svg>
        <span class="ai-title">Trợ lý AI</span>
        <span class="mode-badge" style="background: {modeColors[$mode]}20; color: {modeColors[$mode]}; border-color: {modeColors[$mode]}40">
          {modeLabels[$mode]}
        </span>
      </div>
      <div class="ai-header-right">
        {#if $mode === 'ssh'}
          <button
            class="header-icon-btn ssh-auto-run-btn"
            class:active={sshAutoRun}
            title={sshAutoRun
              ? 'Tự động thực thi: BẬT — AI chạy lệnh không cần hỏi. Nhấn để tắt.'
              : 'Tự động thực thi: TẮT — Lệnh AI cần bạn duyệt. Nhấn để bật.'}
            aria-label="Bật/tắt AI tự động thực thi"
            onclick={toggleSshAutoRun}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill={sshAutoRun ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            {#if sshAutoRun}<span class="auto-run-dot" aria-hidden="true"></span>{/if}
          </button>
        {/if}
        {#if messages.length > 0}
          <button class="header-icon-btn" title="Xóa hội thoại" onclick={clearChat}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        {/if}
        <button class="close-btn" onclick={close}>&times;</button>
      </div>
    </div>

    {#if !hasApiKey}
      <div class="ai-chat">
        <div class="ai-welcome">
          <div class="welcome-icon">
            <svg viewBox="0 0 24 24"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/></svg>
          </div>
          <p class="welcome-text">Cài đặt API key để bắt đầu dùng trợ lý AI</p>
          <button class="ai-setup-btn" onclick={openAiSettings}>Cấu hình trong Cài đặt</button>
          <p class="welcome-hint">Bật/tắt bằng <kbd>{m}+L</kbd></p>
        </div>
      </div>
    {:else}
    <!-- Chat area -->
    <div class="ai-chat" bind:this={chatContainer}>
      {#if messages.length === 0}
        <div class="ai-welcome">
          <div class="welcome-icon">
            <svg viewBox="0 0 24 24"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/></svg>
          </div>
          <p class="welcome-text">{modeGuideText[$mode]}</p>
          <p class="welcome-hint">Bật/tắt bằng <kbd>{m}+L</kbd></p>
        </div>
      {/if}

      {#each messages as msg, i}
        {#if msg.role === 'user'}
          <div class="bubble user-bubble">{msg.content}</div>
        {:else}
          <div class="ai-response">
            {#if msg.content}
              <div class="ai-text" use:copyCodeBlockDecorator>{@html renderMarkdown(msg.content)}</div>
            {/if}

            {#if msg.toolIndicator}
              <div class="tool-indicator">
                <span class="tool-spinner"></span>
                <span class="tool-label">{msg.toolIndicator}</span>
              </div>
            {/if}

            {#if msg.actions}
              {#each msg.actions as action}
                {#if action.type === 'apply_request'}
                  <div class="action-card">
                    <div class="action-card-header">
                      <span class="method-tag" data-method={action.data.method}>{action.data.method}</span>
                      <span class="action-url">{action.data.url}</span>
                    </div>
                    {#if action.data.headers?.length}
                      <div class="action-detail-row">
                        <span class="action-detail-label">Headers</span>
                        <span class="action-detail-value">{action.data.headers.length} header{action.data.headers.length > 1 ? 's' : ''}</span>
                      </div>
                    {/if}
                    {#if action.data.body}
                      <div class="action-body-preview">
                        <pre>{action.data.body.length > 200 ? action.data.body.slice(0, 200) + '...' : action.data.body}</pre>
                      </div>
                    {/if}
                    <button
                      class="apply-btn"
                      class:applied={action.applied}
                      onclick={() => applyRequest(action)}
                      disabled={action.applied}
                    >
                      {#if action.applied}
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                        Đã áp dụng
                      {:else}
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                        Áp dụng vào tab
                      {/if}
                    </button>
                  </div>

                {:else if action.type === 'apply_query'}
                  <div class="action-card">
                    <div class="action-card-header">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--acc)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                      <span class="action-url">Truy vấn SQL</span>
                    </div>
                    {#if action.data.query}
                      <div class="action-body-preview">
                        <pre>{action.data.query.length > 300 ? action.data.query.slice(0, 300) + '...' : action.data.query}</pre>
                      </div>
                    {/if}
                  </div>

                {:else if action.type === 'apply_nosql_query'}
                  <div class="action-card">
                    <div class="action-card-header">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--acc)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                      <span class="action-url">Truy vấn NoSQL</span>
                    </div>
                    {#if action.data.query}
                      <div class="action-body-preview">
                        <pre>{action.data.query.length > 300 ? action.data.query.slice(0, 300) + '...' : action.data.query}</pre>
                      </div>
                    {/if}
                  </div>

                {:else if action.type === 'execute_result'}
                  <div class="action-card exec-card">
                    <div class="action-card-header">
                      <span class="status-dot" class:ok={action.data.status < 400} class:err={action.data.status >= 400}></span>
                      <span class="exec-status-text">{action.data.status} {action.data.statusText}</span>
                      <span class="exec-meta">{action.data.durationMs}ms{action.data.sizeBytes ? ` · ${action.data.sizeBytes > 1024 ? (action.data.sizeBytes / 1024).toFixed(1) + ' KB' : action.data.sizeBytes + ' B'}` : ''}</span>
                      {#if action.data.body}
                        <button
                          class="copy-btn"
                          title="Sao chép phản hồi"
                          onclick={() => {
                            try { navigator.clipboard.writeText(JSON.stringify(JSON.parse(action.data.body), null, 2)); }
                            catch { navigator.clipboard.writeText(action.data.body); }
                            showToast('Đã sao chép vào clipboard', 'success');
                          }}
                        >
                          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                        </button>
                      {/if}
                    </div>
                    {#if action.data.body}
                      <div class="exec-body">
                        {#if (() => { try { JSON.parse(action.data.body); return true; } catch { return false; } })()}
                          <pre><code>{@html highlightJSON(JSON.stringify(JSON.parse(action.data.body), null, 2))}</code></pre>
                        {:else}
                          <pre><code>{action.data.body}</code></pre>
                        {/if}
                      </div>
                    {/if}
                  </div>

                {:else if action.type === 'query_result' || action.type === 'ai_execute_sql'}
                  <div class="action-card exec-card">
                    <div class="action-card-header">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--acc)" stroke-width="1.8"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                      <span class="exec-status-text">{action.data.rowCount} hàng</span>
                      <span class="exec-meta">{action.data.durationMs}ms</span>
                      {#if action.data.columns}
                        <span class="exec-meta exec-cols">{action.data.columns.join(', ')}</span>
                      {/if}
                      <span class="exec-route-label">bảng kết quả</span>
                    </div>
                  </div>

                {:else if action.type === 'ai_execute_nosql' || action.type === 'documents_result'}
                  <div class="action-card exec-card">
                    <div class="action-card-header">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--acc)" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <span class="exec-status-text">{action.data.count} tài liệu</span>
                      <span class="exec-meta">{action.data.collection}</span>
                      <span class="exec-route-label">trình xem tài liệu</span>
                    </div>
                  </div>
                {:else if action.type === 'request_created'}
                  <div class="action-card created-card">
                    <div class="action-card-header">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--ok)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                      <span class="method-tag" data-method={action.data.method}>{action.data.method}</span>
                      <span class="created-name">{action.data.name}</span>
                    </div>
                  </div>

                {:else if action.type === 'request_modified'}
                  <div class="action-card request-modified">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--acc)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span class="action-label">{action.data.message || 'Đã cập nhật yêu cầu'}</span>
                  </div>
                {:else if action.type === 'collection_created'}
                  <div class="action-card collection-created">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--acc)" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                    <span class="action-label">{action.data.name || 'Đã tạo collection'}</span>
                  </div>
                {:else if action.type === 'collection_executed'}
                  <div class="action-card collection-report">
                    <div class="report-header">
                      <span class="report-title">Báo cáo Collection</span>
                      <span class="report-summary">
                        <span class="report-pass">{(action.data.results ?? []).filter((r: any) => r.status && r.status < 400).length} đạt</span>
                        <span class="report-fail">{(action.data.results ?? []).length - (action.data.results ?? []).filter((r: any) => r.status && r.status < 400).length} lỗi</span>
                        <span class="report-total">{(action.data.results ?? []).length} tổng</span>
                      </span>
                    </div>
                    {#if action.data.results}
                      <div class="report-table">
                        {#each action.data.results as result}
                          <div class="report-row">
                            <span class="status-dot" class:ok={result.status && result.status < 400} class:err={result.error || (result.status && result.status >= 400)}></span>
                            <span class="method-tag sm" data-method={result.method}>{result.method}</span>
                            <span class="report-name">{result.name}</span>
                            {#if result.status}
                              <span class="report-status">{result.status}</span>
                              <span class="report-duration">{result.durationMs}ms</span>
                            {:else if result.error}
                              <span class="report-error">Lỗi</span>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              {/each}
            {/if}

            <!-- Dots are shown whenever the assistant is mid-stream and a
                 named tool indicator isn't already up. This covers both
                 the initial "waiting for first chunk" case AND the
                 between-activities gaps (tool just finished, next text
                 chunk not yet received) where the bubble would otherwise
                 look frozen. -->
            {#if msg.isStreaming && !msg.toolIndicator}
              <div class="typing-indicator">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
            {/if}

            {#if msg.error}
              <div class="ai-error-block" class:rate-limit={msg.error.type === 'rate_limit'} class:auth-error={msg.error.type === 'auth' || msg.error.type === 'cloud_auth'} class:credits-error={msg.error.type === 'credits'}>
                <div class="ai-error-icon">
                  {#if msg.error.type === 'rate_limit'}
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {:else if msg.error.type === 'auth' || msg.error.type === 'cloud_auth'}
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                  {:else if msg.error.type === 'credits'}
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="13" rx="2"/><line x1="2" y1="11" x2="22" y2="11"/><line x1="6" y1="15" x2="10" y2="15"/></svg>
                  {:else}
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {/if}
                </div>
                <div class="ai-error-body">
                  <span class="ai-error-msg">{msg.error.message}</span>
                  {#if msg.error.type !== 'credits'}
                    <div class="ai-error-actions">
                      {#if msg.error.type === 'rate_limit'}
                        <button class="ai-error-btn" onclick={retryLastMessage}>Thử lại</button>
                      {:else if msg.error.type === 'cloud_auth'}
                        <button class="ai-error-btn" onclick={openAccountSettings}>Mở Tài khoản</button>
                        <button class="ai-error-btn" onclick={retryLastMessage}>Thử lại</button>
                      {:else if msg.error.type === 'auth'}
                        <button class="ai-error-btn" onclick={openAiSettings}>Mở Cài đặt</button>
                      {:else}
                        <button class="ai-error-btn" onclick={retryLastMessage}>Thử lại</button>
                      {/if}
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>

    <!-- Footer row above the input: provider pill on the left.
         No credits chip — live balance is still wired end-to-end (worker
         SSE `event: balance` → Rust `clauge_ai:balance` Tauri event →
         `cloudCredits` store) but intentionally not displayed here so
         users don't fixate on the counter ticking down. Settings →
         Account is the canonical place to check usage. -->
    <div class="ai-prompt-footer">
      <div class="ai-prompt-footer-left">
        <AIConfigSelector />
      </div>
    </div>

    <div class="ai-input-area">
      <textarea
        class="ai-input"
        placeholder={modePlaceholders[$mode]}
        bind:value={inputText}
        onkeydown={handleKeydown}
        oninput={handleInput}
        rows="1"
      ></textarea>
      {#if isStreaming}
        <button
          class="send-btn stop-btn"
          onclick={cancelStreaming}
          title="Dừng"
        >
          <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/></svg>
        </button>
      {:else}
        <button
          class="send-btn"
          style="background: {modeColors[$mode]}"
          onclick={sendMessage}
          disabled={!inputText.trim()}
          title={`Gửi (${m}+Enter)`}
        >
          <svg viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>
        </button>
      {/if}
    </div>
    {/if}
  </div>
</aside>
{/if}

<SshExecuteConfirmModal
  show={sshModalShow}
  command={sshModalCommand}
  reason={sshModalReason}
  target={sshModalTarget}
  onApprove={handleSshApprove}
  onCancel={handleSshCancel}
/>

{#if sshAutoRunWarnShow}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="auto-run-backdrop" onclick={() => (sshAutoRunWarnShow = false)}>
    <div class="auto-run-modal" role="dialog" aria-modal="true" aria-labelledby="auto-run-title" onclick={(e) => e.stopPropagation()}>
      <header class="auto-run-header">
        <span class="auto-run-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </span>
        <h3 id="auto-run-title">Bật tự động thực thi?</h3>
      </header>
      <div class="auto-run-body">
        <p>Lệnh shell do AI đề xuất sẽ chạy trên server SSH đã kết nối <strong>ngay lập tức, không cần bạn duyệt từng lệnh</strong>.</p>
        <ul class="auto-run-list">
          <li>Bạn vẫn thấy mọi lệnh trong terminal khi chúng chạy</li>
          <li>AI được yêu cầu từ chối thao tác phá hủy, nhưng vẫn có thể xảy ra sai sót</li>
          <li>Chỉ dùng trên server bạn tin tưởng để có thể khôi phục nếu lệnh sai</li>
          <li>Bạn có thể tắt bất cứ lúc nào từ cùng nút bấm này</li>
        </ul>
      </div>
      <footer class="auto-run-footer">
        <button type="button" class="auto-run-btn auto-run-cancel" onclick={() => (sshAutoRunWarnShow = false)}>Hủy</button>
        <button type="button" class="auto-run-btn auto-run-enable" onclick={confirmEnableAutoRun}>Bật tự động thực thi</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  @import './AIPanel.svelte.css';
</style>
