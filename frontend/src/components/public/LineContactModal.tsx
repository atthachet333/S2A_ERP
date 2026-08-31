import { useEffect, useRef, useState } from 'react';
import { MessageCircle, QrCode, X } from 'lucide-react';

/**
 * PHASE 42 — ป๊อปอัป QR สำหรับเพิ่มเพื่อน LINE Official Account
 *
 * เดิมข้อความ LINE ในส่วนท้ายเป็นข้อความเฉย ๆ กดแล้วไม่เกิดอะไรขึ้น
 *
 * รูป QR ที่ใช้คือไฟล์จริงจาก LINE Official Account Manager
 * (ต้นฉบับชื่อ M_gainfriends_2dbarcodes_GW.png ขนาด 360x360)
 * วางไว้ที่ public/line-qr.png — ไม่มีการสร้างหรือดัดแปลง QR ขึ้นเอง
 *
 * ยังคงทางสำรองไว้: ถ้ารูปโหลดไม่ได้ จะสลับไปแสดงปุ่มเพิ่มเพื่อน
 * ด้วยลิงก์ทางการของ LINE ซึ่งใช้งานได้ทันที
 */

const LINE_ID = '@s2a.customer';
/** รูปแบบลิงก์เพิ่มเพื่อนอย่างเป็นทางการของ LINE (ใช้ id ที่ขึ้นต้นด้วย @) */
const LINE_ADD_URL = `https://line.me/R/ti/p/${encodeURIComponent(LINE_ID)}`;
const QR_SRC = '/line-qr.png';

export interface LineContactCopy {
  title: string;
  subtitle: string;
  idHint: string;
  addFriend: string;
  close: string;
  qrPending: string;
  mobileNote: string;
}

export default function LineContactModal({ copy, onClose }: { copy: LineContactCopy; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);
  const [qrOk, setQrOk] = useState<boolean | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  // Escape ปิด และวนโฟกัสอยู่ในกล่อง
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, [href]')]
        .filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="line-modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="line-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="line-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="line-modal-close" onClick={onClose} aria-label={copy.close}>
          <X aria-hidden />
        </button>

        <span className="line-modal-mark" aria-hidden><MessageCircle /></span>

        <header className="line-modal-head">
          <h2 id="line-modal-title">{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </header>

        <div className="line-modal-qr">
          {qrOk === false ? (
            <div className="line-qr-fallback">
              <QrCode aria-hidden />
              <span>{copy.qrPending}</span>
            </div>
          ) : (
            <img
              src={QR_SRC}
              alt={`${copy.title} — ${LINE_ID}`}
              onLoad={() => setQrOk(true)}
              onError={() => setQrOk(false)}
            />
          )}
        </div>

        <p className="line-modal-id">{LINE_ID}</p>
        <p className="line-modal-hint">{copy.idHint}</p>

        <a className="line-modal-add" href={LINE_ADD_URL} target="_blank" rel="noreferrer noopener">
          <MessageCircle aria-hidden />{copy.addFriend}
        </a>
        <p className="line-modal-mobile-note">{copy.mobileNote}</p>
      </div>
    </div>
  );
}
