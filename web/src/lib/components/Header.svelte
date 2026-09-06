<script lang="ts">
  // Floating top bar: brand, three config chips (always derived from the
  // user's settings), settings and help buttons.
  //
  // `right-96` reserves the 340px rail's column on wide screens; below
  // 1100px the rail becomes a bottom dock and the bar spans full width.
  import { configStore } from '$lib/stores/config.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
  import SettingsIcon from '@lucide/svelte/icons/settings';

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
</script>

<header
  class="chrome fixed left-2 right-2 top-2.5 z-30 flex flex-wrap items-center
         justify-between gap-x-2.5 gap-y-1.5 px-3 py-2
         sm:left-4 sm:right-4 sm:top-4 sm:flex-nowrap sm:px-4 sm:py-2.5
         xl:right-[calc(340px+2rem)]"
>
  <div class="flex min-w-0 flex-1 items-center gap-2.5">
    <svg class="size-[22px] shrink-0 text-primary" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="6.5" width="13" height="11" rx="2" fill="none"
            stroke="currentColor" stroke-width="1.6" />
      <path d="M16 10l6-3v10l-6-3z" fill="none" stroke="currentColor"
            stroke-width="1.6" stroke-linejoin="round" />
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" />
    </svg>
    <span class="truncate text-[15px] font-semibold tracking-tight">ShareTube</span>
  </div>

  <nav class="order-3 flex w-full flex-wrap items-center gap-1.5 sm:order-none sm:w-auto sm:flex-nowrap sm:gap-2.5">
    <Badge variant="secondary">{cfg.runner}</Badge>
    <Badge variant="secondary">{proxyLabel(cfg.proxy_mode)}</Badge>
    <Badge variant="secondary">{ttlLabel(cfg.ttl_seconds)}</Badge>
    <Button variant="outline" size="sm" onclick={onOpenSettings} aria-label="Settings">
      <SettingsIcon />
      <span>settings</span>
    </Button>
    <Button
      variant="outline"
      size="sm"
      class="border-primary/35 hover:border-primary/55"
      onclick={onOpenHelp}
      aria-label="Help"
    >
      <CircleHelpIcon />
      <span>help</span>
    </Button>
  </nav>
</header>
