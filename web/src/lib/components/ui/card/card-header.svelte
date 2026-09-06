<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  let { class: className, children, ...restProps }: HTMLAttributes<HTMLDivElement> = $props();
</script>
<div class={cn('flex items-center justify-between gap-3 px-5 py-3.5 border-b border-rule', className)} {...restProps}>
  {@render children?.()}
</div>
