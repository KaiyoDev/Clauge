<script lang="ts">
  import { cloudPlan, cloudCredits } from '$lib/stores/cloud';

  type AiConfig = {
    id: number;
    label: string;
    provider: string;
    baseUrl: string | null;
    defaultModel: string | null;
    isDefault: number;
    createdAt: string;
    lastUsedAt: string | null;
  };

  type SelectorValue = string | null;

  let {
    value = $bindable<SelectorValue>(null),
    configs = [],
    onUpgradeClick,
    onAddProvider,
  }: {
    value?: SelectorValue;
    configs?: AiConfig[];
    onUpgradeClick: () => void;
    onAddProvider?: () => void;
  } = $props();

  const isPro = $derived($cloudPlan === 'pro');

  const effectiveValue = $derived.by(() => {
    if (value) return value;
    if (isPro) return 'clauge';
    const def = configs.find((c) => c.isDefault === 1);
    return def ? `config:${def.id}` : null;
  });

  type Active =
    | { kind: 'clauge'; label: string; sub: string | null }
    | { kind: 'config'; label: string; sub: string | null; provider: string }
    | null;
  const active = $derived.by((): Active => {
    if (effectiveValue === 'clauge') {
      const sub = $cloudCredits
        ? `${$cloudCredits.remaining.toLocaleString()} / ${$cloudCredits.allowance.toLocaleString()} credits`
        : null;
      return { kind: 'clauge', label: 'Clauge AI', sub };
    }
    if (effectiveValue?.startsWith('config:')) {
      const id = Number(effectiveValue.slice('config:'.length));
      const cfg = configs.find((c) => c.id === id);
      if (cfg) {
        return {
          kind: 'config',
          label: cfg.label,
          sub: cfg.defaultModel,
          provider: cfg.provider,
        };
      }
    }
    return null;
  });

  let open = $state(false);
  let chipEl: HTMLButtonElement | null = $state(null);

  function toggle() { open = !open; }
  function close() { open = false; }

  function pick(next: string) {
    if (next === 'clauge' && !isPro) {
      close();
      onUpgradeClick();
      return;
    }
    value = next;
    close();
  }
  function handleAdd() {
    close();
    onAddProvider?.();
  }
  function handleOutsideClick(e: MouseEvent) {
    if (!open) return;
    const t = e.target as HTMLElement;
    if (chipEl?.contains(t)) return;
    if (t.closest('.ai-sel-pop')) return;
    close();
  }
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
  $effect(() => {
    if (!open) return;
    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  function providerInitial(p: string): string {
    switch (p) {
      case 'anthropic': return 'A';
      case 'openai': return 'O';
      case 'groq': return 'G';
      case 'gemini': return 'M';
      case 'openrouter': return 'R';
      case 'opencode': return 'C';
      default: return p[0]?.toUpperCase() ?? '?';
    }
  }
</script>

<div class="ai-sel-wrap">
  <button
    bind:this={chipEl}
    type="button"
    class="ai-sel-chip"
    class:is-open={open}
    onclick={toggle}
    aria-haspopup="listbox"
    aria-expanded={open}
    title="Choose AI provider"
  >
    {#if active?.kind === 'clauge'}
      <span class="ai-sel-glyph is-clauge" aria-hidden="true">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2z"/>
        </svg>
      </span>
    {:else if active?.kind === 'config'}
      <span class="ai-sel-glyph" aria-hidden="true">{providerInitial(active.provider)}</span>
    {:else}
      <span class="ai-sel-glyph is-empty" aria-hidden="true">?</span>
    {/if}
    <span class="ai-sel-label">{active?.label ?? 'No provider'}</span>
    {#if active?.sub}
      <span class="ai-sel-sub">· {active.sub}</span>
    {/if}
    <svg class="ai-sel-caret" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  </button>

  {#if open}
    <div class="ai-sel-pop" role="listbox" aria-label="AI providers">
      <div class="ai-sel-pop-head">Choose provider</div>

      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="ai-sel-row"
        class:is-active={effectiveValue === 'clauge'}
        class:is-locked={!isPro}
        onclick={() => pick('clauge')}
        role="option"
        aria-selected={effectiveValue === 'clauge'}
      >
        <span class="ai-sel-row-glyph is-clauge" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2z"/>
          </svg>
        </span>
        <div class="ai-sel-row-body">
          <div class="ai-sel-row-title">
            Clauge AI
            {#if !isPro}<span class="ai-sel-badge">PRO</span>{/if}
          </div>
          <div class="ai-sel-row-sub">
            {#if isPro && $cloudCredits}
              {$cloudCredits.remaining.toLocaleString()} / {$cloudCredits.allowance.toLocaleString()} credits remaining
            {:else if isPro}
              Managed assistance · no key needed
            {:else}
              Managed assistance, included with Pro
            {/if}
          </div>
        </div>
        {#if effectiveValue === 'clauge'}
          <svg class="ai-sel-row-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        {/if}
      </div>

      {#if configs.length > 0}
        <div class="ai-sel-divider"></div>
        {#each configs as cfg (cfg.id)}
          {@const val = `config:${cfg.id}`}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="ai-sel-row"
            class:is-active={effectiveValue === val}
            onclick={() => pick(val)}
            role="option"
            aria-selected={effectiveValue === val}
          >
            <span class="ai-sel-row-glyph" aria-hidden="true">{providerInitial(cfg.provider)}</span>
            <div class="ai-sel-row-body">
              <div class="ai-sel-row-title">
                {cfg.label}
                {#if cfg.isDefault === 1}<span class="ai-sel-default-tag">Default</span>{/if}
              </div>
              <div class="ai-sel-row-sub">
                {cfg.provider}{cfg.defaultModel ? ` · ${cfg.defaultModel}` : ''}
              </div>
            </div>
            {#if effectiveValue === val}
              <svg class="ai-sel-row-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            {/if}
          </div>
        {/each}
      {/if}

      <div class="ai-sel-divider"></div>
      <button type="button" class="ai-sel-add" onclick={handleAdd}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Add your own API key
      </button>
    </div>
  {/if}
</div>

<style>
  .ai-sel-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-width: 0;
  }

  .ai-sel-chip {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px 3px 3px;
    background: var(--surface-hover, #1a1a1a);
    border: 1px solid var(--b1, #2a2a2a);
    border-radius: 999px;
    color: var(--t1, #ddd);
    font-family: var(--ui);
    font-size: 11.5px;
    line-height: 1.2;
    cursor: pointer;
    max-width: 100%;
    min-width: 0;
    transition: background 0.12s, border-color 0.12s;
  }
  .ai-sel-chip:hover {
    background: color-mix(in srgb, var(--surface-hover) 60%, var(--b1));
    border-color: var(--b2, #3a3a3a);
  }
  .ai-sel-chip.is-open {
    border-color: var(--acc);
    background: color-mix(in srgb, var(--acc) 8%, var(--surface-hover));
  }

  .ai-sel-glyph {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--acc) 18%, var(--b1));
    color: var(--acc);
    font-size: 9.5px;
    font-weight: 700;
    font-family: var(--mono, ui-monospace);
    flex-shrink: 0;
  }
  .ai-sel-glyph.is-clauge {
    background: var(--acc);
    color: #fff;
  }
  .ai-sel-glyph.is-empty {
    background: transparent;
    color: var(--t3, #888);
    border: 1px dashed var(--b2, #3a3a3a);
  }

  .ai-sel-label {
    font-weight: 600;
    color: var(--t1, #ddd);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 130px;
  }
  .ai-sel-sub {
    color: var(--t3, #888);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }
  .ai-sel-caret {
    color: var(--t3, #888);
    flex-shrink: 0;
  }

  .ai-sel-pop {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 1000;
    width: 290px;
    max-width: calc(100vw - 24px);
    background: var(--n2, #0e0e0e);
    border: 1px solid var(--b1, #2a2a2a);
    border-radius: 10px;
    box-shadow: 0 14px 40px -10px rgba(0, 0, 0, 0.6);
    padding: 6px;
    font-family: var(--ui);
    animation: ai-sel-pop-in 120ms ease-out;
  }
  @keyframes ai-sel-pop-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .ai-sel-pop-head {
    padding: 8px 10px 6px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--t3, #888);
    font-weight: 600;
  }

  .ai-sel-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 7px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .ai-sel-row:hover {
    background: var(--surface-hover, #1a1a1a);
  }
  .ai-sel-row.is-active {
    background: color-mix(in srgb, var(--acc) 10%, transparent);
  }

  .ai-sel-row-glyph {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--acc) 14%, var(--b1));
    color: var(--acc);
    font-size: 11px;
    font-weight: 700;
    font-family: var(--mono, ui-monospace);
    flex-shrink: 0;
  }
  .ai-sel-row-glyph.is-clauge {
    background: var(--acc);
    color: #fff;
  }
  .ai-sel-row-body {
    flex: 1;
    min-width: 0;
  }
  .ai-sel-row-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--t1, #ddd);
    font-weight: 600;
    line-height: 1.2;
  }
  .ai-sel-row-sub {
    font-size: 11px;
    color: var(--t3, #888);
    margin-top: 2px;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ai-sel-badge {
    font-size: 8.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 2px 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--acc) 16%, transparent);
    color: var(--acc);
    border: 1px solid color-mix(in srgb, var(--acc) 35%, transparent);
  }
  .ai-sel-default-tag {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--b1, #2a2a2a);
    color: var(--t3, #888);
  }
  .ai-sel-row-check {
    color: var(--acc);
    flex-shrink: 0;
  }

  .ai-sel-divider {
    height: 1px;
    background: var(--b1, #2a2a2a);
    margin: 4px 6px;
  }

  .ai-sel-add {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border-radius: 7px;
    border: 0;
    background: transparent;
    color: var(--t2, #aaa);
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }
  .ai-sel-add:hover {
    background: var(--surface-hover, #1a1a1a);
    color: var(--t1, #ddd);
  }
</style>
