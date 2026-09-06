<script lang="ts">
  // Log viewer. rAF-batched auto-scroll that follows the tail unless the
  // user scrolled up.
  import { activeJob } from '$lib/stores/active.svelte';
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  const job = $derived(
    activeJob.jobId
      ? jobsStore.jobs.find((j) => j.id === activeJob.jobId) ?? null
      : (jobsStore.active ?? null)
  );

  /** Colour a log line by severity inferred from its text. */
  function lineClass(msg: string): string {
    const lower = msg.toLowerCase();
    if (lower.includes('error') || lower.includes('failed')) return 'text-err';
    if (lower.includes('warn') || lower.includes('cancel')) return 'text-queued';
    if (lower.includes('share url') || lower.includes(' uploaded ')) return 'text-ok';
    if (msg.startsWith('$') || msg.startsWith('>')) return 'text-mute';
    return '';
  }

  let bodyEl = $state<HTMLDivElement | null>(null);
  let pinnedToBottom = $state(true);
  let scrollScheduled = false;

  function onScroll() {
    if (!bodyEl) return;
    const nearBottom =
      bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 40;
    pinnedToBottom = nearBottom;
  }

  $effect(() => {
    const lines = job?.log_lines ?? [];
    lines.length;
    if (!bodyEl || !pinnedToBottom || lines.length === 0) return;
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      if (bodyEl && pinnedToBottom) {
        bodyEl.scrollTop = bodyEl.scrollHeight;
      }
    });
  });
</script>

<Card class="overflow-hidden">
  <CardHeader class="bg-surface/60">
    <CardTitle class="text-xs uppercase tracking-[0.14em] text-dim">Log</CardTitle>
  </CardHeader>
  <CardContent class="p-0">
    <!-- The scroll container must be a real element: `bind:this` on a
         component yields the component instance, not a node. -->
    <div
      class="max-h-80 overflow-y-auto px-5 py-3 text-[13px] text-[--fg-2]
             [scrollbar-color:var(--rule-2)_transparent] [scrollbar-width:thin]"
      bind:this={bodyEl}
      onscroll={onScroll}
    >
      {#if !job}
        <div class="text-mute">No active job.</div>
      {:else if job.log_lines.length === 0}
        <div class="text-mute">No output yet.</div>
      {:else}
        {#each job.log_lines as line, i (i)}
          <div class="whitespace-pre-wrap break-all {lineClass(line)}">{line}</div>
        {/each}
      {/if}
    </div>
  </CardContent>
</Card>
