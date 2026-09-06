<script lang="ts">
  import { Select as SelectPrimitive } from 'bits-ui';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import { cn } from '$lib/utils';
  let { class: className, children, ...restProps }: SelectPrimitive.TriggerProps = $props();
</script>
<SelectPrimitive.Trigger
  class={cn(
    'flex h-9 w-full items-center justify-between rounded-md border border-border bg-transparent px-3 py-2 text-sm',
    'focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
    'data-placeholder:text-mute cursor-pointer',
    className
  )}
  {...restProps}
>
  {@render children?.()}
  <ChevronDownIcon class="size-4 shrink-0 text-mute" />
</SelectPrimitive.Trigger>
