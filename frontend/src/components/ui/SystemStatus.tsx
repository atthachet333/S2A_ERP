import { useHealth } from '@/hooks/useHealth';
import { cn } from '@/lib/utils';

type DotState = 'up' | 'down' | 'loading';

function Dot({ state, label, hideOnNarrow }: { state: DotState; label: string; hideOnNarrow?: boolean }) {
  const text = state === 'loading' ? 'กำลังตรวจสอบ' : state === 'up' ? 'พร้อมใช้งาน' : 'ขัดข้อง';
  return (
    <span className={cn('sys-dot', hideOnNarrow && 'db-label')} title={`${label}: ${text}`}>
      <span className={cn('dot', state)} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

/**
 * แสดงสถานะระบบจาก Health API จริง (ไม่ hardcode)
 * Backend = สถานะการเชื่อมต่อ API, Database = health.db
 */
export default function SystemStatus() {
  const { data, isLoading, isError } = useHealth();
  const backend: DotState = isLoading ? 'loading' : isError ? 'down' : 'up';
  const db: DotState = isLoading ? 'loading' : data?.db === 'up' ? 'up' : 'down';

  const summary = backend === 'up' && db === 'up' ? 'ระบบทั้งหมดพร้อมใช้งาน' : 'ระบบบางส่วนขัดข้อง';

  return (
    <div className="sys-status" role="status" aria-label={summary}>
      <Dot state={backend} label="เซิร์ฟเวอร์" />
      <span className="sys-sep" aria-hidden />
      <Dot state={db} label="ฐานข้อมูล" hideOnNarrow />
    </div>
  );
}
