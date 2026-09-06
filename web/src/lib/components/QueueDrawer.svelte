<script lang="ts">
  // Floating right rail. Mirrors the top bar chrome: same surface, border,
  // radius, shadow. Three sections: Processing, Queue, History (paginated).
  // On small screens collapses into a bottom sheet driven by a dock button.
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { activeJob } from '$lib/stores/active.svelte';
  import { cancelJob, clearHistory, deleteJob, moveJob } from '$lib/api';
  import type { JobEntry, JobStatus } from '$lib/types';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import SquareIcon from '@lucide/svelte/icons/square';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';

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

  /** Status dot colour, matching JobCard's mapping. */
  function dotClass(status: JobStatus): string {
    if (status === 'running' || status === 'pending') return 'bg-cyan animate-pulse';
    if (status === 'done') return 'bg-ok';
    if (status === 'error') return 'bg-err';
    if (status === 'cancelled') return 'bg-queued';
    return 'bg-mute';
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

<!-- Shared row for every list section. `actions` renders the buttons
     that differ per section (stop / reorder / open / delete). -->
{#snippet railItem(j: JobEntry, actions: import('svelte').Snippet<[JobEntry]>)}
  <div
    class="grid cursor-pointer grid-cols-[auto_1fr_auto_auto] items-center gap-2
           rounded-[10px] border px-2.5 py-2 text-[13px] transition-colors
           {activeJob.jobId === j.id
             ? 'border-primary/40 bg-primary/8'
             : 'border-transparent hover:border-border hover:bg-surface'}"
    onclick={() => select(j)}
    role="button"
    tabindex="0"
    onkeydown={(e) => e.key === 'Enter' && select(j)}
  >
    <span class="size-2 shrink-0 rounded-full {dotClass(j.status)}"></span>
    <span class="truncate text-[--fg-2]" title={j.url}>{friendlyName(j)}</span>
    <span class="shrink-0 text-[11px] tabular-nums text-mute">{stateLabel(j)}</span>
    <span class="flex shrink-0 items-center gap-1">
      {@render actions(j)}
    </span>
  </div>
{/snippet}

{#snippet stopBtn(j: JobEntry)}
  <Button
    variant="outline"
    size="icon"
    class="size-[22px] text-mute hover:border-cancel/40 hover:bg-cancel/15 hover:text-cancel [&_svg]:size-3"
    onclick={(e) => stop(e, j)}
    title="Force stop"
  >
    <SquareIcon />
  </Button>
{/snippet}

{#snippet delBtn(j: JobEntry)}
  <Button
    variant="outline"
    size="icon"
    class="size-[22px] text-mute hover:border-err/40 hover:bg-err/15 hover:text-err [&_svg]:size-3"
    onclick={(e) => del(e, j)}
    title="Delete"
  >
    <Trash2Icon />
  </Button>
{/snippet}

{#snippet openBtn(j: JobEntry)}
  <Button
    variant="outline"
    size="icon"
    href={j.direct_url ?? j.share_url ?? undefined}
    class="size-[22px] text-mute hover:text-primary [&_svg]:size-3"
    onclick={(e) => e.stopPropagation()}
    target="_blank"
    rel="noopener"
    title="Open share link"
  >
    <ExternalLinkIcon />
  </Button>
{/snippet}

{#snippet moveBtns(j: JobEntry, idx: number)}
  <Button
    variant="outline"
    size="icon"
    class="size-[22px] text-mute hover:border-primary/40 hover:text-primary [&_svg]:size-3"
    onclick={(e) => move(e, j, 'up')}
    disabled={idx === 0}
    title="Move up"
  >
    <ChevronUpIcon />
  </Button>
  <Button
    variant="outline"
    size="icon"
    class="size-[22px] text-mute hover:border-primary/40 hover:text-primary [&_svg]:size-3"
    onclick={(e) => move(e, j, 'down')}
    disabled={idx === queue.length - 1}
    title="Move down"
  >
    <ChevronDownIcon />
  </Button>
{/snippet}

<!-- Per-section action sets. -->
{#snippet allActions(j: JobEntry)}
  {@const qIdx = queue.indexOf(j)}
  {#if j.status === 'running'}{@render stopBtn(j)}{/if}
  {#if j.status === 'pending' && qIdx >= 0}
    {@render moveBtns(j, qIdx)}{@render delBtn(j)}
  {/if}
  {#if j.share_url && j.status === 'done'}
    {@render openBtn(j)}{@render delBtn(j)}
  {/if}
  {#if j.status === 'error' || j.status === 'cancelled'}{@render delBtn(j)}{/if}
{/snippet}

{#snippet historyActions(j: JobEntry)}
  {#if j.share_url && j.status === 'done'}{@render openBtn(j)}{/if}
  {@render delBtn(j)}
{/snippet}

<aside
  class="chrome fixed z-30 flex flex-col
         inset-x-4 bottom-4 top-auto max-h-[60vh] transition-transform duration-250
         xl:inset-y-4 xl:left-auto xl:right-4 xl:max-h-none xl:w-[340px] xl:translate-y-0
         {open ? 'translate-y-0' : 'translate-y-[110%] pointer-events-none xl:pointer-events-auto'}"
  aria-label="Jobs"
>
  <div class="flex items-center justify-between border-b border-rule px-3.5 py-3">
    <span class="text-xs uppercase tracking-[0.14em] text-dim">Jobs</span>
    <span
      class="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full
             bg-primary/15 px-1.5 text-[11px] tabular-nums text-primary"
    >
      {total}
    </span>
  </div>

  <div class="flex gap-1 px-2.5 pt-2">
    {#each [['all', 'all'], ['queue', 'queue'], ['history', 'history']] as [value, label]}
      <button
        type="button"
        class="flex-1 rounded-md border py-1.5 text-[11px] uppercase tracking-[0.12em] transition-colors
               {tab === value
                 ? 'border-primary/40 bg-primary/8 text-primary'
                 : 'border-border text-dim hover:bg-surface hover:text-[--fg-2]'}"
        onclick={() => (tab = value as Tab)}
      >
        {label}
      </button>
    {/each}
  </div>

  <div class="px-2.5 pt-2">
    <Input
      class="h-8 bg-surface text-[13px]"
      type="text"
      placeholder="search…"
      bind:value={search}
      aria-label="Search jobs"
    />
  </div>

  <div
    class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 pb-3 pt-2
           [scrollbar-color:var(--rule-2)_transparent] [scrollbar-width:thin]"
  >
    {#if tab === 'all'}
      {#if filtered.length === 0}
        <div class="px-4 py-8 text-center text-[13px] text-mute">
          No jobs yet — paste a URL to get started.
        </div>
      {/if}
      {#each filtered as j (j.id)}
        {@render railItem(j, allActions)}
      {/each}
    {:else if tab === 'queue'}
      {#if filtered.length === 0}
        <div class="px-4 py-8 text-center text-[13px] text-mute">
          Nothing in queue or processing.
        </div>
      {/if}
      {#if processing.length > 0}
        <div class="px-1.5 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-[0.14em] text-mute">
          Processing
        </div>
        {#each processing as j (j.id)}
          {@render railItem(j, stopBtn)}
        {/each}
      {/if}
      {#if queue.length > 0}
        <div class="px-1.5 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-[0.14em] text-mute">
          Awaiting runner
        </div>
        {#each queue as j, i (j.id)}
          {#snippet queueActions(job: JobEntry)}
            {@render moveBtns(job, i)}{@render delBtn(job)}
          {/snippet}
          {@render railItem(j, queueActions)}
        {/each}
      {/if}
    {:else}
      {#if history.length === 0}
        <div class="px-4 py-8 text-center text-[13px] text-mute">
          No finished jobs yet.
        </div>
      {/if}
      {#if history.length > 0}
        <div class="px-1.5 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-[0.14em] text-mute">
          History{history.length > HISTORY_PAGE_SIZE ? ` (${history.length})` : ''}
        </div>
        {#each historyPageItems as j (j.id)}
          {@render railItem(j, historyActions)}
        {/each}
      {/if}
    {/if}
  </div>

  {#if tab === 'history' && history.length > 0}
    <div class="flex items-center justify-between gap-2 border-t border-rule px-3.5 py-2">
      {#if historyPageCount > 1}
        <span class="text-[11px] tabular-nums text-mute">
          {historyPageClamped} / {historyPageCount}
        </span>
        <div class="flex gap-1">
          <Button
            variant="outline"
            size="icon"
            class="size-[26px] [&_svg]:size-3"
            onclick={historyPagePrev}
            disabled={historyPageClamped === 1}
            title="Previous"
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="size-[26px] [&_svg]:size-3"
            onclick={historyPageNext}
            disabled={historyPageClamped === historyPageCount}
            title="Next"
          >
            <ChevronRightIcon />
          </Button>
        </div>
      {:else}
        <span></span>
        <span></span>
      {/if}
      <button
        type="button"
        class="cursor-pointer text-[11px] uppercase tracking-[0.12em] text-mute transition-colors hover:text-err"
        onclick={clearAll}
      >
        clear all
      </button>
    </div>
  {/if}
</aside>

<!-- Bottom dock trigger; the rail is always visible at xl and up. -->
<div class="fixed bottom-4 right-4 z-20 xl:hidden">
  <Button onclick={toggleDock} aria-label="Open jobs" class="shadow-lg">
    <span>jobs</span>
    <span
      class="inline-flex h-5 min-w-5 items-center justify-center rounded-full
             bg-background/20 px-1.5 text-[11px] tabular-nums"
    >
      {total}
    </span>
  </Button>
</div>
