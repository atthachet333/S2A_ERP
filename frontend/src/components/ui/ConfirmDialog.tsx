import { useEffect } from 'react';
import type { ReactNode } from 'react';

/** กล่องยืนยันแบบใช้ซ้ำได้ (modal) */
export default function ConfirmDialog({ open, title, description, confirmLabel = 'ยืนยัน', cancelLabel = 'ยกเลิก', onConfirm, onClose, tone = 'primary' }: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onClose: () => void;
  tone?: 'primary' | 'danger';
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onMouseDown={(e) => e.stopPropagation()}>
        <h3 id="dlg-title">{title}</h3>
        <div className="dialog-body">{description}</div>
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>{cancelLabel}</button>
          {onConfirm && <button className={`btn ${tone === 'danger' ? 'danger-btn' : 'primary'}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>}
        </div>
      </div>
    </div>
  );
}
