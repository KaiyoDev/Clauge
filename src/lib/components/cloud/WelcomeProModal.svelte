<script lang="ts">
    import { welcomeProModalOpen } from "$lib/stores/cloud";

    function close() {
        welcomeProModalOpen.set(false);
    }

    function teleportToBody(node: HTMLElement) {
        document.body.appendChild(node);
        return {
            destroy() {
                if (node.parentElement === document.body) node.remove();
            },
        };
    }
</script>

{#if $welcomeProModalOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="overlay" onclick={close} use:teleportToBody>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="modal"
            onclick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-pro-title"
        >
            <div class="badge" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path
                        d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2z"
                    />
                </svg>
            </div>

            <h2 id="welcome-pro-title">Welcome to Clauge Pro</h2>
            <p class="sub">
                Your subscription is active. Everything that comes with Pro is
                now unlocked across the app.
            </p>

            <button class="cta" onclick={close}>Continue</button>
        </div>
    </div>
{/if}

<style>
    .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(6px);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        animation: fade 160ms ease-out;
    }
    .modal {
        position: relative;
        width: 100%;
        max-width: 420px;
        padding: 36px 32px 28px;
        border-radius: var(--radius-lg, 14px);
        border: 1px solid
            color-mix(in srgb, var(--acc, #c2185b) 35%, var(--border, #222));
        background:
            radial-gradient(
                120% 80% at 50% -10%,
                color-mix(in srgb, var(--acc, #c2185b) 22%, transparent) 0%,
                transparent 60%
            ),
            var(--n2, #0e0e0e);
        box-shadow:
            0 24px 60px -20px color-mix(in srgb, var(--acc, #c2185b) 40%, transparent),
            0 0 0 1px color-mix(in srgb, var(--acc, #c2185b) 12%, transparent) inset;
        text-align: center;
        animation: pop 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .badge {
        width: 52px;
        height: 52px;
        margin: 0 auto 18px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--acc, #c2185b);
        background: color-mix(in srgb, var(--acc, #c2185b) 14%, transparent);
        border: 1px solid color-mix(in srgb, var(--acc, #c2185b) 40%, transparent);
    }
    h2 {
        margin: 0 0 10px;
        font-size: 1.4rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--t1, #fff);
    }
    .sub {
        margin: 0 0 24px;
        font-size: 0.9rem;
        line-height: 1.55;
        color: var(--t2, #aaa);
    }
    .cta {
        appearance: none;
        border: 0;
        cursor: pointer;
        width: 100%;
        padding: 12px 20px;
        border-radius: var(--radius-md, 8px);
        background: var(--acc, #c2185b);
        color: #fff;
        font-family: inherit;
        font-size: 0.9rem;
        font-weight: 600;
        transition:
            transform 0.12s,
            opacity 0.12s;
    }
    .cta:hover {
        opacity: 0.92;
        transform: translateY(-1px);
    }
    @keyframes fade {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    @keyframes pop {
        from { opacity: 0; transform: translateY(8px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
    }
</style>
