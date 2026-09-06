<script lang="ts">
  import { Switch as SwitchPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils';
  let {
    class: className,
    checked = $bindable(false),
    ...restProps
  }: SwitchPrimitive.RootProps = $props();
</script>
<SwitchPrimitive.Root
  bind:checked
  class={cn(
    'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
    'data-[state=checked]:bg-primary data-[state=unchecked]:bg-surface-2',
    className
  )}
  {...restProps}
>
  <SwitchPrimitive.Thumb
    class={cn(
      'pointer-events-none block size-4 rounded-full bg-foreground shadow-sm transition-transform',
      'data-[state=checked]:translate-x-4 data-[state=checked]:bg-background data-[state=unchecked]:translate-x-0.5'
    )}
  />
</SwitchPrimitive.Root>
