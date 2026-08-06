<script lang="ts">
  import { activeJob } from '$lib/stores/active.svelte';
  import { jobsStore } from '$lib/stores/jobs.svelte';

  interface Props {
    onOpenSettings: () => void;
  }

  let { onOpenSettings }: Props = $props();

  // Derive the watched job's status straight from the polled list.
  const job = $derived(
    activeJob.jobId
      ? jobsStore.jobs.find((j) => j.id === activeJob.jobId) ?? null
      : (jobsStore.active ?? null)
  );

  // Map job status to pill class + human label.
  const statusInfo = $derived.by((): { class: string; label: string } => {
    const status = job?.status ?? 'idle';
    switch (status) {
      case 'running':
      case 'pending':
        return { class: 'running', label: 'Working' };
      case 'done':
        return { class: 'done', label: 'Done' };
      case 'error':
        return { class: 'error', label: 'Error' };
      case 'cancelled':
        return { class: 'cancelled', label: 'Cancelled' };
      default:
        return { class: '', label: 'Idle' };
    }
  });
</script>

<header class="app-header">
  <div class="brand">
    <span class="brand-logo">▶</span>
    <span class="brand-name">sharetube</span>
  </div>
  <div class="header-right">
    <div class="status-pill {statusInfo.class}">
      <span class="status-dot {statusInfo.class}"></span>
      <span>{statusInfo.label}</span>
    </div>
    <button class="icon-btn" onclick={onOpenSettings} aria-label="Open settings">
      ⚙
    </button>
  </div>
</header>
