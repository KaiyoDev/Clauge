<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let {
    mode,
    existing,
    onClose,
    onSave,
  }: {
    mode: 'create' | 'edit';
    existing: {
      id: number;
      label: string;
      provider: string;
      baseUrl: string | null;
      defaultModel: string | null;
    } | null;
    onClose: () => void;
    onSave: (data: {
      label: string;
      provider: string;
      baseUrl: string | null;
      defaultModel: string | null;
    }) => Promise<void>;
  } = $props();

  let label = $state(existing?.label ?? '');
  let provider = $state(existing?.provider ?? 'anthropic');
  let baseUrl = $state(existing?.baseUrl ?? '');
  let defaultModel = $state(existing?.defaultModel ?? '');
  let saving = $state(false);
  let error = $state<string | null>(null);

  // Curated default model lists per provider. The "Custom…" sentinel
  // reveals a free-text input so power users can type unlisted models.
  // Update these lists as providers ship new models.
  const MODELS_BY_PROVIDER: Record<string, string[]> = {
    anthropic: [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
    openai: [
      'gpt-4o',
      'gpt-4o-mini',
      'o1-preview',
      'o1-mini',
    ],
    groq: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
    ],
    gemini: [
      'gemini-2.0-flash-exp',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ],
    openrouter: [
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    opencode: [],
  };

  const CUSTOM_SENTINEL = '__custom__';

  // The dropdown's bound value. Either a known model from the list, or the
  // sentinel that switches us into custom (text-input) mode.
  let modelChoice = $state<string>(
    existing?.defaultModel &&
      !(MODELS_BY_PROVIDER[existing.provider]?.includes(existing.defaultModel))
      ? CUSTOM_SENTINEL
      : (existing?.defaultModel ?? ''),
  );

  const knownModels = $derived(MODELS_BY_PROVIDER[provider] ?? []);
  const isCustomModel = $derived(modelChoice === CUSTOM_SENTINEL);

  // Resolve the actual model value to save: the dropdown choice unless we're
  // in custom mode, in which case use the free-text input.
  function resolveModel(): string {
    if (isCustomModel) return defaultModel.trim();
    return modelChoice.trim();
  }

  // When provider changes, reset the model choice if it isn't in the new
  // provider's list (avoid persisting an Anthropic model under OpenAI).
  $effect(() => {
    const list = MODELS_BY_PROVIDER[provider] ?? [];
    if (modelChoice && modelChoice !== CUSTOM_SENTINEL && !list.includes(modelChoice)) {
      modelChoice = '';
      defaultModel = '';
    }
  });

  const canSave = $derived(label.trim().length > 0 && provider.trim().length > 0 && !saving);

  async function handleSave() {
    if (!canSave) return;
    saving = true;
    error = null;
    try {
      const finalModel = resolveModel();
      await onSave({
        label: label.trim(),
        provider,
        baseUrl: baseUrl.trim() || null,
        defaultModel: finalModel || null,
      });
      onClose();
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
  }

  function teleportToBody(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentElement === document.body) node.remove();
      },
    };
  }

  onMount(() => window.addEventListener('keydown', handleKeydown));
  onDestroy(() => window.removeEventListener('keydown', handleKeydown));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="aice-overlay" use:teleportToBody onclick={handleOverlayClick}>
  <div class="aice-modal modal-card" role="dialog" aria-modal="true">
    <div class="aice-hdr">
      <span class="aice-title">{mode === 'create' ? 'Add AI provider' : 'Edit AI provider'}</span>
    </div>

    <div class="aice-body">
      <label class="aice-field">
        <span class="aice-label">Label</span>
        <input
          class="aice-input"
          type="text"
          bind:value={label}
          placeholder="e.g. Work OpenAI"
          autocomplete="off"
          spellcheck={false}
        />
      </label>

      <label class="aice-field">
        <span class="aice-label">Provider</span>
        <select class="aice-select" bind:value={provider}>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="groq">Groq</option>
          <option value="gemini">Gemini</option>
          <option value="openrouter">OpenRouter</option>
          <option value="opencode">OpenCode</option>
        </select>
      </label>

      <label class="aice-field">
        <span class="aice-label">
          Base URL
          <span class="aice-opt">(optional)</span>
        </span>
        <input
          class="aice-input"
          type="text"
          bind:value={baseUrl}
          placeholder="https://api.openai.com/v1"
          autocomplete="off"
          spellcheck={false}
        />
      </label>

      <label class="aice-field">
        <span class="aice-label">
          Default model
          <span class="aice-opt">(optional)</span>
        </span>
        <select class="aice-select" bind:value={modelChoice}>
          <option value="">Use provider default</option>
          {#each knownModels as m (m)}
            <option value={m}>{m}</option>
          {/each}
          <option value={CUSTOM_SENTINEL}>Custom…</option>
        </select>
        {#if isCustomModel}
          <input
            class="aice-input aice-input-custom"
            type="text"
            bind:value={defaultModel}
            placeholder="Type a model name"
            autocomplete="off"
            spellcheck={false}
          />
        {/if}
      </label>

      {#if error}
        <p class="aice-error">{error}</p>
      {/if}
    </div>

    <div class="aice-actions">
      <button class="aice-btn aice-btn-ghost" onclick={onClose} disabled={saving}>
        Cancel
      </button>
      <button class="aice-btn aice-btn-primary" onclick={handleSave} disabled={!canSave}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
</div>

<style>
  .aice-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: var(--scrim-strong, rgba(0, 0, 0, 0.55));
    z-index: var(--z-drawer, 900);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: aice-fade 0.15s ease;
  }

  @keyframes aice-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .aice-modal {
    width: 420px;
    max-width: 92vw;
    animation: aice-up 0.18s ease;
    overflow: hidden;
    font-family: var(--ui);
  }

  @keyframes aice-up {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: none; }
  }

  .aice-hdr {
    display: flex;
    align-items: center;
    padding: 14px 18px;
    border-bottom: 1px solid var(--b1);
    background: var(--e, var(--surface-hover));
  }

  .aice-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--t1);
    font-family: var(--ui);
  }

  .aice-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .aice-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .aice-label {
    font-size: 11.5px;
    font-weight: 500;
    color: var(--t3);
    font-family: var(--ui);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .aice-opt {
    font-weight: 400;
    color: var(--t4, var(--t3));
    font-size: 11px;
  }

  .aice-input,
  .aice-select {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 10px;
    border-radius: var(--radius-md, 6px);
    border: 1px solid var(--b1);
    background: var(--n2, var(--surface-hover));
    color: var(--t1);
    font-family: var(--ui);
    font-size: 12.5px;
    outline: none;
    transition: border-color 0.12s, box-shadow 0.12s;
  }

  .aice-input:focus,
  .aice-select:focus {
    border-color: var(--acc);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--acc) 12%, transparent);
  }

  .aice-select {
    cursor: default;
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='3 5 6 8 9 5'/></svg>");
    background-repeat: no-repeat;
    background-position: right 10px center;
    background-size: 10px 10px;
    padding-right: 28px;
  }

  .aice-select option {
    background: var(--n, #111);
    color: var(--t1);
  }

  /* Custom-model input sits right under the model select when "Custom…"
     is chosen. Slight top margin separates it from the dropdown. */
  .aice-input-custom {
    margin-top: 6px;
  }

  .aice-error {
    font-size: 12px;
    color: var(--err, #f04444);
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--radius-md, 6px);
    border: 1px solid color-mix(in srgb, var(--err, #f04444) 25%, transparent);
    background: color-mix(in srgb, var(--err, #f04444) 6%, transparent);
  }

  .aice-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--b1);
  }

  .aice-btn {
    height: 30px;
    padding: 0 16px;
    border-radius: var(--radius-md, 7px);
    border: 1px solid var(--b1);
    font-size: 12px;
    font-weight: 500;
    font-family: var(--ui);
    cursor: default;
    display: inline-flex;
    align-items: center;
    transition: background 0.12s, border-color 0.12s, opacity 0.12s, color 0.12s;
  }

  .aice-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .aice-btn-primary {
    background: var(--acc);
    border-color: transparent;
    color: #fff;
  }

  .aice-btn-primary:hover:not(:disabled) {
    opacity: 0.85;
  }

  .aice-btn-ghost {
    background: transparent;
    color: var(--t2);
  }

  .aice-btn-ghost:hover:not(:disabled) {
    border-color: var(--b2);
    color: var(--t1);
  }
</style>
