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

  // Short status label for the sidebar (pending jobs have no pct).
  function pendingLabel(j: JobEntry): string {
    if (j.status !== 'pending') return '';
    if (j.dispatched) return 'starting';
    return j.queue_pos > 1 ? `queued #${j.queue_pos}` : 'waiting';
  }

  function select(j: JobEntry) {
    void activeJob.set(j.id);
  }

  function stop(e: MouseEvent, j: JobEntry) {
    e.stopPropagation();
    // Optimistic — show STOPPING immediately, then refresh.
    jobsStore.markStopping(j.id);
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

  // History is paginated (10/page) so the sidebar stays short.
  const HISTORY_PAGE_SIZE = 10;
  let historyPage = $state(1);
  const historyPageCount = $derived(
    Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE))
  );
  // Clamp if the page is now out of range (e.g. items deleted).
  const historyPageClamped = $derived(Math.min(historyPage, historyPageCount));
  const historyPageItems = $derived(
    history.slice(
      (historyPageClamped - 1) * HISTORY_PAGE_SIZE,
      historyPageClamped * HISTORY_PAGE_SIZE
    )
  );
  function historyPagePrev() {
    historyPage = Math.max(1, historyPageClamped - 1);
  }
  function historyPageNext() {
    historyPage = Math.min(historyPageCount, historyPageClamped + 1);
  }
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
          <span class="queue-item-meta">
            {jobsStore.stoppingIds.has(j.id) ? 'STOPPING…' : `${pct(j)}%`}
          </span>
          <span class="queue-item-actions">
            <button class="queue-action-btn stop-btn" onclick={(e) => stop(e, j)} title="Force stop">⏹</button>
          </span>
        </div>
      {/each}
    {/if}

    {#if queue.length > 0}
      <div class="sidebar-group-label queued-label">Awaiting runner</div>
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
          <span class="queue-item-meta">{pendingLabel(j)}</span>
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
        <span>History{history.length > HISTORY_PAGE_SIZE ? ` (${history.length})` : ''}</span>
        <button class="clear-btn" onclick={() => clearAll()} title="Clear all history">Clear all</button>
      </div>
      <div class="history-note" title="Successful downloads auto-delete when their share URL expires (the share link becomes dead anyway). Errored/cancelled jobs are kept for 1 day.">Auto-deletes when share URL expires</div>
      {#each historyPageItems as j (j.id)}
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
      {#if historyPageCount > 1}
        <div class="pagination">
          <button class="page-btn" onclick={() => historyPagePrev()} disabled={historyPageClamped === 1} title="Previous page">‹</button>
          <span class="page-info">{historyPageClamped} / {historyPageCount}</span>
          <button class="page-btn" onclick={() => historyPageNext()} disabled={historyPageClamped === historyPageCount} title="Next page">›</button>
        </div>
      {/if}
    {/if}

    {#if processing.length === 0 && queue.length === 0 && history.length === 0}
      <div class="sidebar-empty">No jobs yet — paste a URL to get started.</div>
    {/if}
  </div>
</aside>
