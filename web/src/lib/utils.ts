// shadcn-svelte's class merge helper: `clsx` resolves conditionals,
// `tailwind-merge` drops earlier utilities that a later one overrides
// (so a caller's `px-6` beats a component default `px-4`).
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Props helper used by shadcn-svelte components that forward a ref. */
export type WithElementRef<T, U extends EventTarget = HTMLElement> = T & {
  ref?: U | null;
};
