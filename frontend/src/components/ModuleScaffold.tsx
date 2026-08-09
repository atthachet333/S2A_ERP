import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, HardHat, Plus, Search, FileDown, type LucideIcon } from 'lucide-react';
import { MODULES, STATUS_BADGE, STATUS_LABEL } from './layout/nav-config';
import { MODULE_STRUCTURE } from './layout/module-structure';
import { ModulePlaceholderView } from './ModulePlaceholder';
import Badge, { type BadgeVariant } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';

function DetailScaffold({ path }: { path: string }) {
  const meta = MODULES[path];
  const structure = MODULE_STRUCTURE[path];
  const Icon: LucideIcon = meta.icon;
  const emptyCopy: Record<string, { title: string; description: string }> = {
    '/pricing': { title: 'ยังไม่มีราคาขายที่ต้องจัดการ', description: 'เริ่มจากสร้างเมนูและคำนวณต้นทุน แล้วกำหนดราคาขายที่เหมาะสม' },
    '/receiving': { title: 'ยังไม่มีรายการรับสินค้า', description: 'เริ่มจากรับวัตถุดิบเข้าคลังเพื่อบันทึกล็อต ราคา และวันหมดอายุ' },
    '/production': { title: 'ยังไม่มีใบสั่งผลิต', description: 'สร้างใบสั่งผลิตจากสูตรที่พร้อมใช้งานเพื่อติดตามผลผลิตและ Yield' },
    '/inventory': { title: 'ยังไม่มีข้อมูลคงคลัง', description: 'ยอดคงเหลือจะแสดงเมื่อมีการรับสินค้าและเคลื่อนไหวสต็อก' },
    '/transfers': { title: 'ยังไม่มีรายการโอนคลัง', description: 'สร้างรายการโอนเพื่อย้ายสินค้าอย่างตรวจสอบได้ระหว่างคลัง' },
    '/stock-count': { title: 'ยังไม่มีรอบตรวจนับ', description: 'เริ่มรอบตรวจนับเพื่อเปรียบเทียบยอดจริงกับยอดในระบบ' },
    '/reports': { title: 'เลือกมุมมองรายงาน', description: 'รายงานต้นทุน สต็อก การผลิต ของเสีย และกำไรจะแสดงจากข้อมูลจริง' },
  };
  const empty = emptyCopy[path] ?? { title: `ยังไม่มีข้อมูล${meta.label}`, description: 'เริ่มต้นสร้างรายการแรกเพื่อใช้งานโมดูลนี้' };
  const layout = path === '/reports' ? 'report-layout' : ['/receiving','/production','/transfers','/stock-count'].includes(path) ? 'transaction-layout' : path === '/pricing' ? 'workspace-layout' : 'master-layout';
  const showRoadmap = import.meta.env.VITE_SHOW_ROADMAP === 'true';

  return (
    <div className={`content-scaffold ${layout}`}>
      <div className="page-title-block">
        <p className="eyebrow">{meta.group}</p>
        <h1>{meta.label}</h1>
        <p>{meta.description}</p>
      </div>

      {structure.summary && structure.summary.length > 0 && (
        <div className="stat-grid" style={{ marginTop: 18 }}>
          {structure.summary.map((label) => (
            <article className="card stat-card" key={label}>
              <div className="stat-top">
                <span className="stat-label">{label}</span>
                <span className="icon-chip slate" style={{ width: 34, height: 34 }}><Icon aria-hidden style={{ width: 17, height: 17 }} /></span>
              </div>
              <span className="stat-value">—</span>
              <span className="stat-sub">ยังไม่มีข้อมูล</span>
            </article>
          ))}
        </div>
      )}

      <div className="toolbar" style={{ marginTop: 20 }}>
        <div className="search-box">
          <Search aria-hidden />
          <input placeholder={`ค้นหา${meta.label}`} disabled aria-label={`ค้นหา${meta.label}`} />
        </div>
        {structure.filters?.map((f) => (
          <select key={f} disabled defaultValue="" aria-label={f}>
            <option value="">{f}</option>
          </select>
        ))}
        <span className="count-pill">0 รายการ</span>
        <div className="spacer" />
        {structure.exportable && (
          <button className="btn" disabled title="จะเปิดใช้งานในเฟสถัดไป"><FileDown aria-hidden />Export</button>
        )}
        {structure.addLabel && (
          <button className="btn primary" disabled title="จะเปิดใช้งานในเฟสถัดไป"><Plus aria-hidden />{structure.addLabel}</button>
        )}
      </div>

      <section className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>{structure.columns.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={structure.columns.length} style={{ padding: 0 }}>
                  <EmptyState
                    icon={Icon}
                    title={empty.title}
                    description={empty.description}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {showRoadmap && meta.plannedFeatures && meta.plannedFeatures.length > 0 && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2>สิ่งที่จะรองรับในอนาคต</h2>
              <p>ฟีเจอร์ที่วางแผนไว้สำหรับโมดูลนี้</p>
            </div>
            <Badge variant={STATUS_BADGE[meta.status] as BadgeVariant} dot>
              <HardHat aria-hidden style={{ width: 13, height: 13 }} />{STATUS_LABEL[meta.status]}
            </Badge>
          </div>
          <div className="feature-preview">
            {meta.plannedFeatures.map((feature, i) => (
              <div className="feature-item" key={feature}>
                <span className="fi-num">{i + 1}</span>
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="placeholder-actions" style={{ justifyContent: 'flex-start', marginTop: 22 }}>
        <Link to="/dashboard" className="btn"><ArrowLeft aria-hidden />กลับสู่ภาพรวม</Link>
      </div>
    </div>
  );
}

/**
 * Route element — ถ้ามี MODULE_STRUCTURE ของ path นั้น แสดงโครงหน้าจอละเอียด
 * ถ้าไม่มี fallback ไปหน้า placeholder เดิม (ดีไซน์เดียวกัน)
 */
export default function ModuleScaffold() {
  const { pathname } = useLocation();
  const meta = MODULES[pathname];
  const structure = MODULE_STRUCTURE[pathname];

  if (!meta || !structure) {
    return (
      <ModulePlaceholderView
        title={meta?.label ?? 'โมดูลนี้อยู่ระหว่างการพัฒนา'}
        description={meta?.description ?? 'ฟีเจอร์นี้กำลังถูกพัฒนา และจะเปิดใช้งานในเฟสถัดไป'}
        icon={meta?.icon ?? HardHat}
        status={meta?.status ?? 'planned'}
        plannedFeatures={meta?.plannedFeatures}
      />
    );
  }
  return <DetailScaffold path={pathname} />;
}
