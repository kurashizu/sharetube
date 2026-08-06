<script lang="ts">
  import { activeJob } from '$lib/stores/active.svelte';
  import LogSection from './LogSection.svelte';
  import ShareCard from './ShareCard.svelte';
  import type { PhaseName } from '$lib/types';

  const PHASES: PhaseName[] = ['Download', 'Transcode', 'Upload'];

  // Whether a given phase is finished (= some later phase has been
  // started, or the job status is `done`).
  function isPhaseDone(name: PhaseName, current: PhaseName | null, status: string): boolean {
    if (status === 'done') return true;
    if (!current) return false;
    return PHASES.indexOf(name) < PHASES.indexOf(current);
  }

  const dotClass = $derived.by((): string => {
    const s = activeJob.job?.status ?? 'pending';
    if (s === 'running' || s === 'pending') return 'running';
    if (s === 'done') return 'done';
    if (s === 'error') return 'error';
    return '';
  });

  const overallPct = $derived.by((): number => {
    const pp = activeJob.job?.phase_progress;
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

  function pctClass(pct: number): string {
    if (pct >= 100) return 'done';
    if (pct > 0) return 'active';
    return '';
  }
</script>

<section class="card job-card">
  <header class="card-header">
    <span class="job-status-dot {dotClass}"></span>
    <span class="job-card-url">{activeJob.job?.title ?? activeJob.job?.url ?? ''}</span>
    <span class="job-card-pct">{overallPct}%</span>
  </header>

  <div class="phases">
    {#each PHASES as name}
      {@const pp = activeJob.job?.phase_progress}
      {@const pct = pp?.[name] ?? 0}
      {@const meta = activeJob.job?.phase_meta?.[name] ?? ''}
      {@const phaseDone = isPhaseDone(name, activeJob.job?.phase ?? null, activeJob.job?.status ?? '')}
      {@const fillClass = phaseDone ? 'done' : pctClass(pct)}
      {@const labelClass = phaseDone ? 'done' : pct > 0 ? 'active' : ''}
      <div class="phase-row">
        <div class="phase-label {labelClass}">{name}</div>
        <div class="phase-bar">
          <div class="phase-fill {fillClass}" style="width: {Math.min(100, Math.max(0, pct))}%"></div>
        </div>
        <div class="phase-meta">{phaseDone ? '✓' : meta}</div>
      </div>
    {/each}
  </div>

  {#if activeJob.job?.status === 'done' && activeJob.job?.share_url}
    <ShareCard
      shareUrl={activeJob.job.share_url}
      directUrl={activeJob.job.direct_url ?? activeJob.job.share_url}
      expiresAt={activeJob.job.expires_at ?? 0}
    />
  {:else if activeJob.job?.status === 'error'}
    <div class="error-banner">✗ {activeJob.job.error ?? 'Unknown error'}</div>
  {:else if activeJob.job?.status === 'pending'}
    <div class="dim">Waiting for runner to pick up the job…</div>
  {/if}

  <LogSection />
</section>
