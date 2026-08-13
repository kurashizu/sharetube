<script lang="ts">
  // URL input + paste button + run button. Same chrome family as the rest
  // of the page. Validation, submission, focus management and clipboard
  // are kept identical to the original Hero behavior.
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { activeJob } from '$lib/stores/active.svelte';
  import { startJob } from '$lib/api';
  import { configStore } from '$lib/stores/config.svelte';
  import { onMount } from 'svelte';

  let url = $state('');
  let submitting = $state(false);
  let hint = $state('');
  let pasteAvailable = $state(false);

  const isActive = $derived(
    activeJob.job?.status === 'running' ||
      activeJob.job?.status === 'pending'
  );

  // The paste button is enabled only when the browser exposes
  // navigator.clipboard.readText. Insecure contexts / older Safari fall
  // back to focusing the input, so the button is dimmed.
  onMount(() => {
    pasteAvailable =
      typeof navigator !== 'undefined' &&
      !!navigator.clipboard &&
      typeof navigator.clipboard.readText === 'function' &&
      (typeof window !== 'undefined' ? window.isSecureContext : true);
  });

  async function paste() {
    if (!pasteAvailable) {
      document.getElementById('urlInput')?.focus();
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const v = (text ?? '').trim();
      if (/^(https?:\/\/|www\.)[^\s]+$/i.test(v)) {
        url = v;
      } else {
        url = v;
      }
      hint = '';
      document.getElementById('urlInput')?.focus();
    } catch {
      document.getElementById('urlInput')?.focus();
    }
  }

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

<section class="ask">
  <div class="ask-row">
    <input
      id="urlInput"
      class="url"
      type="text"
      placeholder="Paste a video URL..."
      bind:value={url}
      onkeydown={onKeydown}
      disabled={submitting || isActive}
      autocomplete="off"
      spellcheck="false"
    />
    <button class="btn" id="pasteBtn" type="button" onclick={paste}
            class:empty={!pasteAvailable}
            title="Paste from clipboard">
      paste
    </button>
    <button class="btn primary" id="runBtn" type="button" onclick={start}
            disabled={submitting || isActive}>
      {submitting ? 'submitting' : 'run'}
    </button>
  </div>
  <p class="hint">{hint}</p>
</section>