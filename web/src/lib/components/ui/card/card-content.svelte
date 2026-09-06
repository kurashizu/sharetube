<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  let { class: className, children, ...restProps }: HTMLAttributes<HTMLDivElement> = $props();
</script>
<div class={cn('px-5 py-4', className)} {...restProps}>
  {@render children?.()}
</div>
