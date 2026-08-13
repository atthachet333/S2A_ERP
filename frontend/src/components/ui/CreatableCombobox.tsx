import { useEffect, useMemo, useRef, useState } from 'react';
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
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) => o.label.toLowerCase().includes(term) || (o.sublabel ?? '').toLowerCase().includes(term));
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
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

      {open && (
        <div className="s2a-combo-panel" role="listbox" aria-label={ariaLabel}>
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
          {onCreate && createLabel && (
            <button type="button" className="s2a-combo-add" onClick={() => { onCreate(q.trim()); setOpen(false); }}>
              <Plus className="plus-gold" aria-hidden width={16} />{createLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
