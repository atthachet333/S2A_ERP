import { Link } from 'react-router-dom';
import { AtSign, CalendarClock, CheckCircle2, Clock, Fingerprint, KeyRound, ShieldCheck, UserCircle } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import { formatThaiDate, formatThaiDateTime } from '@/lib/utils';

export default function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <>
      <div className="page-title-block">
        <p className="eyebrow">ACCOUNT</p>
        <h1>โปรไฟล์ของฉัน</h1>
        <p>ข้อมูลบัญชี สิทธิ์การใช้งาน และความปลอดภัย</p>
      </div>

      <div className="profile-layout" style={{ marginTop: 20 }}>
        {/* ซ้าย — บัตรประจำตัว */}
        <aside className="card profile-aside">
          <Avatar name={user.fullName} size="lg" />
          <h2>{user.fullName}</h2>
          <div className="pa-username">@{user.username}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
            {user.roles.map((r) => <Badge key={r} variant="gold">{r}</Badge>)}
          </div>
          <div className="pa-meta">
            <div className="pa-row"><span>สถานะบัญชี</span><Badge variant="success" dot>ใช้งานอยู่</Badge></div>
            <div className="pa-row"><span>เข้าสู่ระบบล่าสุด</span><strong style={{ fontSize: 12.5 }}>{user.lastLoginAt ? formatThaiDateTime(user.lastLoginAt) : 'ครั้งแรก'}</strong></div>
            <div className="pa-row"><span>สร้างบัญชีเมื่อ</span><strong style={{ fontSize: 12.5 }}>{formatThaiDate(user.createdAt)}</strong></div>
          </div>
        </aside>

        {/* ขวา — รายละเอียด */}
        <div className="profile-main">
          <section className="card card-pad">
            <div className="section-head" style={{ marginBottom: 8 }}><div><h2 style={{ fontSize: 16 }}>ข้อมูลบัญชี</h2></div></div>
            <dl className="info-grid">
              <Info icon={UserCircle} label="ชื่อ-นามสกุล" value={user.fullName} />
              <Info icon={AtSign} label="ชื่อผู้ใช้" value={user.username} />
              <Info icon={AtSign} label="อีเมล" value={user.email} />
              <Info icon={ShieldCheck} label="บทบาท" value={user.roles.join(', ')} />
              <Info icon={CalendarClock} label="วันที่สร้างบัญชี" value={formatThaiDate(user.createdAt)} />
              <Info icon={Clock} label="แก้ไขล่าสุด" value={formatThaiDate(user.updatedAt)} />
            </dl>
          </section>

          <section className="card card-pad">
            <div className="section-head" style={{ marginBottom: 10 }}>
              <div><h2 style={{ fontSize: 16 }}>สิทธิ์การใช้งาน</h2><p>สิทธิ์ทั้งหมด {user.permissions.length} รายการตามบทบาท</p></div>
            </div>
            {user.permissions.length > 0 ? (
              <div className="perm-chips">
                {user.permissions.map((p) => <span className="perm-chip" key={p}>{p}</span>)}
              </div>
            ) : <p className="subtle">ยังไม่มีสิทธิ์เฉพาะเจาะจง</p>}
          </section>

          <section className="card card-pad">
            <div className="section-head" style={{ marginBottom: 10 }}><div><h2 style={{ fontSize: 16 }}>ความปลอดภัย</h2></div></div>
            <div className="pa-row" style={{ marginBottom: 12 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13.5 }}>
                <Fingerprint aria-hidden width={17} />สถานะรหัสผ่าน
              </span>
              {user.mustChangePassword
                ? <Badge variant="warning" dot>ต้องเปลี่ยนรหัสผ่าน</Badge>
                : <Badge variant="success" dot><CheckCircle2 aria-hidden />ตั้งค่าแล้ว</Badge>}
            </div>
            <Link to="/account/change-password" className="btn primary"><KeyRound aria-hidden />เปลี่ยนรหัสผ่าน</Link>
          </section>
        </div>
      </div>
    </>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof UserCircle; label: string; value: string }) {
  return (
    <div className="info-row">
      <dt style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon aria-hidden width={13} height={13} />{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
