<script lang="ts">
  import { activeJob } from '$lib/stores/active.svelte';

  function lineClass(msg: string): string {
    const lower = msg.toLowerCase();
    if (lower.includes('error') || lower.includes('failed') || lower.includes('✗')) return 'err';
    if (lower.includes('warn') || lower.includes('cancel') || lower.includes('⚠')) return 'warn';
    if (msg.startsWith('✓') || msg.includes('share url')) return 'ok';
    if (msg.startsWith('$') || msg.startsWith('>')) return 'dim';
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
    // Touch the log so $effect tracks it.
    const lines = activeJob.job?.log_lines ?? [];
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

<div class="log-section">
  <div class="log-header">
    <span>Log</span>
  </div>
  <div class="log-body" bind:this={bodyEl} onscroll={onScroll}>
    {#if !activeJob.job}
      <div class="log-line dim">No active job.</div>
    {:else if activeJob.job.log_lines.length === 0}
      <div class="log-line dim">No output yet.</div>
    {:else}
      {#each activeJob.job.log_lines as line, i (i)}
        <div class="log-line {lineClass(line)}">{line}</div>
      {/each}
    {/if}
  </div>
</div>
