import { Languages } from 'lucide-react';
import { localeTag, useI18n, type Locale } from '@/i18n/i18n';

const locales: Locale[] = ['th', 'en', 'zh-CN'];
export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) { const { locale, setLocale, messages } = useI18n(); return <div className={`language-switcher${compact ? ' compact' : ''}`} role="group" aria-label={messages.common.language}><Languages aria-hidden />{locales.map((item) => <button key={item} type="button" className={locale === item ? 'active' : ''} aria-pressed={locale === item} onClick={() => setLocale(item)}>{localeTag(item)}</button>)}</div>; }
