<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let {
    class: className,
    pressed = false,
    children,
    ...restProps
  }: HTMLButtonAttributes & { pressed?: boolean } = $props();
</script>

<button
  type="button"
  aria-pressed={pressed}
  class={cn(
    'cursor-pointer rounded-md border px-3 py-1.5 text-xs transition-colors',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    pressed
      ? 'border-primary/40 bg-primary/10 text-primary'
      : 'border-border text-dim hover:bg-surface hover:text-[--fg-2]',
    className
  )}
  {...restProps}
>
  {@render children?.()}
</button>
