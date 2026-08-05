import type { ReactNode } from 'react';
import { Activity, CheckCircle2, XCircle, Database, RefreshCw } from 'lucide-react';
import { useHealth } from '@/hooks/useHealth';
import { cn } from '@/lib/utils';

/**
 * หน้าทดสอบการเชื่อมต่อ Backend Health API ผ่าน Vite proxy (/api/health)
 * เป็นหน้าตรวจสอบระบบสำหรับ Phase 1
 */
export default function HealthPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useHealth();

  const apiOnline = !isError && !isLoading;
  const dbOnline = data?.db === 'up';

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="p-6 border-b flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <Activity className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{import.meta.env.VITE_APP_NAME ?? 'S2A ERP'}</h1>
            <p className="text-sm text-muted-foreground">ตรวจสอบการเชื่อมต่อระบบ (Phase 1)</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <StatusRow
            label="Frontend (Port 1414)"
            online
            detail="กำลังทำงาน"
            icon={<CheckCircle2 className="h-5 w-5" />}
          />
          <StatusRow
            label="Backend API (/api/health)"
            online={apiOnline}
            loading={isLoading}
            detail={
              isLoading
                ? 'กำลังเชื่อมต่อ...'
                : apiOnline
                  ? `เชื่อมต่อสำเร็จ · v${data?.version ?? '-'}`
                  : `เชื่อมต่อไม่ได้: ${error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'}`
            }
            icon={apiOnline ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
          />
          <StatusRow
            label="ฐานข้อมูล PostgreSQL"
            online={dbOnline}
            detail={dbOnline ? 'เชื่อมต่อสำเร็จ' : 'ยังไม่เชื่อมต่อ (ตรวจ docker + migrate)'}
            icon={<Database className="h-5 w-5" />}
          />

          {data && (
            <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              <div>สถานะ: {data.status}</div>
              <div>Uptime: {data.uptime}s</div>
              <div>เวลา: {new Date(data.timestamp).toLocaleString('th-TH')}</div>
            </div>
          )}

          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            ตรวจสอบอีกครั้ง
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  online,
  loading,
  detail,
  icon,
}: {
  label: string;
  online: boolean;
  loading?: boolean;
  detail: string;
  icon: ReactNode;
}) {
  const color = loading ? 'text-muted-foreground' : online ? 'text-success' : 'text-danger';
  return (
    <div className="flex items-start gap-3">
      <span className={cn('mt-0.5', color)}>{icon}</span>
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}
