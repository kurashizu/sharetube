<script lang="ts">
  // Settings modal — identical field set and persistence to the previous
  // implementation, retuned to the new segmented-control look.
  import {
    configStore,
    RESOLUTION_OPTIONS,
    ENCODER_PRESET_OPTIONS,
    TTL_PRESETS
  } from '$lib/stores/config.svelte';
  import type { UserSettings } from '$lib/types';

  interface Props {
    open: boolean;
    onClose: () => void;
  }
  let { open = $bindable(), onClose }: Props = $props();

  let draft = $state<UserSettings | null>(null);

  $effect(() => {
    if (open && !draft) draft = { ...configStore.settings };
    if (!open) draft = null;
  });

  function fmtTtl(seconds: number): string {
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`;
    return `${(seconds / 86400).toFixed(1)} d`;
  }

  function setProxy(v: UserSettings['proxy_mode']) {
    if (!draft) return;
    draft.proxy_mode = v;
  }
  function setRunner(v: UserSettings['runner']) {
    if (!draft) return;
    draft.runner = v;
  }
  function setTtl(v: number) {
    if (!draft) return;
    draft.ttl_seconds = v;
  }
  function setPreset(v: string) {
    if (!draft) return;
    draft.encoder_preset = v;
  }
  function setRes(field: 'max_resolution' | 'output_resolution', v: string) {
    if (!draft) return;
    (draft as UserSettings)[field] = v;
  }

  function resetDefaults() {
    configStore.reset();
    draft = { ...configStore.settings };
  }
  function save() {
    if (!draft) return;
    configStore.save(draft);
    onClose();
  }
  function cancel() { onClose(); }

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open && draft}
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle"
       onclick={onBackdrop} onkeydown={(e) => e.key === 'Escape' && onClose()}
       tabindex="-1">
    <div class="modal-back" data-close></div>
    <div class="modal-card" role="document">
      <header class="modal-head">
        <h2 id="settingsTitle">Settings</h2>
        <button class="x-close" type="button" data-close aria-label="Close"
                onclick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none"
               stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="modal-body">
        <div class="row">
          <div class="row-label">Runner</div>
          <div class="seg" role="tablist">
            <button class="seg-btn" class:on={draft.runner === 'mac'}
                    type="button" onclick={() => setRunner('mac')}>mac</button>
            <button class="seg-btn" class:on={draft.runner === 'linux'}
                    type="button" onclick={() => setRunner('linux')}>linux</button>
          </div>
          <div class="field-hint">macOS uses VideoToolbox hardware H.264 encoding — roughly 3× faster on the same video, but consumes more GitHub Actions quota.</div>
        </div>

        <div class="row">
          <div class="row-label">Proxy</div>
          <div class="seg" role="tablist">
            <button class="seg-btn" class:on={draft.proxy_mode === 'cloudflare-warp'}
                    type="button" onclick={() => setProxy('cloudflare-warp')}>warp</button>
            <button class="seg-btn" class:on={draft.proxy_mode === 'oracle-australia'}
                    type="button" onclick={() => setProxy('oracle-australia')}>oracle</button>
            <button class="seg-btn" class:on={draft.proxy_mode === 'disabled'}
                    type="button" onclick={() => setProxy('disabled')}>none</button>
          </div>
          <div class="field-hint">Cloudflare WARP is enabled by default and routes the whole runner through Cloudflare. Oracle Australia uses the secure SOCKS5 tunnel.</div>
        </div>

        <div class="row">
          <div class="row-label">TTL</div>
          <div class="seg" role="tablist">
            {#each TTL_PRESETS as [label, secs]}
              <button class="seg-btn" class:on={draft.ttl_seconds === secs}
                      type="button" onclick={() => setTtl(secs)}>{label}</button>
            {/each}
          </div>
          <div class="ttl-row">
            <input class="field-input" type="number" min="300" max="604800"
                   step="60" bind:value={draft.ttl_seconds}
                   aria-label="TTL seconds" />
            <span class="ttl-readout">{fmtTtl(draft.ttl_seconds)}</span>
          </div>
          <div class="field-hint">Range 5 min … 7 days.</div>
        </div>

        <div class="row">
          <div class="row-label">Max source resolution</div>
          <div class="seg" role="tablist">
            {#each RESOLUTION_OPTIONS as r}
              <button class="seg-btn" class:on={draft.max_resolution === r}
                      type="button" onclick={() => setRes('max_resolution', r)}>{r}</button>
            {/each}
          </div>
          <div class="field-hint">Cap on what yt-dlp is allowed to download.</div>
        </div>

        <div class="row">
          <div class="row-label">Output resolution</div>
          <div class="seg" role="tablist">
            {#each RESOLUTION_OPTIONS as r}
              <button class="seg-btn" class:on={draft.output_resolution === r}
                      type="button" onclick={() => setRes('output_resolution', r)}>{r}</button>
            {/each}
          </div>
          <div class="field-hint">Choose "2160p" to keep source resolution; otherwise downscaled on the GPU.</div>
        </div>

        <div class="row">
          <div class="row-label">Video bitrate</div>
          <input class="field-input" type="text" bind:value={draft.video_bitrate}
                 placeholder="600k" />
        </div>
        <div class="row">
          <div class="row-label">Audio bitrate</div>
          <input class="field-input" type="text" bind:value={draft.audio_bitrate}
                 placeholder="128k" />
        </div>

        <div class="row">
          <div class="row-label">x264 encoder preset</div>
          <div class="seg" role="tablist">
            {#each ENCODER_PRESET_OPTIONS as p}
              <button class="seg-btn" class:on={draft.encoder_preset === p.value}
                      type="button" title={p.hint}
                      onclick={() => setPreset(p.value)}>{p.value}</button>
            {/each}
          </div>
          <div class="field-hint">Slower presets produce smaller files but take much longer to encode. Applies to Linux only.</div>
        </div>
      </div>

      <footer class="modal-foot">
        <button class="btn" type="button" data-close onclick={resetDefaults}>reset</button>
        <div style="flex: 1"></div>
        <button class="btn" type="button" data-close onclick={cancel}>cancel</button>
        <button class="btn primary" type="button" data-close onclick={save}>save</button>
      </footer>
    </div>
  </div>
{/if}