import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';

/**
 * PHASE 7 — modal กลางของ Master Data
 * โครงเดียวกันทุกที่: Header · Description · Form · Validation · Footer
 * แทน modal เฉพาะกิจที่เคยเขียน inline style ซ้ำในหลายหน้า
 *
 * เดสก์ท็อป: กว้าง 560px (ปรับได้ด้วย width)
 * มือถือ: เกือบเต็มจอ เนื้อหาเลื่อนได้ ปุ่มล่างยังเห็นเสมอ
 */
export default function MasterModal({
  open, title, description, error, busy = false,
  confirmLabel, confirmIcon, cancelLabel = 'ยกเลิก',
  onConfirm, onClose, children, width, confirmDisabled = false,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** ข้อความ error ที่แปลเป็นภาษาคนแล้ว (ดู lib/master-validation) */
  error?: string;
  busy?: boolean;
  confirmLabel: string;
  confirmIcon?: ReactNode;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
  /** ความกว้างสูงสุดบนเดสก์ท็อป — ค่าเริ่มต้น 560px */
  width?: number;
  confirmDisabled?: boolean;
}) {
  const titleId = useId();
  const errId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // ESC ปิด · ล็อกพื้นหลัง · คืนโฟกัสให้ปุ่มที่เปิด modal
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="md-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={error ? errId : undefined}
        style={width ? ({ ['--md-modal-w' as string]: `${width}px` }) : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="md-modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="ปิด"><X aria-hidden width={17} /></button>
        </header>

        <div className="md-modal-body">
          {error && <div className="rb-callout warn" role="alert" id={errId}>
            <AlertTriangle aria-hidden /><div><strong>{error}</strong></div>
          </div>}
          {children}
        </div>

        <footer className="md-modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>{cancelLabel}</button>
          <button type="button" className="btn primary" onClick={onConfirm} disabled={busy || confirmDisabled}>
            {busy ? <Loader2 className="spin" aria-hidden width={16} /> : confirmIcon}{confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
