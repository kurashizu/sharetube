<script lang="ts">
  // Segmented single-select control — the settings modal's main input
  // pattern. Thin wrapper so the option styling lives in one place.
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  let {
    class: className,
    children
  }: { class?: string; children?: Snippet } = $props();
</script>

<div class={cn('flex flex-wrap gap-1', className)} role="group">
  {@render children?.()}
</div>
