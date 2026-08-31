import { useState, type FormEvent } from 'react';
import { ArrowLeft, Boxes, Calculator, LoaderCircle, LockKeyhole, ShieldCheck, TrendingUp, Truck, UserRound } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/i18n';
import { loginContent } from '@/i18n/login-content';
import { AuthAlert, AuthBrandPanel, AuthCard, AuthField, AuthShell, PasswordField } from './AuthShell';

/**
 * PHASE 37 — หน้าเข้าสู่ระบบ
 *
 * ของเดิมเป็นฉากตกแต่งขนาดใหญ่: parallax ตามเมาส์, ไดอะแกรมเส้นเคลื่อนไหว,
 * ป้ายลอย 5 อัน, mini-flow และ footer ซ้อนกันหลายชั้น รอบฟอร์มที่มีแค่ 2 ช่อง
 * ผลคือสิ่งที่ผู้ใช้มาทำจริง (กรอกแล้วกดเข้าสู่ระบบ) ไม่ใช่สิ่งที่เด่นที่สุดบนหน้า
 *
 * เฟสนี้ยกฟอร์มขึ้นเป็นตัวเอก และเหลือแผงแบรนด์ไว้เพียงพอที่จะสื่อว่าเป็นระบบอะไร
 *
 * ตรรกะการล็อกอิน ปลายทางการนำทาง และ key ของ localStorage คงเดิมทั้งหมด
 */
export default function LoginExperience() {
  const { messages, locale } = useI18n();
  const auth = messages.auth;
  const visual = loginContent[locale];
  const { user, login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState(() => localStorage.getItem('s2a_remembered_username') ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(localStorage.getItem('s2a_remembered_username')));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to={user.mustChangePassword ? '/change-password' : user.activeCompany ? user.defaultLandingPage : '/select-company'} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const loggedIn = await login(username, password);
      if (remember) localStorage.setItem('s2a_remembered_username', username);
      else localStorage.removeItem('s2a_remembered_username');
      navigate(loggedIn.mustChangePassword ? '/change-password' : '/select-company', { replace: true });
    } catch {
      setError(auth.invalid);
    } finally {
      setBusy(false);
    }
  };

  /* แผงซ้ายเดิมมีแค่หัวข้อสั้น ๆ กับสามบรรทัด ทำให้ดูโล่งและไม่ได้บอกว่าระบบทำอะไรได้บ้าง
     เฟสนี้เพิ่มพาดหัว คำอธิบาย ห้าข้อสรุปความสามารถ ป้ายโมดูล และประโยคปิดท้าย
     ยังคุมปริมาณข้อความไม่ให้กลายเป็นโบรชัวร์ */
  const brand = (
    <AuthBrandPanel
      eyebrow={auth.loginEyebrow}
      title={auth.loginHeadline}
      lead={auth.loginLead}
      tiles={auth.loginTiles.map(([tileTitle, description], index) => ({
        icon: [Calculator, Boxes, Truck, TrendingUp][index] ?? ShieldCheck,
        title: tileTitle,
        description,
      }))}
      tags={[...auth.loginTags]}
      caption={auth.loginCaption}
    />
  );

  return (
    <AuthShell brand={brand}>
      <AuthCard
        kicker={auth.formEyebrow}
        title={auth.signIn}
        subtitle={auth.formLead}
        toolbar={<>
          <Link to="/" className="auth2-back"><ArrowLeft aria-hidden width={16} />{messages.common.backHome}</Link>
          <LanguageSwitcher compact />
        </>}
        footer={<>{auth.noAccount} <Link to="/register">{auth.register}</Link></>}
      >
        <form className="auth2-form" onSubmit={(event) => void submit(event)}>
          {error && <AuthAlert tone="error"><ShieldCheck aria-hidden width={18} />{error}</AuthAlert>}

          <AuthField label={auth.username} icon={UserRound}>
            {({ id, describedBy }) => (
              <input
                id={id}
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={auth.usernamePlaceholder}
                aria-describedby={describedBy}
                required
              />
            )}
          </AuthField>

          <PasswordField
            label={auth.password}
            icon={LockKeyhole}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            placeholder={auth.passwordPlaceholder}
            showLabel={visual.show}
            hideLabel={visual.hide}
          />

          <div className="auth2-options">
            <label>
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              {auth.remember}
            </label>
            <Link to="/forgot-password">{auth.forgot}</Link>
          </div>

          <button className="auth2-submit" disabled={busy}>
            {busy ? <><LoaderCircle className="spin" aria-hidden />{auth.signingIn}</> : auth.signIn}
          </button>
          <p className="auth2-note-line"><ShieldCheck aria-hidden />{auth.formNote}</p>
        </form>
      </AuthCard>
    </AuthShell>
  );
}
