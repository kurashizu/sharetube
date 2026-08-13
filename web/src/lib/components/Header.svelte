<script lang="ts">
  // Floating top bar: brand, three config chips (always derived from the
  // user's settings), settings icon button, help primary button.
  // Same chrome token as the right rail and the modals.
  import { configStore } from '$lib/stores/config.svelte';
  import { jobsStore } from '$lib/stores/jobs.svelte';

  interface Props {
    onOpenSettings: () => void;
    onOpenHelp: () => void;
  }

  let { onOpenSettings, onOpenHelp }: Props = $props();

  // Map proxy_mode enum to the chip label.
  function proxyLabel(mode: string): string {
    if (mode === 'cloudflare-warp') return 'warp';
    if (mode === 'oracle-australia') return 'oracle';
    return 'none';
  }

  // Map TTL seconds to the chip label.
  function ttlLabel(seconds: number): string {
    if (seconds < 60 * 60) return `${Math.round(seconds / 60)} min`;
    if (seconds < 24 * 60 * 60) return `${(seconds / 3600).toFixed(0)} h`;
    return `${(seconds / 86400).toFixed(0)} day${seconds === 86400 ? '' : 's'}`;
  }

  const cfg = $derived(configStore.settings);
  const runningCount = $derived(
    jobsStore.jobs.filter((j) => j.status === 'running').length
  );
</script>

<header class="bar">
  <div class="l">
    <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="6.5" width="13" height="11" rx="2" fill="none"
            stroke="currentColor" stroke-width="1.6" />
      <path d="M16 10l6-3v10l-6-3z" fill="none" stroke="currentColor"
            stroke-width="1.6" stroke-linejoin="round" />
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" />
    </svg>
    <span class="brand">ShareTube</span>
    <span class="hint">unified</span>
  </div>
  <nav class="r">
    <span class="chip"><b>*</b> {cfg.runner}</span>
    <span class="chip"><b>*</b> {proxyLabel(cfg.proxy_mode)}</span>
    <span class="chip"><b>*</b> {ttlLabel(cfg.ttl_seconds)}</span>
    <button class="btn" id="settingsBtn" type="button" onclick={onOpenSettings}
            aria-label="Settings">
      <span>settings</span>
    </button>
    <button class="btn" id="helpBtn" type="button" onclick={onOpenHelp}
            aria-label="Help">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.2 9.4c.3-1.6 1.6-2.6 3.1-2.6 1.7 0 3 1.1 3 2.6 0 1.3-.9 2-1.9 2.5-.9.5-1.4 1.1-1.4 2.1" />
        <circle cx="12" cy="17.2" r="1.1" fill="currentColor" stroke="none" />
      </svg>
      <span>help</span>
    </button>
  </nav>
</header>