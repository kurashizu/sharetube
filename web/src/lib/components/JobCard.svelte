<script lang="ts">
  // Renders three states:
  //   .job          - pending / running / errored / cancelled (single weighted bar)
  //   .job.share    - completed (share URL + preview player)
  //
  // Reuses the same chrome token as the bar / rail. Phase weighting 30/50/20
  // matches the original Svelte component and the runner.
  import { activeJob } from '$lib/stores/active.svelte';
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import LogSection from './LogSection.svelte';
  import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import type { PhaseName } from '$lib/types';

  const PHASES: PhaseName[] = ['Download', 'Transcode', 'Upload'];
  // 30 / 50 / 20 weighted overall pct.
  const WEIGHT: Record<PhaseName, number> = {
    Download: 0.3,
    Transcode: 0.5,
    Upload: 0.2
  };

  const job = $derived(
    activeJob.jobId
      ? jobsStore.jobs.find((j) => j.id === activeJob.jobId) ?? null
      : (jobsStore.active ?? null)
  );

  function phaseOrder(name: PhaseName): number {
    return PHASES.indexOf(name);
  }

  function phaseDone(name: PhaseName): boolean {
    if (job?.status === 'done') return true;
    if (!job?.phase) return false;
    return phaseOrder(name) < phaseOrder(job.phase);
  }

  function phaseActive(name: PhaseName): boolean {
    return job?.phase === name;
  }

  /** Status dot colour. Pending and running share the animated pulse. */
  const dotClass = $derived.by((): string => {
    const s = job?.status ?? 'pending';
    if (s === 'running' || s === 'pending') return 'bg-cyan animate-pulse';
    if (s === 'done') return 'bg-ok';
    if (s === 'error') return 'bg-err';
    if (s === 'cancelled') return 'bg-queued';
    return 'bg-mute';
  });

  /** Badge variant matching the job's lifecycle state. */
  const stateVariant = $derived.by((): BadgeVariant => {
    const s = job?.status ?? 'pending';
    if (s === 'running') return 'running';
    if (s === 'done') return 'done';
    if (s === 'error') return 'error';
    if (s === 'cancelled') return 'cancelled';
    return 'queued';
  });

  const stateLabel = $derived.by((): string => {
    const s = job?.status ?? 'pending';
    if (s === 'pending') return 'queued';
    if (s === 'running') return 'working';
    if (s === 'done') return 'done';
    if (s === 'error') return 'error';
    if (s === 'cancelled') return 'cancelled';
    return '';
  });

  const stopping = $derived(
    job != null && jobsStore.stoppingIds.has(job.id)
  );

  const pendingNote = $derived.by((): string | null => {
    if (job?.status !== 'pending') return null;
    if (job.dispatched) {
      return 'GitHub runner allocated — setting up environment…';
    }
    const pos = job.queue_pos;
    return pos > 1
      ? `Queued (#${pos}) — waiting for a free runner…`
      : 'Waiting for GitHub to allocate a runner…';
  });

  const overallPct = $derived.by((): number => {
    const pp = job?.phase_progress;
    if (!pp) return 0;
    return Math.max(
      0,
      Math.min(
        100,
        Math.round(pp.Download * WEIGHT.Download +
                   pp.Transcode * WEIGHT.Transcode +
                   pp.Upload * WEIGHT.Upload)
      )
    );
  });

  // Build direct mp4 URL for the inline preview. Falls back to /api/download.
  const previewSrc = $derived.by((): string => {
    if (!job?.share_url) return '';
    // share_url is /d/<id> ; we reuse /api/download/<id> as the player src
    // (same route the COPY button uses, serves the transcoded mp4).
    const m = job.direct_url ?? job.share_url;
    return m;
  });
</script>

