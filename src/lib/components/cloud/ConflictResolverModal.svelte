<script lang="ts">
  // Conflict resolver — one global Keep mine / Use other device's choice
  // that applies to every kind currently in conflict-locked state.
  //
  // Behaviour:
  //   - Reads $cloudConflicts (already kept in sync with Rust events).
  //   - On open, doesn't try to compute fancy per-kind summary stats —
  //     friendly copy + clear primary action wins over technical detail
  //     for the kinds of users hitting this case.
  //   - Resolution is one Tauri command that loops the conflicted kinds
  //     either force-pushing or pulling+importing them.
  //   - Mid-resolution races: if `cloud:conflicts-changed` fires while
  //     the modal is open, the body re-renders with the new list.
  import { cloudConflicts } from '$lib/stores/cloud';
  import { cloudResolveKeepLocal, cloudResolveUseRemote, cloudGetConflicts } from '$lib/commands/cloud';
  import { showToast } from '$lib/shared/primitives/toast';

  /** Teleport the modal subtree to <body>. The Settings pane is mounted
   *  inside .app-workspace which may sit beneath a transformed ancestor
   *  (or, more pragmatically, a flex container with overflow:hidden) —
   *  either of which clips a position:fixed overlay to the ancestor
   *  instead of the viewport. Re-parenting to body sidesteps the whole
   *  containing-block question. Same pattern Modal.svelte uses. */
  function teleportToBody(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentElement === document.body) node.remove();
      },
    };
  }

  interface Props {
    show: boolean;
  }

  let { show = $bindable() }: Props = $props();

  let busy = $state<'keep' | 'use' | null>(null);

  /** Friendly display name for a kind id — keeps the modal copy in the
   *  user's language, not the protocol's. */
  function label(kind: string): string {
    switch (kind) {
      case 'rest':     return 'Collection REST';
      case 'sql':      return 'Kết nối SQL';
      case 'nosql':    return 'Kết nối NoSQL';
      case 'agent':    return 'Bối cảnh Agent';
      case 'ssh':      return 'Profile SSH';
      case 'explorer': return 'Kết nối Explorer';
      case 'coworkers': return 'Đồng nghiệp Workspace';
      default:         return kind;
    }
  }

  /** Refresh the store after a resolve. The Rust resolve commands clear
   *  per-kind conflict flags but don't emit `cloud:conflicts-changed`
   *  themselves (that event fires only from the scheduler loop, which
   *  isn't on this path). Pulling the fresh list directly keeps the
   *  avatar dot + Settings "Action Required" + this modal's body all
   *  in sync without waiting for the next auto-push tick. */
  async function refreshConflictsStore() {
    try {
      const fresh = await cloudGetConflicts();
      cloudConflicts.set(fresh);
    } catch (e) {
      console.warn('[Cloud] refresh conflicts:', e);
    }
  }

  async function keepLocal() {
    busy = 'keep';
    try {
      await cloudResolveKeepLocal();
      await refreshConflictsStore();
      showToast('Đã giữ phiên bản trên thiết bị này', 'success');
      show = false;
    } catch (e: any) {
      showToast(`Không xử lý được: ${e?.message ?? e}`, 'error');
    } finally {
      busy = null;
    }
  }

  async function useRemote() {
    busy = 'use';
    try {
      await cloudResolveUseRemote();
      await refreshConflictsStore();
      showToast('Đã dùng phiên bản từ thiết bị khác', 'success');
      show = false;
    } catch (e: any) {
      showToast(`Không xử lý được: ${e?.message ?? e}`, 'error');
    } finally {
      busy = null;
    }
  }

  function close() {
    if (busy) return;
    show = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && show) {
      e.preventDefault();
      close();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="cr-overlay" use:teleportToBody onclick={close}>
    <div class="cr-modal modal-card" onclick={(e: MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true">
      <header class="cr-hdr">
        <span class="cr-title">Một số thay đổi cần bạn xử lý</span>
        <button class="cr-close" onclick={close} aria-label="Đóng" disabled={!!busy}>&times;</button>
      </header>

      <div class="cr-body">
        <p class="cr-lead">
          Thiết bị khác của bạn đã thay đổi dữ liệu trong khi bạn đang chỉnh
          sửa ở đây. Hãy chọn phiên bản nào sẽ giữ — lựa chọn này áp dụng
          cho tất cả phần đã rẽ nhánh.
        </p>

        <div class="cr-affected">
          <span class="cr-affected-label">Bị ảnh hưởng:</span>
          <span class="cr-affected-list">
            {#if $cloudConflicts.length === 0}
              Không có gì cần xử lý.
            {:else}
              {$cloudConflicts.map(label).join(' · ')}
            {/if}
          </span>
        </div>

        <p class="cr-warn">
          Một trong số này có thể bao gồm cả việc xóa ở một bên. Hãy cân
          nhắc kỹ — Clauge không thể hoàn tác lựa chọn này.
        </p>
      </div>

      <footer class="cr-foot">
        <button class="cr-btn cr-btn-secondary" onclick={close} disabled={!!busy}>
          Đóng
        </button>
        <button
          class="cr-btn cr-btn-secondary"
          onclick={useRemote}
          disabled={!!busy || $cloudConflicts.length === 0}
        >
          {busy === 'use' ? 'Đang áp dụng…' : 'Dùng từ thiết bị khác'}
        </button>
        <button
          class="cr-btn cr-btn-primary"
          onclick={keepLocal}
          disabled={!!busy || $cloudConflicts.length === 0}
        >
          {busy === 'keep' ? 'Đang lưu…' : 'Giữ thay đổi của tôi'}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .cr-overlay {
    position: fixed;
    inset: 0;
    background: var(--scrim-strong);
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: cr-fade 0.15s ease;
  }
  @keyframes cr-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .cr-modal {
    width: min(520px, 92vw);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: cr-rise 0.18s ease;
  }
  @keyframes cr-rise {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to   { opacity: 1; transform: none; }
  }
  .cr-hdr {
    display: flex;
    align-items: center;
    padding: 14px 18px;
    border-bottom: 1px solid var(--b1);
    background: var(--e);
  }
  .cr-title {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--t1);
    font-family: var(--ui);
  }
  .cr-close {
    margin-left: auto;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid var(--b1);
    background: transparent;
    color: var(--t3);
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: default;
    transition: background 0.12s, color 0.12s;
  }
  .cr-close:hover { background: var(--c); color: var(--t1); }
  .cr-close:disabled { opacity: 0.4; }

  .cr-body {
    padding: 18px 22px;
    color: var(--t2);
    font-family: var(--ui);
    font-size: 13px;
    line-height: 1.55;
  }
  .cr-lead { margin: 0 0 14px; }
  .cr-affected {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px 12px;
    margin-bottom: 12px;
    border: 1px solid var(--b1);
    border-radius: 8px;
    background: var(--surface-hover);
    font-size: 12.5px;
  }
  .cr-affected-label {
    color: var(--t3);
    font-weight: 600;
  }
  .cr-affected-list { color: var(--t1); }
  .cr-warn {
    margin: 0;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--warn, #f5a623) 30%, var(--b1));
    background: color-mix(in srgb, var(--warn, #f5a623) 8%, transparent);
    color: var(--t2);
    font-size: 12px;
  }

  .cr-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px 16px;
    border-top: 1px solid var(--b1);
  }
  .cr-btn {
    height: 32px;
    padding: 0 14px;
    border-radius: 7px;
    border: 1px solid var(--b1);
    background: transparent;
    color: var(--t1);
    font-family: var(--ui);
    font-size: 12.5px;
    font-weight: 500;
    cursor: default;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .cr-btn:disabled { opacity: 0.5; }
  .cr-btn-secondary:hover:not(:disabled) {
    background: var(--surface-hover);
    border-color: var(--b2);
  }
  .cr-btn-primary {
    background: var(--acc);
    border-color: var(--acc);
    color: #fff;
    font-weight: 600;
  }
  .cr-btn-primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }
</style>
