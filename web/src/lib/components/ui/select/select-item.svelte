<script lang="ts">
  import { Select as SelectPrimitive } from 'bits-ui';
  import CheckIcon from '@lucide/svelte/icons/check';
  import { cn } from '$lib/utils';
  let {
    class: className,
    value,
    label,
    children,
    ...restProps
  }: SelectPrimitive.ItemProps = $props();
</script>
<SelectPrimitive.Item
  {value}
  {label}
  class={cn(
    'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-7 pr-2 text-sm outline-none',
    'data-highlighted:bg-surface-2 data-highlighted:text-foreground',
    'data-disabled:pointer-events-none data-disabled:opacity-50',
    className
  )}
  {...restProps}
>
  {#snippet children({ selected })}
    {#if selected}
      <span class="absolute left-2 flex size-3.5 items-center justify-center">
        <CheckIcon class="size-3.5 text-primary" />
      </span>
    {/if}
    {label ?? value}
  {/snippet}
</SelectPrimitive.Item>
