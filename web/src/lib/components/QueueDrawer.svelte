<script lang="ts">
  // Floating right rail. Mirrors the top bar chrome: same surface, border,
  // radius, shadow. Three sections: Processing, Queue, History (paginated).
  // On small screens collapses into a bottom sheet driven by a dock button.
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { activeJob } from '$lib/stores/active.svelte';
  import { cancelJob, clearHistory, deleteJob, moveJob } from '$lib/api';
  import type { JobEntry, JobStatus } from '$lib/types';

  type Tab = 'all' | 'queue' | 'history';
  let tab = $state<Tab>('all');
  let search = $state('');
  let open = $state(false);
  const HISTORY_PAGE_SIZE = 10;

  const processing = $derived(
    jobsStore.jobs
      .filter((j) => j.status === 'running')
      .slice()
      .sort((a, b) => b.created_at - a.created_at)
  );

  const queue = $derived(
    jobsStore.jobs
      .filter((j) => j.status === 'pending')
      .slice()
      .sort((a, b) => a.queue_pos - b.queue_pos)
  );

  const history = $derived(
    jobsStore.jobs
      .filter((j) => j.status === 'done' || j.status === 'error' || j.status === 'cancelled')
      .slice()
      .sort((a, b) => b.created_at - a.created_at)
  );

  const filtered = $derived.by((): JobEntry[] => {
    let list: JobEntry[] = [];
    if (tab === 'all') {
      list = jobsStore.jobs.slice().sort((a, b) => b.created_at - a.created_at);
    } else if (tab === 'queue') {
      list = [...processing, ...queue];
    } else {
      list = history;
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (j) =>
        (j.title ?? '').toLowerCase().includes(q) ||
        j.url.toLowerCase().includes(q)
    );
  });

  const total = $derived(processing.length + queue.length + history.length);

  // History pagination
  let historyPage = $state(1);
  const historyPageCount = $derived(
    Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE))
  );
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
    if (status === 'running' || status === 'pending') return 'run';
    if (status === 'done') return 'ok';
    if (status === 'error') return 'err';
    if (status === 'cancelled') return 'q';
    return '';
  }

  function pct(j: JobEntry): number {
    const pp = j.phase_progress;
    return Math.round(
      pp.Download * 0.3 + pp.Transcode * 0.5 + pp.Upload * 0.2
    );
  }

  function pendingLabel(j: JobEntry): string {
    if (j.status !== 'pending') return '';
    if (j.dispatched) return 'starting';
    return j.queue_pos > 1 ? `q#${j.queue_pos}` : 'waiting';
  }

  function stateLabel(j: JobEntry): string {
    if (jobsStore.stoppingIds.has(j.id)) return 'STOPPING';
    const s = j.status;
    if (s === 'running') return `${pct(j)}%`;
    if (s === 'pending') return pendingLabel(j);
    if (s === 'done') return 'done';
    if (s === 'error') return 'err';
    if (s === 'cancelled') return 'cancel';
    return '';
  }

  function select(j: JobEntry) {
    void activeJob.set(j.id);
  }

  function stop(e: MouseEvent | KeyboardEvent, j: JobEntry) {
    e.stopPropagation();
    jobsStore.markStopping(j.id);
    void cancelJob(j.id).then(() => jobsStore.refresh());
  }
  function del(e: MouseEvent | KeyboardEvent, j: JobEntry) {
    e.stopPropagation();
    if (!confirm(`Delete "${friendlyName(j)}"?`)) return;
    void deleteJob(j.id).then(() => jobsStore.refresh());
  }
  function move(e: MouseEvent | KeyboardEvent, j: JobEntry, direction: 'up' | 'down') {
    e.stopPropagation();
    void moveJob(j.id, direction).then(() => jobsStore.refresh());
  }
  function clearAll() {
    if (!confirm(`Clear ${history.length} finished job(s) from history?`)) return;
    void clearHistory().then(() => jobsStore.refresh());
  }

  function toggleDock() {
    open = !open;
  }
</script>

