<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils';
  let { class: className, ...restProps }: DialogPrimitive.DescriptionProps = $props();
</script>
<DialogPrimitive.Description
  class={cn('text-xs leading-relaxed text-dim', className)}
  {...restProps}
/>
