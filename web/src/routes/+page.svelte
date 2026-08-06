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
  });

  onDestroy(() => {
    jobsStore.stop();
  });

  // Auto-focus the most-recent active (pending/running) job whenever
  // the user hasn't manually picked one. Runs on every poll, so a
  // newly submitted job becomes visible immediately.
  $effect(() => {
    if (activeJob.jobId) return;
    const a = jobsStore.active;
    if (a) activeJob.set(a.id);
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
