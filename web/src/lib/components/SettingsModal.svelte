<script lang="ts">
  // Settings modal — identical field set and persistence to the previous
  // implementation, rebuilt on the shadcn Dialog + segmented controls.
  import {
    configStore,
    RESOLUTION_OPTIONS,
    ENCODER_PRESET_OPTIONS,
    TTL_PRESETS
  } from '$lib/stores/config.svelte';
  import type { UserSettings } from '$lib/types';
  import { Button } from '$lib/components/ui/button';
  import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
  } from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group';

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
    if (draft) draft.proxy_mode = v;
  }
  function setRunner(v: UserSettings['runner']) {
    if (draft) draft.runner = v;
  }
  function setTtl(v: number) {
    if (draft) draft.ttl_seconds = v;
  }
  function setPreset(v: string) {
    if (draft) draft.encoder_preset = v;
  }
  function setRes(field: 'max_resolution' | 'output_resolution', v: string) {
    if (draft) (draft as UserSettings)[field] = v;
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
</script>

<Dialog bind:open onOpenChange={(v) => !v && onClose()}>
  <DialogContent class="max-w-2xl">
    <DialogHeader>
      <DialogTitle>Settings</DialogTitle>
    </DialogHeader>

    {#if draft}
      <div class="flex flex-col gap-5">
        <div class="flex flex-col gap-2">
          <Label>Runner</Label>
          <ToggleGroup>
            <ToggleGroupItem pressed={draft.runner === 'mac'}
                             onclick={() => setRunner('mac')}>mac</ToggleGroupItem>
            <ToggleGroupItem pressed={draft.runner === 'linux'}
                             onclick={() => setRunner('linux')}>linux</ToggleGroupItem>
          </ToggleGroup>
          <p class="text-[11px] leading-relaxed text-mute">
            macOS uses VideoToolbox hardware H.264 encoding — roughly 3× faster
            on the same video, but consumes more GitHub Actions quota.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <Label>Proxy</Label>
          <ToggleGroup>
            <ToggleGroupItem pressed={draft.proxy_mode === 'cloudflare-warp'}
                             onclick={() => setProxy('cloudflare-warp')}>warp</ToggleGroupItem>
            <ToggleGroupItem pressed={draft.proxy_mode === 'oracle-australia'}
                             onclick={() => setProxy('oracle-australia')}>oracle</ToggleGroupItem>
            <ToggleGroupItem pressed={draft.proxy_mode === 'disabled'}
                             onclick={() => setProxy('disabled')}>none</ToggleGroupItem>
          </ToggleGroup>
          <p class="text-[11px] leading-relaxed text-mute">
            Cloudflare WARP is enabled by default and routes the whole runner
            through Cloudflare. Oracle Australia uses the secure SOCKS5 tunnel.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <Label>TTL</Label>
          <ToggleGroup>
            {#each TTL_PRESETS as [label, secs]}
              <ToggleGroupItem pressed={draft.ttl_seconds === secs}
                               onclick={() => setTtl(secs)}>{label}</ToggleGroupItem>
            {/each}
          </ToggleGroup>
          <div class="flex items-center gap-2.5">
            <Input class="max-w-40" type="number" min="300" max="604800" step="60"
                   bind:value={draft.ttl_seconds} aria-label="TTL seconds" />
            <span class="text-xs tabular-nums text-dim">{fmtTtl(draft.ttl_seconds)}</span>
          </div>
          <p class="text-[11px] text-mute">Range 5 min … 7 days.</p>
        </div>

        <div class="flex flex-col gap-2">
          <Label>Max source resolution</Label>
          <ToggleGroup>
            {#each RESOLUTION_OPTIONS as r}
              <ToggleGroupItem pressed={draft.max_resolution === r}
                               onclick={() => setRes('max_resolution', r)}>{r}</ToggleGroupItem>
            {/each}
          </ToggleGroup>
          <p class="text-[11px] text-mute">
            Cap on what yt-dlp is allowed to download.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <Label>Output resolution</Label>
          <ToggleGroup>
            {#each RESOLUTION_OPTIONS as r}
              <ToggleGroupItem pressed={draft.output_resolution === r}
                               onclick={() => setRes('output_resolution', r)}>{r}</ToggleGroupItem>
            {/each}
          </ToggleGroup>
          <p class="text-[11px] leading-relaxed text-mute">
            Choose "2160p" to keep source resolution; otherwise downscaled on the GPU.
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-2">
            <Label for="videoBitrate">Video bitrate</Label>
            <Input id="videoBitrate" type="text" bind:value={draft.video_bitrate}
                   placeholder="600k" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="audioBitrate">Audio bitrate</Label>
            <Input id="audioBitrate" type="text" bind:value={draft.audio_bitrate}
                   placeholder="128k" />
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <Label>x264 encoder preset</Label>
          <ToggleGroup>
            {#each ENCODER_PRESET_OPTIONS as p}
              <ToggleGroupItem pressed={draft.encoder_preset === p.value}
                               title={p.hint}
                               onclick={() => setPreset(p.value)}>{p.value}</ToggleGroupItem>
            {/each}
          </ToggleGroup>
          <p class="text-[11px] leading-relaxed text-mute">
            Slower presets produce smaller files but take much longer to encode.
            Applies to Linux only.
          </p>
        </div>
      </div>
    {/if}

    <DialogFooter class="justify-between">
      <Button variant="outline" onclick={resetDefaults}>reset</Button>
      <div class="flex gap-2">
        <Button variant="outline" onclick={onClose}>cancel</Button>
        <Button onclick={save}>save</Button>
      </div>
    </DialogFooter>
  </DialogContent>
</Dialog>
