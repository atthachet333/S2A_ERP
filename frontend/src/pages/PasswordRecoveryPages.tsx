import { useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/i18n';
import { AuthAlert, AuthBrandPanel, AuthCard, AuthField, AuthShell, PasswordField } from '@/components/auth/AuthShell';

/**
 * PHASE 37 — หน้ากู้คืนรหัสผ่าน
 * ย้ายมาใช้โครง AuthShell ชุดเดียวกับหน้าเข้าสู่ระบบ
 * เดิมเป็นการ์ดลอยกลางจอที่ดูโล่งและไม่เข้าพวกกับหน้าอื่น
 *
 * ข้อความ ตรรกะการเรียก API และการนำทางคงเดิมทุกอย่าง
 */

const NEUTRAL = 'หากข้อมูลตรงกับบัญชีในระบบ เราได้เริ่มขั้นตอนรีเซ็ตรหัสผ่านให้แล้ว กรุณาติดต่อผู้ดูแลระบบเพื่อดำเนินการต่อ';

export function ForgotPasswordPage() {
  // Context messages keep this screen synchronized when the locale changes.
  const { locale, messages } = useI18n(); const text = locale === 'en' ? { title:'Forgot password', intro:'Enter your username or email to begin the password reset process.', identifier:'Username or Email', submit:'Continue', busy:'Processing...', complete:'Check the next step', neutral:'If the information matches an account, the password reset process has started. Contact your administrator to continue.', safety:'For security, this message is the same whether or not the account exists.', back:'Back to Sign in' } : locale === 'zh-CN' ? { title:'忘记密码', intro:'请输入用户名或电子邮箱以开始密码重置流程。', identifier:'用户名或电子邮箱', submit:'继续', busy:'正在处理...', complete:'请查看后续步骤', neutral:'如果信息与系统账户匹配，密码重置流程已开始。请联系管理员继续。', safety:'为保障安全，无论账户是否存在，系统均显示相同提示。', back:'返回登录' } : { title:'ลืมรหัสผ่าน', intro:'กรอกชื่อผู้ใช้หรืออีเมลที่ใช้ในระบบ เพื่อเริ่มขั้นตอนรีเซ็ตรหัสผ่าน', identifier:'Username หรือ Email', submit:'ดำเนินการต่อ', busy:'กำลังดำเนินการ...', complete:'ตรวจสอบขั้นตอนต่อไป', neutral:NEUTRAL, safety:'เพื่อความปลอดภัย ข้อความนี้จะเหมือนกันไม่ว่าบัญชีจะมีอยู่หรือไม่', back:'กลับไปเข้าสู่ระบบ' };
  void messages;
  const [identifier, setIdentifier] = useState(''); const [busy, setBusy] = useState(false); const [complete, setComplete] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await apiClient.post('/auth/forgot-password', { identifier }, { token: null }); } finally { setBusy(false); setComplete(true); } };

  const toolbar = <>
    <Link to="/login" className="auth2-back"><ArrowLeft aria-hidden width={16} />{text.back}</Link>
    <LanguageSwitcher compact />
  </>;

  const brand = <AuthBrandPanel eyebrow="ACCOUNT RECOVERY" title={text.title} lead={text.intro} />;

  if (complete) {
    return (
      <AuthShell brand={brand}>
        <AuthCard title={text.complete} subtitle={text.neutral} toolbar={toolbar}>
          <div className="auth2-state">
            <span className="auth2-state-icon is-success"><CheckCircle2 aria-hidden /></span>
            <div className="auth2-note"><ShieldCheck aria-hidden />{text.safety}</div>
            <Link className="auth2-submit" to="/login">{text.back}</Link>
          </div>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell brand={brand}>
      <AuthCard kicker="ACCOUNT RECOVERY" title={text.title} subtitle={text.intro} toolbar={toolbar}>
        <form className="auth2-form" onSubmit={(event) => void submit(event)}>
          <AuthField label={text.identifier} icon={KeyRound}>
            {({ id, describedBy }) => (
              <input id={id} autoFocus required value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" aria-describedby={describedBy} />
            )}
          </AuthField>
          <button className="auth2-submit" disabled={busy}>
            {busy ? <><LoaderCircle className="spin" aria-hidden />{text.busy}</> : text.submit}
          </button>
          <div className="auth2-note"><ShieldCheck aria-hidden />{text.safety}</div>
        </form>
      </AuthCard>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { locale } = useI18n(); const resetText = locale === 'en' ? { back:'Back to Sign in', title:'Set a new password', intro:'Use at least 10 characters with uppercase, lowercase, a number, and a special character.', password:'New Password', confirm:'Confirm Password', submit:'Set New Password', busy:'Saving...', show:'Show password', hide:'Hide password' } : locale === 'zh-CN' ? { back:'返回登录', title:'设置新密码', intro:'密码至少 10 位，并包含大写字母、小写字母、数字和特殊字符。', password:'新密码', confirm:'确认密码', submit:'设置新密码', busy:'正在保存...', show:'显示密码', hide:'隐藏密码' } : { back:'กลับไปเข้าสู่ระบบ', title:'ตั้งรหัสผ่านใหม่', intro:'รหัสผ่านใหม่ต้องมีอย่างน้อย 10 ตัว และประกอบด้วยตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ', password:'รหัสผ่านใหม่', confirm:'ยืนยันรหัสผ่าน', submit:'ตั้งรหัสผ่านใหม่', busy:'กำลังบันทึก...', show:'แสดงรหัสผ่าน', hide:'ซ่อนรหัสผ่าน' };
  const [params] = useSearchParams(); const navigate = useNavigate(); const { toast } = useToast(); const token = params.get('token') ?? '';
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const valid = password.length >= 10 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!valid) { setError('รหัสผ่านยังไม่ครบตามเงื่อนไข'); return; } if (password !== confirm) { setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน'); return; } setBusy(true); setError(''); try { await apiClient.post('/auth/reset-password', { token, newPassword: password }, { token: null }); toast({ title: 'ตั้งรหัสผ่านใหม่สำเร็จ', description: 'เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้แล้ว', variant: 'success' }); navigate('/login', { replace: true }); } catch (reason) { setError(reason instanceof Error ? reason.message : 'ลิงก์รีเซ็ตไม่ถูกต้องหรือหมดอายุ'); } finally { setBusy(false); } };

  return (
    <AuthShell brand={<AuthBrandPanel eyebrow="SECURE PASSWORD RESET" title={resetText.title} lead={resetText.intro} />}>
      <AuthCard
        kicker="SECURE PASSWORD RESET"
        title={resetText.title}
        subtitle={resetText.intro}
        toolbar={<>
          <Link to="/login" className="auth2-back"><ArrowLeft aria-hidden width={16} />{resetText.back}</Link>
          <LanguageSwitcher compact />
        </>}
      >
        <form className="auth2-form" onSubmit={(event) => void submit(event)}>
          {!token && <AuthAlert tone="error"><ShieldCheck aria-hidden width={18} />ไม่พบรหัสยืนยันในลิงก์นี้</AuthAlert>}
          {error && <AuthAlert tone="error"><ShieldCheck aria-hidden width={18} />{error}</AuthAlert>}

          <PasswordField label={resetText.password} icon={LockKeyhole} value={password} onChange={setPassword}
            autoComplete="new-password" minLength={10} autoFocus showLabel={resetText.show} hideLabel={resetText.hide} />
          <PasswordField label={resetText.confirm} icon={ShieldCheck} value={confirm} onChange={setConfirm}
            autoComplete="new-password" minLength={10} showLabel={resetText.show} hideLabel={resetText.hide} />

          <div className={`auth2-note${valid ? ' is-ready' : ''}`}>
            <ShieldCheck aria-hidden />{valid ? 'Password policy passed' : '10+ characters • A–Z • a–z • 0–9 • symbol'}
          </div>

          <button className="auth2-submit" disabled={busy || !token}>
            {busy ? <><LoaderCircle className="spin" aria-hidden />{resetText.busy}</> : resetText.submit}
          </button>
        </form>
      </AuthCard>
    </AuthShell>
  );
}
