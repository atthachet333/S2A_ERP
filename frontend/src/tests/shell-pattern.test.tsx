import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from './test-utils';
import { I18nProvider } from '@/i18n/i18n';

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: null, login: vi.fn() }) }));

import HomePage from '@/pages/HomePage';
import { PageContainer, PageHeader, KPIGrid, KPICard, FilterBar, ContentCard } from '@/components/layout/page';

/**
 * PHASE 2+3 — App Shell + Global Page Pattern
 * ครอบคลุม: เมนูมือถือหน้า public, โครงหน้ามาตรฐาน, การใช้ token ของ z-index
 */

describe('public mobile navigation', () => {
  const renderHome = () => renderWithProviders(<I18nProvider><HomePage /></I18nProvider>, { route: '/' });

  it('1 มีปุ่ม burger พร้อม aria-expanded/aria-controls', () => {
    renderHome();
    const burger = document.querySelector('.hp-burger') as HTMLButtonElement;
    expect(burger).toBeTruthy();
    expect(burger.getAttribute('aria-expanded')).toBe('false');
    expect(burger.getAttribute('aria-controls')).toBe('hp-mobile-nav');
    expect(document.getElementById('hp-mobile-nav')).toBeTruthy();
  });

  it('2 กด burger แล้วเมนูเปิด และ aria-expanded เป็น true', () => {
    renderHome();
    const burger = document.querySelector('.hp-burger') as HTMLButtonElement;
    fireEvent.click(burger);
    expect(burger.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('hp-mobile-nav')!.className).toContain('open');
  });

  it('3 เมนูมือถือมีลิงก์ครบทุก section', () => {
    renderHome();
    fireEvent.click(document.querySelector('.hp-burger') as HTMLButtonElement);
    const panel = document.getElementById('hp-mobile-nav')!;
    const hrefs = [...panel.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['#about', '#features', '#process', '#kpi']));
  });

  it('4 กดลิงก์ในเมนูแล้วเมนูปิดเอง', () => {
    renderHome();
    const burger = document.querySelector('.hp-burger') as HTMLButtonElement;
    fireEvent.click(burger);
    const panel = document.getElementById('hp-mobile-nav')!;
    fireEvent.click(within(panel).getAllByRole('link')[0]);
    expect(panel.className).not.toContain('open');
    expect(burger.getAttribute('aria-expanded')).toBe('false');
  });

  it('5 กด ESC ปิดเมนู', () => {
    renderHome();
    const burger = document.querySelector('.hp-burger') as HTMLButtonElement;
    fireEvent.click(burger);
    expect(burger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(burger.getAttribute('aria-expanded')).toBe('false');
  });

  it('6 คลิกฉากหลังปิดเมนู', () => {
    renderHome();
    const burger = document.querySelector('.hp-burger') as HTMLButtonElement;
    fireEvent.click(burger);
    fireEvent.click(document.querySelector('.hp-mobile-scrim')!);
    expect(burger.getAttribute('aria-expanded')).toBe('false');
  });

  it('7 เปิดเมนูแล้วล็อกการเลื่อนพื้นหลัง ปิดแล้วคืนค่า', () => {
    renderHome();
    const burger = document.querySelector('.hp-burger') as HTMLButtonElement;
    fireEvent.click(burger);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('8 เมนูบนเดสก์ท็อปเดิมยังอยู่ครบ ไม่ถูกแทนที่', () => {
    renderHome();
    const desktopNav = document.querySelector('.hp-nav')!;
    expect(desktopNav.querySelectorAll('a')).toHaveLength(4);
  });
});

describe('global page pattern', () => {
  it('9 PageContainer รองรับ 3 ขนาดตาม API', () => {
    for (const size of ['wide', 'default', 'narrow'] as const) {
      const { unmount } = renderWithProviders(<PageContainer size={size}>x</PageContainer>);
      expect(document.querySelector(`.s2-page--${size}`)).toBeTruthy();
      unmount();
    }
  });

  it('10 PageContainer ไม่ระบุขนาด = default', () => {
    renderWithProviders(<PageContainer>x</PageContainer>);
    expect(document.querySelector('.s2-page--default')).toBeTruthy();
  });

  it('11 PageHeader แสดง title/description/breadcrumb/actions ครบ', () => {
    renderWithProviders(
      <PageHeader title="วัตถุดิบ" description="รายการทั้งหมด" breadcrumb="คลังข้อมูล"
        actions={<button>เพิ่ม</button>} />,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('วัตถุดิบ');
    expect(screen.getByText('รายการทั้งหมด')).toBeInTheDocument();
    expect(screen.getByText('คลังข้อมูล')).toBeInTheDocument();
    expect(within(document.querySelector('.s2-page-actions')!).getByRole('button')).toBeInTheDocument();
  });

  it('12 PageHeader ไม่บังคับให้มี description/actions', () => {
    renderWithProviders(<PageHeader title="เฉย ๆ" />);
    expect(document.querySelector('.s2-page-desc')).toBeNull();
    expect(document.querySelector('.s2-page-actions')).toBeNull();
  });

  it('13 KPICard ที่กดได้เป็น button และสื่อสถานะด้วย aria-pressed', () => {
    const onClick = vi.fn();
    renderWithProviders(
      <KPIGrid columns={4}>
        <KPICard label="ทั้งหมด" value="128" />
        <KPICard label="ใกล้หมด" value="6" tone="warning" onClick={onClick} active />
      </KPIGrid>,
    );
    expect(document.querySelector('.s2-kpi-grid--4')).toBeTruthy();
    const clickable = screen.getByRole('button');
    expect(clickable.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(clickable);
    expect(onClick).toHaveBeenCalledOnce();
    // ใบที่กดไม่ได้ต้องไม่เป็นปุ่ม
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('14 FilterBar แยกช่องกรองกับปุ่มการกระทำออกจากกัน', () => {
    renderWithProviders(
      <FilterBar actions={<button>ส่งออก</button>}>
        <input aria-label="ค้นหา" className="s2-search" />
      </FilterBar>,
    );
    expect(document.querySelector('.s2-filterbar-fields input')).toBeTruthy();
    expect(document.querySelector('.s2-filterbar-actions button')).toBeTruthy();
  });

  it('15 ContentCard: header/body/footer และโหมด flush สำหรับตาราง', () => {
    renderWithProviders(
      <ContentCard title="รายการ" description="อัปเดตวันนี้" actions={<button>จัดการ</button>} footer="20 จาก 128" padded={false}>
        <div>เนื้อหา</div>
      </ContentCard>,
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('รายการ');
    expect(document.querySelector('.s2-card-body.is-flush')).toBeTruthy();
    expect(document.querySelector('.s2-card-foot')!.textContent).toBe('20 จาก 128');
  });

  it('16 ContentCard ที่ไม่มีหัวข้อจะไม่เรนเดอร์แถบหัว', () => {
    renderWithProviders(<ContentCard>เนื้อหา</ContentCard>);
    expect(document.querySelector('.s2-card-head')).toBeNull();
    expect(document.querySelector('.s2-card-body')).toBeTruthy();
  });
});
