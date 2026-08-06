<script lang="ts">
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { activeJob } from '$lib/stores/active.svelte';
  import { cancelJob, clearHistory, deleteJob, moveJob } from '$lib/api';
  import type { JobEntry, JobStatus } from '$lib/types';

  // PROCESSING = running (or cancelled-but-not-yet-dead) jobs.
  const processing = $derived(
    jobsStore.jobs
      .filter((j) => j.status === 'running')
      .slice()
      .sort((a, b) => b.created_at - a.created_at)
  );

  // QUEUE = pending jobs, in user-defined order (queue_pos asc).
  const queue = $derived(
    jobsStore.jobs
      .filter((j) => j.status === 'pending')
      .slice()
      .sort((a, b) => a.queue_pos - b.queue_pos)
  );

  // HISTORY = finished / failed jobs (most-recent first).
  const history = $derived(
    jobsStore.jobs
      .filter((j) => j.status === 'done' || j.status === 'error' || j.status === 'cancelled')
      .slice()
      .sort((a, b) => b.created_at - a.created_at)
  );

  function friendlyName(j: JobEntry): string {
    if (j.title) return j.title;
    return shortUrl(j.url);
  }

  function shortUrl(url: string): string {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      const path = u.pathname === '/' ? '' : u.pathname;
      const s = `${host}${path}${u.search}`;
      return s.length > 50 ? s.slice(0, 47) + '…' : s;
    } catch {
      return url.length > 50 ? url.slice(0, 47) + '…' : url;
    }
  }

  function dotClass(status: JobStatus): string {
    if (status === 'running' || status === 'pending') return 'running';
    if (status === 'done') return 'done';
    if (status === 'error') return 'error';
    if (status === 'cancelled') return 'cancelled';
    return '';
  }

  function pct(j: JobEntry): number {
    const pp = j.phase_progress;
    return Math.round(
      pp.Download * 0.3 + pp.Transcode * 0.5 + pp.Upload * 0.2
    );
  }

  function select(j: JobEntry) {
    void activeJob.set(j.id);
  }

  function stop(e: MouseEvent, j: JobEntry) {
    e.stopPropagation();
    void cancelJob(j.id).then(() => jobsStore.refresh());
  }

  function del(e: MouseEvent, j: JobEntry) {
    e.stopPropagation();
    if (!confirm(`Delete "${friendlyName(j)}"?`)) return;
    void deleteJob(j.id).then(() => jobsStore.refresh());
  }

  function move(e: MouseEvent, j: JobEntry, direction: 'up' | 'down') {
    e.stopPropagation();
    void moveJob(j.id, direction).then(() => jobsStore.refresh());
  }

  function clearAll() {
    if (!confirm(`Clear ${history.length} finished job(s) from history?`)) return;
    void clearHistory().then(() => jobsStore.refresh());
  }

  const total = $derived(processing.length + queue.length + history.length);
</script>

<aside class="sidebar">
  <div class="sidebar-head">
    <span class="sidebar-title">Queue &amp; History</span>
    <span class="sidebar-count">{total}</span>
  </div>

  <div class="sidebar-body">
    {#if processing.length > 0}
      <div class="sidebar-group-label">Processing</div>
      {#each processing as j (j.id)}
        <div
          class="queue-item {activeJob.jobId === j.id ? 'active' : ''}"
          onclick={() => select(j)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && select(j)}
        >
          <span class="queue-dot {dotClass(j.status)}"></span>
          <span class="queue-item-url" title={j.url}>{friendlyName(j)}</span>
          <span class="queue-item-meta">{pct(j)}%</span>
          <span class="queue-item-actions">
            <button class="queue-action-btn stop-btn" onclick={(e) => stop(e, j)} title="Force stop">⏹</button>
          </span>
        </div>
      {/each}
    {/if}

    {#if queue.length > 0}
      <div class="sidebar-group-label starting-label">STARTING</div>
      {#each queue as j, i (j.id)}
        <div
          class="queue-item {activeJob.jobId === j.id ? 'active' : ''}"
          onclick={() => select(j)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && select(j)}
        >
          <span class="queue-dot {dotClass(j.status)}"></span>
          <span class="queue-item-url" title={j.url}>{friendlyName(j)}</span>
          <span class="queue-item-actions">
            <button class="queue-action-btn" onclick={(e) => move(e, j, 'up')} disabled={i === 0} title="Move up">↑</button>
            <button class="queue-action-btn" onclick={(e) => move(e, j, 'down')} disabled={i === queue.length - 1} title="Move down">↓</button>
            <button class="queue-action-btn x-btn" onclick={(e) => del(e, j)} title="Delete">✕</button>
          </span>
        </div>
      {/each}
    {/if}

    {#if history.length > 0}
      <div class="sidebar-group-label history-label">
        <span>History</span>
        <button class="clear-btn" onclick={() => clearAll()} title="Clear all history">Clear all</button>
      </div>
      {#each history as j (j.id)}
        <div
          class="queue-item {activeJob.jobId === j.id ? 'active' : ''}"
          onclick={() => select(j)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && select(j)}
        >
          <span class="queue-dot {dotClass(j.status)}"></span>
          <span class="queue-item-url" title={j.url}>{friendlyName(j)}</span>
          <span class="queue-item-actions">
            {#if j.share_url && j.status === 'done'}
              <a
                href={j.direct_url ?? j.share_url}
                class="queue-action-btn"
                onclick={(e) => e.stopPropagation()}
                title="Open share link"
                target="_blank"
                rel="noopener"
              >↗</a>
            {/if}
            <button class="queue-action-btn x-btn" onclick={(e) => del(e, j)} title="Delete">✕</button>
          </span>
        </div>
      {/each}
    {/if}

    {#if processing.length === 0 && queue.length === 0 && history.length === 0}
      <div class="sidebar-empty">No jobs yet — paste a URL to get started.</div>
    {/if}
  </div>
</aside>
