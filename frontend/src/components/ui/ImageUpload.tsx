import { useRef, useState, type DragEvent } from 'react';
import { ImagePlus, Loader2, Trash2, RefreshCw } from 'lucide-react';
import { uploadImage } from '@/lib/catalog';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * อัปโหลดรูปจากหน้าเว็บ (PART 10): drag&drop, browse, preview, replace, remove, progress
 * ตรวจ type/ขนาดฝั่ง client ก่อนส่ง — backend ตรวจ magic bytes ซ้ำ (source of truth)
 */
export default function ImageUpload({ kind, value, onChange }: {
  kind: 'items' | 'menus';
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const pick = () => inputRef.current?.click();

  const handleFile = async (file: File) => {
    setError('');
    if (!ACCEPT.includes(file.type)) { setError('รองรับเฉพาะ JPG, PNG, WEBP'); return; }
    if (file.size > MAX_BYTES) { setError('ไฟล์ใหญ่เกิน 5 MB'); return; }
    setBusy(true);
    try {
      const { url } = await uploadImage(kind, file);
      onChange(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อัปโหลดไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="image-upload">
      <input ref={inputRef} type="file" accept={ACCEPT.join(',')} hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }} />

      {value ? (
        <div className="iu-preview">
          <img src={value} alt="ตัวอย่างรูป" />
          <div className="iu-preview-actions">
            <button type="button" className="btn" onClick={pick} disabled={busy}><RefreshCw aria-hidden />เปลี่ยนรูป</button>
            <button type="button" className="btn danger-btn" onClick={() => { onChange(null); setError(''); }} disabled={busy}><Trash2 aria-hidden />ลบรูป</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`iu-drop${dragOver ? ' over' : ''}`}
          onClick={pick}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          disabled={busy}
        >
          {busy ? <Loader2 className="spin" aria-hidden /> : <ImagePlus aria-hidden />}
          <strong>{busy ? 'กำลังอัปโหลด...' : 'ลากรูปมาวาง หรือคลิกเพื่อเลือก'}</strong>
          <span>JPG, PNG, WEBP · สูงสุด 5 MB</span>
        </button>
      )}
      {error && <p className="iu-error">{error}</p>}
    </div>
  );
}
