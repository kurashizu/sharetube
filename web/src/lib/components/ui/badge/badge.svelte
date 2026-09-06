<script lang="ts" module>
  import { type VariantProps, tv } from 'tailwind-variants';

  export const badgeVariants = tv({
    base: 'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide transition-colors',
    variants: {
      variant: {
        default: 'border-primary/40 bg-primary/15 text-primary',
        secondary: 'border-border bg-surface-2 text-dim',
        outline: 'border-border text-dim',
        // Job lifecycle states, matching the original status colors.
        running: 'border-cyan/40 bg-cyan/15 text-cyan',
        queued: 'border-queued/40 bg-queued/15 text-queued',
        done: 'border-ok/40 bg-ok/15 text-ok',
        error: 'border-err/40 bg-err/15 text-err',
        cancelled: 'border-cancel/40 bg-cancel/15 text-cancel'
      }
    },
    defaultVariants: { variant: 'default' }
  });
  export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
</script>

<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  let {
    class: className,
    variant = 'default',
    children,
    ...restProps
  }: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant } = $props();
</script>
<span class={cn(badgeVariants({ variant }), className)} {...restProps}>
  {@render children?.()}
</span>
