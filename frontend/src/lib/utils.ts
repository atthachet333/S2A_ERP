import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** รวม class ของ Tailwind อย่างปลอดภัย (shadcn/ui convention) */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
