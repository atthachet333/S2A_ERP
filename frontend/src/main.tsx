import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { queryClient } from '@/lib/query';
import App from './App';
import { AuthProvider } from '@/auth/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import ErrorBoundary from '@/components/ErrorBoundary';
import { I18nProvider } from '@/i18n/i18n';
import { ThemeProvider } from '@/theme/ThemeContext';
// ฟอนต์แบบ offline (PART 3): Noto Sans Thai (ไทย/บอดี้) + Manrope (ตัวเลข/KPI)
import '@fontsource/noto-sans-thai/400.css';
import '@fontsource/noto-sans-thai/500.css';
import '@fontsource/noto-sans-thai/600.css';
import '@fontsource/noto-sans-thai/700.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import './styles/tokens.css';
import './index.css';
import './styles/workspace.css';
import './styles/page-pattern.css';
import './styles/recipe-builder.css';
import './styles/costing-pricing.css';
import './styles/dashboard.css';
import './styles/operations.css';
import './styles/operations-workspace.css';
import './styles/production.css';
import './styles/purchase-planning.css';
import './styles/purchase-orders.css';
import './styles/analytics.css';
import './styles/phase32-5.css';
import './styles/adjustment.css';
import './styles/inventory-inspector.css';
import './styles/master-data.css';
import './styles/orders.css';
import './styles/admin.css';
import './styles/consistency.css';
// PHASE 34 — แถบข้างจัดกลุ่มใหม่ + หัวข้อกลุ่มพับได้ (ต้องอยู่ท้ายสุดเพื่อทับกฎเดิม)
import './styles/shell-nav.css';
// PHASE 34 — สกินใหม่ของ ปุ่ม/การ์ด/ตาราง/ฟอร์ม/ป้ายสถานะ (ท้ายสุด)
import './styles/phase34-reskin.css';
// PHASE 37 - auth pages share one shell and style set
import './styles/auth.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider><I18nProvider><AuthProvider>
          <ToastProvider><ErrorBoundary><App /></ErrorBoundary></ToastProvider>
        </AuthProvider></I18nProvider></ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
