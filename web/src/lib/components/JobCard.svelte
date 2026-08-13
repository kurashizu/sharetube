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

  const dotClass = $derived.by((): string => {
    const s = job?.status ?? 'pending';
    if (s === 'running' || s === 'pending') return 'run';
    if (s === 'done') return 'ok';
    if (s === 'error') return 'err';
    if (s === 'cancelled') return 'q';
    return '';
  });

  const stateClass = $derived.by((): string => {
    const s = job?.status ?? 'pending';
    if (s === 'running') return 'run';
    if (s === 'done') return 'done';
    if (s === 'error') return 'err';
    if (s === 'cancelled') return 'cancel';
    return 'q';
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
  <!-- Completed job share card -->
  <section class="job share">
    <header class="job-head">
      <span class="dot ok"></span>
      <span class="title">{job.title ?? job.url}</span>
      <span class="grow"></span>
      <span class="state done">done</span>
    </header>

    <div class="share-bar">
      <input class="url" readonly value={job.direct_url ?? job.share_url}
             aria-label="Direct download link" />
      <button class="btn primary copy" type="button"
              data-copy={job.direct_url ?? job.share_url}>
        <span class="lbl">copy</span>
        <span class="ok">copied</span>
      </button>
    </div>

    <!-- Inline preview. Points at the same /api/download/[id] route used by
         the COPY button; the route serves the transcoded mp4 with Range
         support so the browser can scrub and seek inline. -->
    <video class="preview" controls preload="metadata" playsinline
           src={previewSrc}>
      <track kind="captions" srclang="en" label="English" default />
    </video>

    <LogSection />
  </section>
{:else}
  <section class="job">
    <header class="job-head">
      <span class="dot {dotClass}"></span>
      <span class="title">{job?.title ?? job?.url ?? 'Idle'}</span>
      <span class="grow"></span>
      {#if stopping}
        <span class="state cancel">stopping</span>
      {:else}
        <span class="state {stateClass}">{stateLabel}</span>
        <span class="eta">{overallPct}%</span>
      {/if}
    </header>

    <!-- Single weighted progress bar -->
    <div class="bigbar">
      {#each PHASES as name}
        {@const pp = job?.phase_progress}
        {@const pct = pp?.[name] ?? 0}
        {@const meta = job?.phase_meta?.[name] ?? ''}
        {@const done = phaseDone(name)}
        {@const active = phaseActive(name)}
        {@const fill = done ? 'done' : active ? 'active' : ''}
        {@const widthPct = done ? 100 : Math.min(100, Math.max(0, pct))}
        {@const indet = !done && active && job?.status === 'running' && pct === 0}
        <div class="seg {fill} {indet ? 'indeterminate' : ''}"
             style="flex: {WEIGHT[name]};"
             title="{name}: {done ? '100' : Math.round(pct)}% {meta}">
          <div class="fill" style="width: {widthPct}%"></div>
        </div>
      {/each}
    </div>

    <div class="legend">
      {#each PHASES as name}
        {@const pp = job?.phase_progress}
        {@const pct = pp?.[name] ?? 0}
        {@const meta = job?.phase_meta?.[name] ?? ''}
        {@const done = phaseDone(name)}
        <div class="col">
          <div class="k">{name.toLowerCase()}</div>
          <div class="v">{done ? '100' : Math.round(pct)}%</div>
          <div class="meta">{meta || (done ? 'ok' : ' ')}</div>
        </div>
      {/each}
    </div>

    {#if job?.status === 'error'}
      <div class="note err">{job.error ?? 'Unknown error'}</div>
    {:else if pendingNote}
      <div class="note q">{pendingNote}</div>
    {/if}

    <LogSection />
  </section>
{/if}