<aside class="rail" class:open aria-label="Jobs">
  <div class="rail-head">
    <span class="title">Jobs</span>
    <span class="count">{total}</span>
  </div>

  <div class="rail-tabs">
    <button class="rail-tab" class:on={tab === 'all'} type="button"
            onclick={() => (tab = 'all')}>all</button>
    <button class="rail-tab" class:on={tab === 'queue'} type="button"
            onclick={() => (tab = 'queue')}>queue</button>
    <button class="rail-tab" class:on={tab === 'history'} type="button"
            onclick={() => (tab = 'history')}>history</button>
  </div>

  <div class="rail-search">
    <input type="text" placeholder="search…" bind:value={search}
           aria-label="Search jobs" />
  </div>

  <div class="rail-body">
    {#if tab === 'all'}
      {#if filtered.length === 0}
        <div class="rail-empty">No jobs yet — paste a URL to get started.</div>
      {/if}
      {#each filtered as j (j.id)}
        {@const qIdx = queue.indexOf(j)}
        <div class="rail-item {activeJob.jobId === j.id ? 'on' : ''}"
             onclick={() => select(j)} role="button" tabindex="0"
             onkeydown={(e) => e.key === 'Enter' && select(j)}>
          <span class="dot {dotClass(j.status)}"></span>
          <span class="name" title={j.url}>{friendlyName(j)}</span>
          <span class="meta">{stateLabel(j)}</span>
          <span class="actions">
            {#if j.status === 'running'}
              <button class="ic-btn stop" type="button"
                      onclick={(e) => stop(e, j)}
                      onkeydown={(e) => e.key === 'Enter' && stop(e, j)}
                      title="Force stop">X</button>
            {/if}
            {#if j.status === 'pending' && qIdx >= 0}
              <button class="ic-btn up" type="button"
                      onclick={(e) => move(e, j, 'up')}
                      disabled={qIdx === 0} title="Move up">^</button>
              <button class="ic-btn down" type="button"
                      onclick={(e) => move(e, j, 'down')}
                      disabled={qIdx === queue.length - 1} title="Move down">v</button>
              <button class="ic-btn del" type="button"
                      onclick={(e) => del(e, j)}
                      title="Delete">x</button>
            {/if}
            {#if j.share_url && j.status === 'done'}
              <a class="ic-btn" href={j.direct_url ?? j.share_url}
                 onclick={(e) => e.stopPropagation()} target="_blank"
                 rel="noopener" title="Open share link">go</a>
              <button class="ic-btn del" type="button"
                      onclick={(e) => del(e, j)} title="Delete">x</button>
            {/if}
            {#if j.status === 'error' || j.status === 'cancelled'}
              <button class="ic-btn del" type="button"
                      onclick={(e) => del(e, j)} title="Delete">x</button>
            {/if}
          </span>
        </div>
      {/each}
    {:else if tab === 'queue'}
      {#if filtered.length === 0}
        <div class="rail-empty">Nothing in queue or processing.</div>
      {/if}
      {#if processing.length > 0}
        <div class="rail-group">Processing</div>
        {#each processing as j (j.id)}
          <div class="rail-item {activeJob.jobId === j.id ? 'on' : ''}"
               onclick={() => select(j)} role="button" tabindex="0"
               onkeydown={(e) => e.key === 'Enter' && select(j)}>
            <span class="dot {dotClass(j.status)}"></span>
            <span class="name" title={j.url}>{friendlyName(j)}</span>
            <span class="meta">{stateLabel(j)}</span>
            <span class="actions">
              <button class="ic-btn stop" type="button"
                      onclick={(e) => stop(e, j)}
                      title="Force stop">X</button>
            </span>
          </div>
        {/each}
      {/if}
      {#if queue.length > 0}
        <div class="rail-group">Awaiting runner</div>
        {#each queue as j, i (j.id)}
          <div class="rail-item {activeJob.jobId === j.id ? 'on' : ''}"
               onclick={() => select(j)} role="button" tabindex="0"
               onkeydown={(e) => e.key === 'Enter' && select(j)}>
            <span class="dot {dotClass(j.status)}"></span>
            <span class="name" title={j.url}>{friendlyName(j)}</span>
            <span class="meta">{stateLabel(j)}</span>
            <span class="actions">
              <button class="ic-btn up" type="button"
                      onclick={(e) => move(e, j, 'up')} disabled={i === 0}
                      title="Move up">^</button>
              <button class="ic-btn down" type="button"
                      onclick={(e) => move(e, j, 'down')}
                      disabled={i === queue.length - 1} title="Move down">v</button>
              <button class="ic-btn del" type="button"
                      onclick={(e) => del(e, j)} title="Delete">x</button>
            </span>
          </div>
        {/each}
      {/if}
    {:else}
      {#if history.length === 0}
        <div class="rail-empty">No finished jobs yet.</div>
      {/if}
      {#if history.length > 0}
        <div class="rail-group">
          History{history.length > HISTORY_PAGE_SIZE ? ` (${history.length})` : ''}
        </div>
        {#each historyPageItems as j (j.id)}
          <div class="rail-item {activeJob.jobId === j.id ? 'on' : ''}"
               onclick={() => select(j)} role="button" tabindex="0"
               onkeydown={(e) => e.key === 'Enter' && select(j)}>
            <span class="dot {dotClass(j.status)}"></span>
            <span class="name" title={j.url}>{friendlyName(j)}</span>
            <span class="meta">{stateLabel(j)}</span>
            <span class="actions">
              {#if j.share_url && j.status === 'done'}
                <a class="ic-btn" href={j.direct_url ?? j.share_url}
                   onclick={(e) => e.stopPropagation()} target="_blank"
                   rel="noopener" title="Open share link">go</a>
              {/if}
              <button class="ic-btn del" type="button"
                      onclick={(e) => del(e, j)} title="Delete">x</button>
            </span>
          </div>
        {/each}
      {/if}
    {/if}
  </div>

  {#if tab === 'history' && historyPageCount > 1}
    <div class="rail-foot">
      <span class="page-info">{historyPageClamped} / {historyPageCount}</span>
      <div style="display:flex; gap:4px;">
        <button class="page-btn" type="button" onclick={historyPagePrev}
                disabled={historyPageClamped === 1} title="Previous">&lt;</button>
        <button class="page-btn" type="button" onclick={historyPageNext}
                disabled={historyPageClamped === historyPageCount} title="Next">&gt;</button>
      </div>
      <button class="clear" type="button" onclick={clearAll}>clear all</button>
    </div>
  {:else if tab === 'history' && history.length > 0}
    <div class="rail-foot">
      <span></span>
      <span></span>
      <button class="clear" type="button" onclick={clearAll}>clear all</button>
    </div>
  {/if}
</aside>

<div class="dock-wrap">
  <button class="dock-btn" type="button" onclick={toggleDock} aria-label="Open jobs">
    <span>jobs</span>
    <span class="badge">{total}</span>
  </button>
</div>