<script lang="ts">
  import Modal from '$lib/shared/primitives/Modal.svelte';
  import { createConnection, updateConnection, setSecret, getSecret } from '$lib/modes/explorer/commands';
  import { loadExplorerConnections } from '$lib/modes/explorer/stores';
  import { showToast } from '$lib/shared/primitives/toast';
  import { errorToast, friendlyError } from '$lib/utils/errors';
  import type { ExplorerConnection } from '$lib/modes/explorer/types';

  interface Props {
    show: boolean;
    editing?: ExplorerConnection | null;
    onclose?: () => void;
  }

  let { show = $bindable(), editing = null, onclose }: Props = $props();
  const isEdit = $derived(!!editing);

  let name = $state('');
  let host = $state('');
  let port = $state(21);
  let username = $state('anonymous');
  let password = $state('');
  let passive = $state(true);
  // FTPS deferred — only "none" works in v1; keeping the field hidden.

  let saving = $state(false);

  let lastFilledId = $state<string | null>(null);
  $effect(() => {
    if (show && editing && editing.id !== lastFilledId) {
      lastFilledId = editing.id;
      name = editing.name ?? '';
      host = editing.host ?? '';
      port = editing.port ?? 21;
      username = editing.username ?? 'anonymous';
      passive = editing.ftpPassive !== 0;
      password = '';
      getSecret(editing.id, 'password').then((v) => { if (v != null) password = v; }).catch(() => {});
    }
    if (!show) lastFilledId = null;
  });

  function resetForm() {
    name = ''; host = ''; port = 21; username = 'anonymous'; password = ''; passive = true;
  }

  async function handleSave() {
    if (!name.trim()) { showToast('Tên là bắt buộc', 'error'); return; }
    if (!host.trim()) { showToast('Host là bắt buộc', 'error'); return; }
    saving = true;
    try {
      const payload: ExplorerConnection = {
        id: editing?.id ?? '',
        name: name.trim(),
        kind: 'ftp',
        accentColor: editing?.accentColor ?? null,
        lastUsedAt: editing?.lastUsedAt ?? null,
        createdAt: editing?.createdAt ?? '',
        sshProfileId: null,
        sftpWorkingDir: null,
        host: host.trim(),
        port,
        username: username.trim() || 'anonymous',
        authType: null,
        keyPath: null,
        ftpPassive: passive ? 1 : 0,
        ftpTls: 'none',
        s3Preset: null, s3Endpoint: null, s3Region: null, s3Bucket: null, s3PathStyle: 0,
        azureAccount: null, azureContainer: null, azureAuthKind: null,
      };
      let connId: string;
      if (isEdit && editing) {
        await updateConnection(payload);
        connId = editing.id;
      } else {
        const created = await createConnection(payload);
        connId = created.id;
      }
      if (password) await setSecret(connId, 'password', password);
      await loadExplorerConnections();
      showToast(isEdit ? 'Đã cập nhật kết nối FTP' : 'Đã lưu kết nối FTP', 'success');
      resetForm();
      show = false;
      onclose?.();
    } catch (e: any) {
      errorToast('Không lưu được', e);
    } finally {
      saving = false;
    }
  }
</script>

<Modal bind:show title={isEdit ? 'Chỉnh sửa kết nối FTP' : 'Kết nối FTP mới'} width="500px" onclose={() => onclose?.()}>
  <div class="form">
    <label class="row">
      <span>Tên</span>
      <input class="inp" type="text" bind:value={name} placeholder="vd. NAS" />
    </label>
    <label class="row">
      <span>Host</span>
      <input class="inp" type="text" bind:value={host} placeholder="ftp.example.com" />
    </label>
    <label class="row">
      <span>Cổng</span>
      <input class="inp" type="number" bind:value={port} />
    </label>
    <label class="row">
      <span>Tên đăng nhập</span>
      <input class="inp" type="text" bind:value={username} />
    </label>
    <label class="row">
      <span>Mật khẩu</span>
      <input class="inp" type="password" bind:value={password} placeholder="(để trống nếu đăng nhập ẩn danh)" />
    </label>
    <label class="row checkbox">
      <input type="checkbox" bind:checked={passive} />
      <span>Chế độ passive (khuyến nghị)</span>
    </label>

    <div class="actions">
      <button class="btn" onclick={() => { show = false; onclose?.(); }}>Hủy</button>
      <button class="btn primary" onclick={handleSave} disabled={saving}>
        {saving ? 'Đang lưu…' : isEdit ? 'Lưu thay đổi' : 'Lưu kết nối'}
      </button>
    </div>
  </div>
</Modal>

<style>
  .form { display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; flex-direction: column; gap: 4px; font-family: var(--ui); font-size: 12px; color: var(--t2); }
  .row.checkbox { flex-direction: row; align-items: center; gap: 8px; cursor: default; }
  .inp {
    background: var(--surface-hover);
    border: 1px solid var(--b1);
    border-radius: 5px;
    color: var(--t1);
    height: 32px;
    padding: 0 10px;
    font-size: 13px;
    font-family: var(--mono);
    outline: none;
    transition: border-color 0.12s;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    text-overflow: ellipsis;
  }
  .inp:focus { border-color: var(--acc); }
  .inp[type="number"]::-webkit-inner-spin-button,
  .inp[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    appearance: none;
    margin: 0;
  }
  .inp[type="number"] {
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
  .btn {
    padding: 7px 14px;
    border-radius: 6px;
    border: 1px solid var(--b1);
    background: transparent;
    color: var(--t2);
    font-size: 12px;
    font-family: var(--ui);
    cursor: default;
  }
  .btn:hover:not(:disabled) { border-color: var(--b2); color: var(--t1); }
  .btn.primary { background: var(--acc); color: #fff; border-color: transparent; }
  .btn:disabled { opacity: 0.5; }
</style>
