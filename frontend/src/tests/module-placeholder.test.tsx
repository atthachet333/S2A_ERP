import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Boxes } from 'lucide-react';
import { ModulePlaceholderView } from '@/components/ModulePlaceholder';
import { renderWithProviders } from './test-utils';

describe('ModulePlaceholder', () => {
  it('แสดงชื่อโมดูล สถานะ และฟีเจอร์ที่วางแผนไว้', () => {
    renderWithProviders(
      <ModulePlaceholderView
        title="วัตถุดิบและสินค้า"
        description="ทะเบียนวัตถุดิบและสินค้า"
        icon={Boxes}
        status="in-progress"
        plannedFeatures={['ทะเบียนวัตถุดิบ', 'หน่วยนับหลายระดับ']}
      />,
    );
    expect(screen.getByRole('heading', { name: 'วัตถุดิบและสินค้า' })).toBeInTheDocument();
    expect(screen.getByText(/อยู่ระหว่างการพัฒนา/)).toBeInTheDocument();
    expect(screen.getByText('ทะเบียนวัตถุดิบ')).toBeInTheDocument();
    expect(screen.getByText('หน่วยนับหลายระดับ')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /กลับสู่ภาพรวม/ })).toHaveAttribute('href', '/dashboard');
  });
});
