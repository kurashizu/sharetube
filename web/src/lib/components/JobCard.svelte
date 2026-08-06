<script lang="ts">
  import { activeJob } from '$lib/stores/active.svelte';
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import LogSection from './LogSection.svelte';
  import ShareCard from './ShareCard.svelte';
  import type { PhaseName } from '$lib/types';

  const PHASES: PhaseName[] = ['Download', 'Transcode', 'Upload'];

  // Derive the displayed job straight from the polled list instead of
  // a copied snapshot, so progress/status updates always propagate the
  // moment the poll lands (no stale "Waiting for runner…").
  const job = $derived(
    activeJob.jobId
      ? jobsStore.jobs.find((j) => j.id === activeJob.jobId) ?? null
      : (jobsStore.active ?? null)
  );

  // Whether a given phase is finished (= some later phase has been
  // started, or the job status is `done`).
  function isPhaseDone(name: PhaseName, current: PhaseName | null, status: string): boolean {
    if (status === 'done') return true;
    if (!current) return false;
    return PHASES.indexOf(name) < PHASES.indexOf(current);
  }

  const dotClass = $derived.by((): string => {
    const s = job?.status ?? 'pending';
    if (s === 'running' || s === 'pending') return 'running';
    if (s === 'done') return 'done';
    if (s === 'error') return 'error';
    if (s === 'cancelled') return 'cancelled';
    return '';
  });

  // Friendly explanation for a job that isn't processing yet.
  const pendingNote = $derived.by((): string | null => {
    if (job?.status !== 'pending') return null;
    if (job.dispatched) {
      return 'GitHub runner 已分配,正在配置环境并启动…';
    }
    const pos = job.queue_pos;
    return pos > 1
      ? `正在排队(第 ${pos} 位)等待空闲 runner…`
      : '正在等待 GitHub runner 分配…';
  });

  const overallPct = $derived.by((): number => {
    const pp = job?.phase_progress;
    if (!pp) return 0;
    // Weighted by typical duration: 30 / 50 / 20.
    return Math.max(
      0,
      Math.min(
        100,
        Math.round(pp.Download * 0.3 + pp.Transcode * 0.5 + pp.Upload * 0.2)
      )
    );
  });
</script>

<section class="card job-card">
  <header class="card-header">
    <span class="job-status-dot {dotClass}"></span>
    <span class="job-card-url">{job?.title ?? job?.url ?? ''}</span>
    <span class="job-card-pct">{overallPct}%</span>
  </header>

  <div class="phases">
    {#each PHASES as name}
      {@const pp = job?.phase_progress}
      {@const pct = pp?.[name] ?? 0}
      {@const meta = job?.phase_meta?.[name] ?? ''}
      {@const phaseDone = isPhaseDone(name, job?.phase ?? null, job?.status ?? '')}
      {@const phaseActive = job?.phase === name}
      {@const fillClass = phaseDone ? 'done' : phaseActive ? 'active' : ''}
      {@const labelClass = phaseDone ? 'done' : phaseActive ? 'active' : ''}
      {@const widthPct = phaseDone ? 100 : Math.min(100, Math.max(0, pct))}
      {@const barActive = phaseActive && job?.status === 'running'}
      <div class="phase-row">
        <div class="phase-label {labelClass}">{name}</div>
        <div class="phase-bar">
          <div class="phase-fill {fillClass} {!phaseDone && barActive && pct === 0 ? 'indeterminate' : ''}" style="width: {widthPct}%"></div>
        </div>
        <div class="phase-meta">{phaseDone ? '✓' : barActive ? meta : ''}</div>
      </div>
    {/each}
  </div>

  {#if job?.status === 'done' && job.share_url}
    <ShareCard
      shareUrl={job.share_url}
      directUrl={job.direct_url ?? job.share_url}
      expiresAt={job.expires_at ?? 0}
    />
  {:else if job?.status === 'error'}
    <div class="error-banner">✗ {job.error ?? 'Unknown error'}</div>
  {:else if pendingNote}
    <div class="pending-note">⏳ {pendingNote}</div>
  {/if}

  <LogSection />
</section>
