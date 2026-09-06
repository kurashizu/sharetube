import { Dialog as DialogPrimitive } from 'bits-ui';

const Root = DialogPrimitive.Root;
const Trigger = DialogPrimitive.Trigger;
const Close = DialogPrimitive.Close;

export { default as DialogContent } from './dialog-content.svelte';
export { default as DialogHeader } from './dialog-header.svelte';
export { default as DialogTitle } from './dialog-title.svelte';
export { default as DialogDescription } from './dialog-description.svelte';
export { default as DialogFooter } from './dialog-footer.svelte';
export { default as DialogOverlay } from './dialog-overlay.svelte';
export { Root as Dialog, Trigger as DialogTrigger, Close as DialogClose };
