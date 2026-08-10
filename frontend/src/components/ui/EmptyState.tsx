import type { ReactNode } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** สถานะว่าง / ผิดพลาด แบบใช้ซ้ำได้ */
export default function EmptyState({ icon: Icon = Inbox, title, description, action, variant = 'empty' }: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: 'empty' | 'error';
}) {
  return (
    <div className={cn('empty-state', variant === 'error' && 'state-error')} role={variant === 'error' ? 'alert' : undefined}>
      <span className="icon-chip slate"><Icon aria-hidden /></span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action ?? (variant === 'error' ? <button type="button" className="btn" onClick={() => window.location.reload()}>ลองอีกครั้ง</button> : null)}
    </div>
  );
}
