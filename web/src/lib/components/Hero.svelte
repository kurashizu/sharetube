<script lang="ts">
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { activeJob } from '$lib/stores/active.svelte';
  import { startJob } from '$lib/api';
  import { configStore } from '$lib/stores/config.svelte';

  let url = $state('');
  let submitting = $state(false);
  let hint = $state('');

  const isActive = $derived(
    activeJob.job?.status === 'running' ||
      activeJob.job?.status === 'pending'
  );

  async function start() {
    const trimmed = url.trim();
    if (!trimmed) {
      hint = 'Please paste a URL.';
      return;
    }
    if (!/^https?:\/\//.test(trimmed)) {
      hint = 'URL must start with http:// or https://';
      return;
    }
    hint = '';
    submitting = true;
    try {
      const cfg = configStore.settings;
      const res = await startJob({
        url: trimmed,
        config: {
          max_resolution: cfg.max_resolution,
          output_resolution: cfg.output_resolution,
          video_bitrate: cfg.video_bitrate,
          audio_bitrate: cfg.audio_bitrate,
          ttl_seconds: cfg.ttl_seconds,
          // Watermark and cookies are always on (branding + bot wall);
          // runner and proxy route follow the user's settings.
          watermark_enabled: true,
          watermark_line1: 'sharetube.krsz.in',
          watermark_line2: '{title} · {resolution} · {duration}',
          watermark_font_size: 28,
          encoder_preset: cfg.encoder_preset,
          runner: cfg.runner,
          use_cookies: true,
          proxy_mode: cfg.proxy_mode
        }
      });
      activeJob.set(res.id);
      await jobsStore.refresh();
      url = '';
    } catch (e) {
      hint = (e as Error).message;
    } finally {
      submitting = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') void start();
  }
</script>

<section class="hero">
  <h1 class="hero-title">Share a video</h1>
  <p class="hero-sub">Paste a URL — we'll download, transcode, and upload.</p>
  <div class="url-form">
    <input
      type="text"
      placeholder="https://youtube.com/watch?v=…"
      bind:value={url}
      onkeydown={onKeydown}
      disabled={submitting || isActive}
      autocomplete="off"
      spellcheck="false"
    />
    <button class="btn btn-primary" onclick={start} disabled={submitting || isActive}>
      {submitting ? 'Submitting…' : '▶ Start'}
    </button>
  </div>
  <div class="hero-hint">{hint}</div>
</section>
