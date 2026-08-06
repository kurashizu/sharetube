<script lang="ts">
  import {
    configStore,
    RESOLUTION_OPTIONS,
    TTL_PRESETS
  } from '$lib/stores/config.svelte';
  import type { UserSettings } from '$lib/types';

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open = $bindable(), onClose }: Props = $props();

  // Working copy — committed on Save.
  let draft = $state<UserSettings | null>(null);

  $effect(() => {
    if (open && !draft) {
      draft = { ...configStore.settings };
    }
    if (!open) {
      draft = null;
    }
  });

  function fmtTtl(seconds: number): string {
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`;
    return `${(seconds / 86400).toFixed(1)} d`;
  }

  function resetDefaults() {
    if (!draft) return;
    configStore.reset();
    draft = { ...configStore.settings };
  }

  function save() {
    if (!draft) return;
    configStore.save(draft);
    onClose();
  }

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open && draft}
  <div
    class="modal-backdrop"
    onclick={onBackdrop}
    onkeydown={(e) => e.key === 'Escape' && onClose()}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">Settings</h2>
        <button class="icon-btn" onclick={onClose} aria-label="Close">✕</button>
      </div>

      <div class="modal-body">
        <div class="field-group">
          <div class="field-group-label">Download</div>

          <div class="field">
            <label class="field-label" for="cfg-max-res">Max source resolution</label>
            <div class="select-wrap">
              <select id="cfg-max-res" class="field-select" bind:value={draft.max_resolution}>
                {#each RESOLUTION_OPTIONS as r}
                  <option value={r}>{r}</option>
                {/each}
              </select>
            </div>
            <div class="field-hint">Cap on what yt-dlp is allowed to download.</div>
          </div>
        </div>

        <div class="field-group">
          <div class="field-group-label">Transcode</div>

          <div class="field">
            <label class="field-label" for="cfg-out-res">Output resolution</label>
            <div class="select-wrap">
              <select id="cfg-out-res" class="field-select" bind:value={draft.output_resolution}>
                {#each RESOLUTION_OPTIONS as r}
                  <option value={r}>{r}</option>
                {/each}
              </select>
            </div>
            <div class="field-hint">Choose "2160p" to keep source resolution; otherwise downscaled on the GPU.</div>
          </div>

          <div class="field">
            <label class="field-label" for="cfg-vbr">Video bitrate</label>
            <input id="cfg-vbr" class="field-input" type="text" bind:value={draft.video_bitrate} placeholder="1M" />
          </div>

          <div class="field">
            <label class="field-label" for="cfg-abr">Audio bitrate</label>
            <input id="cfg-abr" class="field-input" type="text" bind:value={draft.audio_bitrate} placeholder="128k" />
          </div>
        </div>

        <div class="field-group">
          <div class="field-group-label">Share</div>

          <div class="field">
            <label class="field-label" for="cfg-ttl">TTL</label>
            <div class="ttl-row">
              <div class="select-wrap" style="flex: 1">
                <select id="cfg-ttl" class="field-select" bind:value={draft.ttl_seconds}>
                  {#each TTL_PRESETS as [label, secs]}
                    <option value={secs}>{label} ({fmtTtl(secs)})</option>
                  {/each}
                </select>
              </div>
              <input
                class="field-input"
                style="width: 7rem"
                type="number"
                min="300"
                max="604800"
                step="60"
                bind:value={draft.ttl_seconds}
              />
              <span class="dim">{fmtTtl(draft.ttl_seconds)}</span>
            </div>
            <div class="field-hint">Range 5 min … 7 days.</div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-ghost" onclick={resetDefaults}>Reset</button>
        <div style="flex: 1"></div>
        <button class="btn btn-ghost" onclick={onClose}>Cancel</button>
        <button class="btn btn-primary" onclick={save}>Save</button>
      </div>
    </div>
  </div>
{/if}
