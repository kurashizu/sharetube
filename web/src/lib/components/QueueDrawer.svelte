<script lang="ts">
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { activeJob } from '$lib/stores/active.svelte';
  import type { JobEntry, JobStatus } from '$lib/types';

  // Queue = pending/running jobs (newest first).
  const queued = $derived(
    jobsStore.jobs
      .filter((j) => j.status === 'pending' || j.status === 'running')
      .slice()
      .sort((a, b) => b.created_at - a.created_at)
  );

  // History = finished / failed jobs (most-recent first).
  const history = $derived(
    jobsStore.jobs
      .filter((j) => j.status === 'done' || j.status === 'error')
      .slice()
      .sort((a, b) => b.created_at - a.created_at)
  );

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
</script>

<aside class="sidebar">
  <div class="sidebar-head">
    <span class="sidebar-title">Queue &amp; History</span>
    <span class="sidebar-count">{queued.length + history.length}</span>
  </div>

  <div class="sidebar-body">
    {#if queued.length > 0}
      <div class="sidebar-group-label">Queue</div>
      {#each queued as j (j.id)}
        <div
          class="queue-item {activeJob.jobId === j.id ? 'active' : ''}"
          onclick={() => select(j)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && select(j)}
        >
          <span class="queue-dot {dotClass(j.status)}"></span>
          <span class="queue-item-url">{shortUrl(j.url)}</span>
          <span class="queue-item-meta">{pct(j)}%</span>
        </div>
      {/each}
    {/if}

    {#if history.length > 0}
      <div class="sidebar-group-label">History</div>
      {#each history as j (j.id)}
        <div
          class="queue-item {activeJob.jobId === j.id ? 'active' : ''}"
          onclick={() => select(j)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && select(j)}
        >
          <span class="queue-dot {dotClass(j.status)}"></span>
          <span class="queue-item-url">{shortUrl(j.url)}</span>
          <span class="queue-item-meta">
            {j.status === 'done' ? '✓' : j.status === 'error' ? '✗' : pct(j) + '%'}
          </span>
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
        </div>
      {/each}
    {/if}

    {#if queued.length === 0 && history.length === 0}
      <div class="sidebar-empty">No jobs yet — paste a URL to get started.</div>
    {/if}
  </div>
</aside>
