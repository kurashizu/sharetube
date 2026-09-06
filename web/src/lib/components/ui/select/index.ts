import { Select as SelectPrimitive } from 'bits-ui';

const Root = SelectPrimitive.Root;
const Group = SelectPrimitive.Group;

export { default as SelectTrigger } from './select-trigger.svelte';
export { default as SelectContent } from './select-content.svelte';
export { default as SelectItem } from './select-item.svelte';
export { Root as Select, Group as SelectGroup };
