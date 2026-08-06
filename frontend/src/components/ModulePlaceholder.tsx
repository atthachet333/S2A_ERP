import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Compass, HardHat, type LucideIcon } from 'lucide-react';
import { MODULES, STATUS_BADGE, STATUS_LABEL, type ModuleStatus } from './layout/nav-config';
import Badge, { type BadgeVariant } from '@/components/ui/Badge';

export interface ModulePlaceholderProps {
  title: string;
  description: string;
  icon: LucideIcon;
  status: ModuleStatus;
  plannedFeatures?: string[];
}

/** เนื้อหา Placeholder ที่ใช้ดีไซน์เดียวกันทุกโมดูล */
export function ModulePlaceholderView({ title, description, icon: Icon, status, plannedFeatures = [] }: ModulePlaceholderProps) {
  return (
    <div className="placeholder-page">
      <div className="card placeholder-hero">
        <span className="icon-chip gold"><Icon aria-hidden /></span>
        <Badge variant={STATUS_BADGE[status] as BadgeVariant} dot>
          <HardHat aria-hidden style={{ width: 13, height: 13 }} />
          {status === 'ready' ? STATUS_LABEL[status] : `${STATUS_LABEL[status]} · อยู่ระหว่างการพัฒนา`}
        </Badge>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>

      {plannedFeatures.length > 0 && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2>สิ่งที่จะรองรับในอนาคต</h2>
              <p>ฟีเจอร์ที่วางแผนไว้สำหรับโมดูลนี้</p>
            </div>
          </div>
          <div className="feature-preview">
            {plannedFeatures.map((feature, i) => (
              <div className="feature-item" key={feature}>
                <span className="fi-num">{i + 1}</span>
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="placeholder-actions">
        <Link to="/dashboard" className="btn primary"><ArrowLeft aria-hidden />กลับสู่ภาพรวม</Link>
        <Link to="/reports" className="btn"><Compass aria-hidden />ดูแผนการพัฒนา</Link>
      </div>
    </div>
  );
}

/** Route element — อ่าน metadata ของโมดูลจาก path ปัจจุบัน */
export default function ModulePlaceholder() {
  const { pathname } = useLocation();
  const meta = MODULES[pathname];
  if (!meta) {
    return (
      <ModulePlaceholderView
        title="โมดูลนี้อยู่ระหว่างการพัฒนา"
        description="ฟีเจอร์นี้กำลังถูกพัฒนา และจะเปิดใช้งานในเฟสถัดไป"
        icon={HardHat}
        status="planned"
      />
    );
  }
  return (
    <ModulePlaceholderView
      title={meta.label}
      description={meta.description}
      icon={meta.icon}
      status={meta.status}
      plannedFeatures={meta.plannedFeatures}
    />
  );
}
