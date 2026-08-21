import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Plus, Check, Loader2 } from 'lucide-react';

/**
 * Combobox ค้นหาได้ + สร้างตัวเลือกใหม่ (reusable)
 * ใช้ร่วมกันในหน้า Orders (เลือก/เพิ่มลูกค้า) และ Receiving (คลัง/ซัพพลายเออร์/สินค้า)
 * - แถวแสดง: avatar + ชื่อ (เข้ม/ตัวหนา) + ข้อมูลรอง (รหัส · เบอร์) ที่อ่านง่าย
 * - สถานะ hover / keyboard focus / selected ชัดเจน (ดูสไตล์ .s2a-combo-* ใน workspace.css)
 * - รองรับคีย์บอร์ด: ลูกศรขึ้น/ลง เลือกด้วย Enter ปิดด้วย Escape
 * - onCreate ได้รับข้อความค้นหาปัจจุบันเพื่อ prefill ฟอร์มสร้างใหม่ (parent เปิด modal เอง)
 */
export interface ComboOption { value: string; label: string; sublabel?: string; disabled?: boolean }

const initials = (label: string) => label.trim().slice(0, 2).toUpperCase() || '—';

export default function CreatableCombobox({
  value, onChange, options, placeholder = 'เลือก…', searchPlaceholder = 'ค้นหา…',
  emptyText = 'ไม่พบรายการ', createLabel, onCreate, disabled = false, loading = false, ariaLabel,
  resolveExisting, reuseLabel = 'ใช้รายการนี้',
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  createLabel?: string;
  onCreate?: (query: string) => void;
  disabled?: boolean;
  loading?: boolean;
  ariaLabel?: string;
  /**
   * ตรวจว่าคำค้นตรงกับรายการที่ "มีอยู่แล้ว" หรือไม่ (เช่น หน่วย ML ที่มีในระบบ แต่ไม่อยู่ในตัวเลือกที่ใช้ได้)
   * ถ้าคืนค่ามา จะแสดงปุ่ม "ใช้รายการนี้" แทน "+ เพิ่มใหม่" เพื่อกันการสร้างซ้ำ
   */
  resolveExisting?: (query: string) => { label: string; hint?: string; onUse: () => void } | null;
  reuseLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // ตำแหน่ง panel แบบ fixed — เรนเดอร์ผ่าน portal จึงไม่ถูก overflow ของการ์ดแม่ตัด
  // และไม่ต้องแข่ง z-index กับ stacking context ของ section อื่น
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number; drop: 'down' | 'up' } | null>(null);

  const place = useCallback(() => {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const margin = 12, gap = 6;
    const width = Math.min(Math.max(trigger.width, 320), Math.max(window.innerWidth - margin * 2, 200));
    const below = window.innerHeight - trigger.bottom - gap - margin;
    const above = trigger.top - gap - margin;
    // เปิดลงถ้าพื้นที่ด้านล่างพอ ไม่พอให้พลิกขึ้น (เลือกด้านที่กว้างกว่า)
    const drop: 'down' | 'up' = below >= 240 || below >= above ? 'down' : 'up';
    const maxHeight = Math.max(Math.min(360, drop === 'down' ? below : above), 160);
    let left = trigger.left;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
    if (left < margin) left = margin;
    const top = drop === 'down' ? trigger.bottom + gap : Math.max(margin, trigger.top - gap - maxHeight);
    setPos({ top, left, width, maxHeight, drop });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => place();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => { window.removeEventListener('scroll', onScrollOrResize, true); window.removeEventListener('resize', onScrollOrResize); };
  }, [open, place]);

  const selected = options.find((o) => o.value === value) ?? null;
  // คำค้นตรงกับรายการที่มีอยู่แล้วในระบบหรือไม่ (คำนวณเฉพาะตอนพิมพ์)
  const existing = useMemo(() => {
    const term = q.trim();
    if (!term || !resolveExisting) return null;
    return resolveExisting(term);
  }, [q, resolveExisting]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) => o.label.toLowerCase().includes(term) || (o.sublabel ?? '').toLowerCase().includes(term));
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // panel อยู่ใน portal จึงไม่ได้อยู่ใต้ rootRef — ต้องเช็คทั้งสองที่
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  useEffect(() => { if (open) { setHighlight(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const pick = (val: string) => { onChange(val); setOpen(false); setQ(''); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const opt = filtered[highlight]; if (opt && !opt.disabled) pick(opt.value); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  return (
    <div ref={rootRef} className="s2a-combo">
      <button type="button" className="s2a-combo-trigger" disabled={disabled} data-placeholder={selected ? undefined : 'true'}
        aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen((v) => !v)}>
        {loading ? <Loader2 className="spin" width={16} aria-hidden /> : null}
        <span className="combo-value">{selected ? selected.label : placeholder}</span>
        <ChevronDown className="chev" width={16} aria-hidden />
      </button>

      {open && createPortal(
        <div ref={panelRef} className={`s2a-combo-panel is-portal drop-${pos?.drop ?? 'down'}`} role="listbox" aria-label={ariaLabel}
          style={pos ? { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight } : { visibility: 'hidden' }}>
          <div className="search-box s2a-combo-search">
            <Search aria-hidden />
            <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setHighlight(0); }} onKeyDown={onKeyDown} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
          </div>
          <div className="s2a-combo-list">
            {filtered.length === 0 && <div className="s2a-combo-empty">{emptyText}</div>}
            {filtered.map((o, i) => (
              <button type="button" key={o.value} role="option" aria-selected={o.value === value} disabled={o.disabled}
                className={`s2a-combo-option${i === highlight ? ' is-active' : ''}${o.value === value ? ' is-selected' : ''}`}
                onMouseEnter={() => setHighlight(i)} onClick={() => pick(o.value)}>
                <span className="co-avatar" aria-hidden>{initials(o.label)}</span>
                <span className="co-body">
                  <span className="co-name">{o.label}</span>
                  {o.sublabel && <span className="co-sub">{o.sublabel}</span>}
                </span>
                {o.value === value && <Check className="co-check" width={16} aria-hidden />}
              </button>
            ))}
          </div>
          {/* มีอยู่แล้ว → เสนอให้ใช้ของเดิม ไม่พาไป flow สร้างใหม่ */}
          {existing ? (
            <button type="button" className="s2a-combo-add is-reuse" onClick={() => { existing.onUse(); setOpen(false); setQ(''); }}>
              <Check className="co-check" aria-hidden width={16} />
              <span>{reuseLabel}: <b>{existing.label}</b>{existing.hint && <em> · {existing.hint}</em>}</span>
            </button>
          ) : onCreate && createLabel ? (
            <button type="button" className="s2a-combo-add" onClick={() => { onCreate(q.trim()); setOpen(false); }}>
              <Plus className="plus-gold" aria-hidden width={16} />{createLabel}
            </button>
          ) : null}
        </div>,
        document.body,
      )}
    </div>
  );
}
