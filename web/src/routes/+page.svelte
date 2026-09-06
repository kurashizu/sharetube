<script lang="ts">
  // Composes the page from the new terminal-style components. No logic
  // changed — settings/help toggles, polling lifecycle, auto-focus on
  // the active job all kept identical.
  import Header from '$lib/components/Header.svelte';
  import Hero from '$lib/components/Hero.svelte';
  import HelpModal from '$lib/components/HelpModal.svelte';
  import JobCard from '$lib/components/JobCard.svelte';
  import QueueDrawer from '$lib/components/QueueDrawer.svelte';
  import SettingsModal from '$lib/components/SettingsModal.svelte';
  import { onDestroy, onMount } from 'svelte';
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { activeJob } from '$lib/stores/active.svelte';
  import { configStore } from '$lib/stores/config.svelte';

  let settingsOpen = $state(false);
  let helpOpen = $state(false);

  onMount(() => {
    configStore.load();
    jobsStore.start();
  });

  onDestroy(() => {
    jobsStore.stop();
  });

  $effect(() => {
    if (activeJob.jobId) return;
    const a = jobsStore.active;
    if (a) activeJob.set(a.id);
  });

  function openSettings() { settingsOpen = true; }
  function closeSettings() { settingsOpen = false; }
  function openHelp() { helpOpen = true; }
  function closeHelp() { helpOpen = false; }
</script>

<svelte:head>
  <title>ShareTube</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="description" content="Download, transcode (VideoToolbox / VAAPI h264), and share a video URL in one click." />
</svelte:head>

<Header onOpenSettings={openSettings} onOpenHelp={openHelp} />

<!-- `xl:pr-*` reserves the fixed rail's 340px column; below xl the rail
     becomes a bottom sheet and main reclaims the full width. Top padding
     clears the fixed header, which wraps to two rows on narrow screens. -->
<main
  class="flex w-full flex-col gap-6 px-3 pb-24 pt-28
         sm:px-6 sm:pb-20 sm:pt-24
         lg:px-14 lg:pb-16
         xl:pr-[calc(340px+3.5rem)]"
>
  <Hero />
  <JobCard />
</main>

<QueueDrawer />

<SettingsModal bind:open={settingsOpen} onClose={closeSettings} />
<HelpModal bind:open={helpOpen} onClose={closeHelp} />