{#if job?.status === 'done' && job.share_url}
  <!-- Completed job: share link + inline preview -->
  <Card class="border-ok/40">
    <CardHeader class="border-b-0 bg-linear-to-b from-ok/10 to-transparent">
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="size-2 shrink-0 rounded-full bg-ok"></span>
        <CardTitle class="truncate text-base">{job.title ?? job.url}</CardTitle>
      </div>
      <Badge variant="done">done</Badge>
    </CardHeader>

    <CardContent class="flex flex-col gap-3.5">
      <div class="flex flex-col gap-2 sm:flex-row sm:gap-2.5">
        <Input
          readonly
          value={job.direct_url ?? job.share_url}
          aria-label="Direct download link"
        />
        <!-- `copy` + data-copy are handled by the global click handler
             in +layout.svelte, which also flashes the confirmation. -->
        <Button class="copy w-full shrink-0 sm:w-auto sm:min-w-24"
                data-copy={job.direct_url ?? job.share_url}>
          copy
        </Button>
      </div>

      <!-- Inline preview. Serves the transcoded mp4 with Range support
           so the browser can scrub and seek inline. -->
      <video
        class="w-full rounded-md border border-rule bg-black"
        controls
        preload="metadata"
        playsinline
        src={previewSrc}
      >
        <track kind="captions" srclang="en" label="English" default />
      </video>

      <LogSection />
    </CardContent>
  </Card>
{:else}
  <Card>
    <CardHeader>
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="size-2 shrink-0 rounded-full {dotClass}"></span>
        <CardTitle class="truncate text-base">
          {job?.title ?? job?.url ?? 'Idle'}
        </CardTitle>
      </div>
      <div class="flex shrink-0 items-center gap-2.5">
        {#if stopping}
          <Badge variant="cancelled">stopping</Badge>
        {:else}
          <Badge variant={stateVariant}>{stateLabel}</Badge>
          <span class="text-[13px] tabular-nums text-dim">{overallPct}%</span>
        {/if}
      </div>
    </CardHeader>

    <CardContent class="flex flex-col gap-3.5">
      <!-- Single weighted bar: three segments sized 30 / 50 / 20 by flex,
           so each phase occupies its share of the total progress. -->
      <div class="flex h-2 gap-1 overflow-hidden">
        {#each PHASES as name}
          {@const pct = job?.phase_progress?.[name] ?? 0}
          {@const meta = job?.phase_meta?.[name] ?? ''}
          {@const done = phaseDone(name)}
          {@const active = phaseActive(name)}
          {@const widthPct = done ? 100 : Math.min(100, Math.max(0, pct))}
          {@const indet = !done && active && job?.status === 'running' && pct === 0}
          <div
            class="relative overflow-hidden rounded-full bg-surface-2"
            style="flex: {WEIGHT[name]};"
            title="{name}: {done ? '100' : Math.round(pct)}% {meta}"
          >
            <div
              class="h-full rounded-full transition-[width] duration-300 ease-out
                     {done ? 'bg-ok' : active ? 'bg-primary' : 'bg-mute'}
                     {indet ? 'animate-pulse' : ''}"
              style="width: {indet ? 100 : widthPct}%"
            ></div>
          </div>
        {/each}
      </div>

      <div class="grid grid-cols-3 gap-2.5">
        {#each PHASES as name}
          {@const pct = job?.phase_progress?.[name] ?? 0}
          {@const meta = job?.phase_meta?.[name] ?? ''}
          {@const done = phaseDone(name)}
          <div class="flex flex-col gap-0.5">
            <div class="text-[11px] uppercase tracking-[0.12em] text-mute">
              {name.toLowerCase()}
            </div>
            <div class="text-sm tabular-nums text-[--fg-2]">
              {done ? '100' : Math.round(pct)}%
            </div>
            <div class="truncate text-[11px] text-mute">
              {meta || (done ? 'ok' : ' ')}
            </div>
          </div>
        {/each}
      </div>

      {#if job?.status === 'error'}
        <div class="rounded-md border border-err/40 bg-err/10 px-3 py-2 text-[13px] text-err">
          {job.error ?? 'Unknown error'}
        </div>
      {:else if pendingNote}
        <div class="rounded-md border border-queued/40 bg-queued/10 px-3 py-2 text-[13px] text-queued">
          {pendingNote}
        </div>
      {/if}

      <LogSection />
    </CardContent>
  </Card>
{/if}
