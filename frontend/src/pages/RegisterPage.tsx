import { useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, Circle, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, Phone, Rocket, ShieldCheck, UserCheck, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { apiClient } from '@/lib/api-client';
import { registrationFailure, registrationSubmission, type RegistrationField, type RegistrationFieldErrors } from '@/lib/registration-contract';
import { useI18n } from '@/i18n/i18n';

const stepIcons = [UserRound, Building2, UserCheck, Rocket];

export default function RegisterPage() {
  const { messages } = useI18n();
  const copy = messages.register;
  const onboarding = messages.onboarding;
  const validation = messages.validation;
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<RegistrationFieldErrors>({});
  const [show, setShow] = useState(false);
  const [password, setPassword] = useState('');
  const rules = [
    { label: validation.length, valid: password.length >= 10 },
    { label: validation.upper, valid: /[A-Z]/.test(password) },
    { label: validation.lower, valid: /[a-z]/.test(password) },
    { label: validation.number, valid: /\d/.test(password) },
    { label: validation.special, valid: /[^A-Za-z0-9]/.test(password) },
  ];
  const fieldError = (field: RegistrationField) => fieldErrors[field] ? <small className="field-error" role="alert">{fieldErrors[field]}</small> : null;
  const invalid = (field: RegistrationField) => Boolean(fieldErrors[field]) || undefined;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    const result = registrationSubmission(new FormData(event.currentTarget), validation);
    setFieldErrors(result.errors);
    if (!result.payload) return;

    submitting.current = true;
    setBusy(true);
    try {
      await apiClient.post('/auth/register', result.payload, { token: null });
      setComplete(true);
    } catch (reason) {
      const failure = registrationFailure(reason, validation);
      setError(failure.message);
      setFieldErrors(failure.errors);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return <main className="onboarding-shell">
    <section className="onboarding-story"><div className="onboarding-grid"/><div className="onboarding-orbit"/><Link to="/" className="onboarding-back"><ArrowLeft/>{messages.common.backHome}</Link><header><img src="/s2a-logo.png" alt="S2 Accounting Consultant"/><div><strong>S2 ACCOUNTING CONSULTANT</strong><small>{onboarding.eyebrow}</small></div><i/></header><div className="onboarding-copy"><span>{onboarding.eyebrow}</span><h1>{onboarding.hero}</h1><p>{onboarding.support}</p></div><div className="onboarding-flow">{onboarding.steps.map((label,index)=>{const Icon=stepIcons[index];return <div key={label} className="onboarding-step"><span><Icon/></span><div><small>0{index+1}</small><strong>{label}</strong></div>{index<onboarding.steps.length-1&&<i/>}</div>})}</div><div className="onboarding-safe"><ShieldCheck/><span>{onboarding.security}</span></div></section>
    <section className="onboarding-panel"><div className="onboarding-language"><LanguageSwitcher compact/></div>{complete?<div className="onboarding-success"><CheckCircle2/><small>ACCOUNT CREATED</small><h2>{copy.success}</h2><p>{copy.pending}</p><Link className="gateway-submit ready" to="/login"><span>{copy.login}<small>SECURE WORKSPACE</small></span><ArrowRight/></Link></div>:<form className="onboarding-form" noValidate onSubmit={(event)=>void submit(event)}><div className="onboarding-rule"/><header><small>CREATE WORKSPACE ACCOUNT</small><h2>{copy.title}</h2><p>{copy.subtitle}</p></header>{error&&<div className="auth-alert" role="alert">{error}</div>}<fieldset><legend><span>01</span>{onboarding.account}</legend><div className="onboarding-fields">
      <label>{copy.fullName}<div className="console-input"><UserRound/><input name="fullName" required minLength={2} maxLength={160} autoComplete="name" aria-invalid={invalid('fullName')}/></div>{fieldError('fullName')}</label>
      <label>{messages.auth.username}<div className="console-input"><UserRound/><input name="username" required minLength={3} maxLength={60} pattern="[A-Za-z0-9._-]+" autoComplete="username" aria-invalid={invalid('username')}/></div><small className="field-hint">{validation.usernameHint}</small>{fieldError('username')}</label>
      <label>{copy.email}<div className="console-input"><Mail/><input name="email" type="email" required autoComplete="email" aria-invalid={invalid('email')}/></div>{fieldError('email')}</label>
      <label>{copy.phone}<div className="console-input"><Phone/><input name="phone" type="tel" autoComplete="tel" aria-invalid={invalid('phone')}/></div>{fieldError('phone')}</label>
    </div></fieldset><fieldset><legend><span>02</span>{onboarding.protection}</legend><div className="onboarding-fields">
      <label>{messages.auth.password}<div className="console-input"><LockKeyhole/><input name="password" type={show?'text':'password'} value={password} onChange={(event)=>setPassword(event.target.value)} required minLength={10} autoComplete="new-password" aria-invalid={invalid('password')}/><button type="button" onClick={()=>setShow(value=>!value)} aria-label={show?'Hide password':'Show password'}>{show?<EyeOff/>:<Eye/>}</button></div>{fieldError('password')}</label>
      <label>{copy.confirm}<div className="console-input"><LockKeyhole/><input name="confirm" type={show?'text':'password'} required minLength={10} autoComplete="new-password" aria-invalid={invalid('confirm')}/></div>{fieldError('confirm')}</label>
    </div><div className="password-rules"><small>{validation.passwordRules}</small>{rules.map((rule)=><span className={rule.valid?'valid':''} key={rule.label}>{rule.valid?<Check/>:<Circle/>}{rule.label}</span>)}</div></fieldset><fieldset className="agreement-field"><legend><span>03</span>{onboarding.agreement}</legend><label className="register-terms"><input name="terms" type="checkbox" aria-invalid={invalid('terms')}/>{copy.terms}</label>{fieldError('terms')}</fieldset><button className="gateway-submit onboarding-submit ready" disabled={busy}>{busy?<><LoaderCircle className="spin"/>{copy.submitting}</>:<><span>{copy.submit}<small>CREATE WORKSPACE ACCOUNT</small></span><ArrowRight/></>}</button><p className="register-login">{onboarding.already} <Link to="/login">{messages.auth.signIn}</Link></p></form>}</section>
  </main>;
}
