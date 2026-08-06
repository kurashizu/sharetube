<script lang="ts">
  import Header from '$lib/components/Header.svelte';
  import Hero from '$lib/components/Hero.svelte';
  import JobCard from '$lib/components/JobCard.svelte';
  import QueueDrawer from '$lib/components/QueueDrawer.svelte';
  import SettingsModal from '$lib/components/SettingsModal.svelte';
  import { onDestroy, onMount } from 'svelte';
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { activeJob } from '$lib/stores/active.svelte';
  import { configStore } from '$lib/stores/config.svelte';

  let settingsOpen = $state(false);

  onMount(() => {
    configStore.load();
    jobsStore.start();
    // Auto-focus the most-recent active job on first poll so the user
    // sees their work right away.
    const t = setTimeout(() => {
      if (!activeJob.jobId) {
        const a = jobsStore.active;
        if (a) activeJob.set(a.id);
      }
    }, 1200);
    return () => clearTimeout(t);
  });

  onDestroy(() => {
    jobsStore.stop();
  });

  // Whenever the polled jobs list updates, mirror the active entry
  // into the activeJob store (delta-merged, rAF-coalesced).
  $effect(() => {
    activeJob.sync(jobsStore.jobs);
  });

  function openSettings() {
    settingsOpen = true;
  }
  function closeSettings() {
    settingsOpen = false;
  }
</script>

<svelte:head>
  <title>sharetube</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="description" content="Download, transcode (VAAPI h264), and share a video URL in one click." />
</svelte:head>

<div class="app">
  <Header onOpenSettings={openSettings} />
  <div class="layout">
    <main class="main">
      <Hero />
      <JobCard />
    </main>
    <QueueDrawer />
  </div>
</div>

<SettingsModal bind:open={settingsOpen} onClose={closeSettings} />
