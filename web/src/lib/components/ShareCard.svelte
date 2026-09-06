<script lang="ts">
  // Standalone share card. JobCard composes an inline share card now,
  // but this component is kept for any other surface that imports it.
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';

  interface Props {
    shareUrl: string;
    directUrl: string;
    expiresAt?: number;
  }

  let { shareUrl, directUrl, expiresAt }: Props = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function copy() {
    void navigator.clipboard.writeText(directUrl).then(() => {
      copied = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1800);
    });
  }
</script>

<Card class="border-ok/40">
  <CardHeader>
    <div class="flex items-center gap-2.5">
      <span class="size-2 rounded-full bg-ok"></span>
      <CardTitle>share ready</CardTitle>
    </div>
    <Badge variant="done">done</Badge>
  </CardHeader>
  <CardContent class="flex flex-col gap-3">
    <div class="flex gap-2.5">
      <Input readonly value={directUrl} aria-label="Direct download link" />
      <Button class="min-w-24 shrink-0" onclick={copy}>
        {copied ? 'copied' : 'copy'}
      </Button>
    </div>
    <a
      class="text-[13px] text-primary underline-offset-4 hover:underline"
      href={shareUrl}
      target="_blank"
      rel="noopener"
    >
      open viewer
    </a>
    {#if expiresAt}
      <div class="text-xs text-mute">
        expires {new Date(expiresAt).toLocaleString()}
      </div>
    {/if}
  </CardContent>
</Card>
