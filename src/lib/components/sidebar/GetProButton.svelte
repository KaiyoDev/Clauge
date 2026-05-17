<script lang="ts">
  import { cloudPlan, upgradeModalOpen } from '$lib/stores/cloud';

  const visible = $derived($cloudPlan !== 'pro');
</script>

{#if visible}
  <button
    class="get-pro-badge"
    onclick={(e) => { e.stopPropagation(); upgradeModalOpen.set(true); }}
    title="Upgrade to Clauge Pro"
    aria-label="Upgrade to Clauge Pro"
  >
    PRO
  </button>
{/if}

<style>
  .get-pro-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    padding: 1px 5px;
    border-radius: 6px;
    border: 1px solid var(--n2, #0e0e0e);
    background: linear-gradient(135deg, var(--acc, #4a90e2), color-mix(in srgb, var(--acc, #4a90e2) 60%, transparent));
    color: white;
    cursor: pointer;
    font-size: 9px;
    font-weight: 700;
    font-family: var(--ui);
    letter-spacing: 0.04em;
    line-height: 1;
    white-space: nowrap;
    z-index: 1;
    pointer-events: auto;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }
  .get-pro-badge:hover {
    transform: scale(1.08);
    box-shadow: 0 2px 4px rgba(74, 144, 226, 0.5);
  }
</style>
