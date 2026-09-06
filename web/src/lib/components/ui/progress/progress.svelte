<script lang="ts">
  import { Progress as ProgressPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils';

  let {
    class: className,
    indicatorClass,
    value = 0,
    max = 100,
    ...restProps
  }: ProgressPrimitive.RootProps & { indicatorClass?: string } = $props();
</script>

<ProgressPrimitive.Root
  class={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}
  {value}
  {max}
  {...restProps}
>
  <div
    class={cn('h-full w-full flex-1 bg-primary transition-transform duration-300', indicatorClass)}
    style="transform: translateX(-{100 - (100 * (value ?? 0)) / (max || 1)}%)"
  ></div>
</ProgressPrimitive.Root>
