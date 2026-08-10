import { useEffect, useRef, useState } from 'react';
import { Cookie, Settings2, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/i18n/i18n';

export const COOKIE_KEY = 's2a_cookie_consent_v1';
type Consent = { version: 1; essential: true; preferences: boolean; acceptedAt: string };
const read = (): Consent | null => { try { const value = localStorage.getItem(COOKIE_KEY); return value ? JSON.parse(value) as Consent : null; } catch { return null; } };

export default function CookieConsent() {
  const { messages } = useI18n(); const copy = messages.cookie;
  const [consent, setConsent] = useState<Consent | null>(() => read());
  const [open, setOpen] = useState(() => !read());
  const [settings, setSettings] = useState(false);
  const [preferences, setPreferences] = useState(true);
  const dialogRef = useRef<HTMLElement>(null);
  const save = (preference: boolean) => { const next: Consent = { version: 1, essential: true, preferences: preference, acceptedAt: new Date().toISOString() }; localStorage.setItem(COOKIE_KEY, JSON.stringify(next)); setConsent(next); setOpen(false); };

  useEffect(() => { const reopen = () => { setPreferences(consent?.preferences ?? true); setSettings(true); setOpen(true); }; window.addEventListener('s2a:cookie-settings', reopen); return () => window.removeEventListener('s2a:cookie-settings', reopen); }, [consent]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    document.body.classList.add('cookie-gated');
    const dialog = dialogRef.current; const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button,input,a[href]') ?? [])].filter((node) => !node.hasAttribute('disabled'));
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); return; } if (event.key !== 'Tab') return; const nodes = focusable(); if (!nodes.length) return; const first = nodes[0]; const last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } };
    document.addEventListener('keydown', keydown);
    return () => { document.body.classList.remove('cookie-gated'); document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [open]);
  if (!open) return null;
  return <div className="cookie-gate-backdrop" data-testid="cookie-backdrop"><section ref={dialogRef} className="cookie-gate" role="dialog" aria-modal="true" aria-labelledby="cookie-title" aria-describedby="cookie-description">
    <header><span><Cookie aria-hidden /></span><div><small>PRIVACY &amp; PREFERENCES</small><h2 id="cookie-title">{copy.title}</h2><p id="cookie-description">{copy.description}</p></div></header>
    <div className="cookie-choice"><ShieldCheck /><div><strong>{copy.essential}</strong><p>{copy.essentialDescription}</p></div><span>{copy.always}</span></div>
    {settings && <div className="cookie-choice"><Settings2 /><div><strong>{copy.preferences}</strong><p>{copy.preferencesDescription}</p></div><label className="cookie-switch"><input type="checkbox" checked={preferences} onChange={(event) => setPreferences(event.target.checked)} /><span /></label></div>}
    <footer><button className="cookie-primary" onClick={() => save(true)}>{copy.accept}</button><button onClick={() => save(false)}>{copy.necessary}</button>{settings ? <button onClick={() => save(preferences)}>{copy.save}</button> : <button onClick={() => setSettings(true)}>{copy.settings}</button>}<a href="#cookie-policy" onClick={(event) => { event.preventDefault(); setSettings(true); }}>{copy.policy}</a></footer>
  </section></div>;
}
