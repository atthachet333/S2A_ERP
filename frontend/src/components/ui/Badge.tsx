import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'success' | 'warning' | 'info' | 'danger' | 'muted' | 'gold';

/** ป้ายสถานะ — ใช้ทั้งสี + ข้อความ/จุด เพื่อไม่สื่อสถานะด้วยสีเพียงอย่างเดียว */
export default function Badge({ variant = 'muted', dot, children, className }: {
  variant?: BadgeVariant;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('badge', variant, className)}>
      {dot && <span className="badge-dot" aria-hidden />}
      {children}
    </span>
  );
}
