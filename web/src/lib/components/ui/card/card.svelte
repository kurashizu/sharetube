<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  let { class: className, children, ...restProps }: HTMLAttributes<HTMLDivElement> = $props();
</script>
<div class={cn('chrome text-card-foreground', className)} {...restProps}>
  {@render children?.()}
</div>
