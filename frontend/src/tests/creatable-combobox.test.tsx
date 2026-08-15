import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CreatableCombobox from '@/components/ui/CreatableCombobox';

const options = [
  { value: '1', label: 'บริษัท แอลเอส จำกัด', sublabel: 'A0001 · 090-662-5464' },
  { value: '2', label: 'โรงเรียนอนุบาลดี', sublabel: 'A0002 · 081-111-2222' },
];

describe('CreatableCombobox', () => {
  it('renders each customer row with a clear name and secondary line', () => {
    render(<CreatableCombobox value="" onChange={() => {}} options={options} ariaLabel="ลูกค้า" />);
    fireEvent.click(screen.getByRole('button', { name: 'ลูกค้า' }));
    expect(screen.getByText('บริษัท แอลเอส จำกัด')).toBeInTheDocument();
    expect(screen.getByText('A0001 · 090-662-5464')).toBeInTheDocument();
  });

  it('filters options by search text', () => {
    render(<CreatableCombobox value="" onChange={() => {}} options={options} ariaLabel="ลูกค้า" searchPlaceholder="ค้นหาลูกค้า…" />);
    fireEvent.click(screen.getByRole('button', { name: 'ลูกค้า' }));
    fireEvent.change(screen.getByLabelText('ค้นหาลูกค้า…'), { target: { value: 'อนุบาล' } });
    expect(screen.queryByText('บริษัท แอลเอส จำกัด')).not.toBeInTheDocument();
    expect(screen.getByText('โรงเรียนอนุบาลดี')).toBeInTheDocument();
  });

  it('exposes the add-new action when no customer matches', () => {
    const onCreate = vi.fn();
    render(<CreatableCombobox value="" onChange={() => {}} options={options} ariaLabel="ลูกค้า" searchPlaceholder="ค้นหาลูกค้า…" emptyText="ไม่พบลูกค้า" createLabel="เพิ่มลูกค้าใหม่" onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: 'ลูกค้า' }));
    fireEvent.change(screen.getByLabelText('ค้นหาลูกค้า…'), { target: { value: 'ไม่มีจริง' } });
    expect(screen.getByText('ไม่พบลูกค้า')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มลูกค้าใหม่/ }));
    expect(onCreate).toHaveBeenCalledWith('ไม่มีจริง');
  });

  it('hides the "+ add" action when no create handler is provided (no permission)', () => {
    render(<CreatableCombobox value="" onChange={() => {}} options={options} ariaLabel="ลูกค้า" searchPlaceholder="ค้นหาลูกค้า…" emptyText="ไม่พบลูกค้า" createLabel="เพิ่มลูกค้าใหม่" />);
    fireEvent.click(screen.getByRole('button', { name: 'ลูกค้า' }));
    fireEvent.change(screen.getByLabelText('ค้นหาลูกค้า…'), { target: { value: 'ไม่มีจริง' } });
    expect(screen.getByText('ไม่พบลูกค้า')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /เพิ่มลูกค้าใหม่/ })).not.toBeInTheDocument();
  });

  it('marks the selected option and shows a check', () => {
    render(<CreatableCombobox value="2" onChange={() => {}} options={options} ariaLabel="ลูกค้า" />);
    fireEvent.click(screen.getByRole('button', { name: 'ลูกค้า' }));
    const selected = screen.getByRole('option', { selected: true });
    expect(selected).toHaveTextContent('โรงเรียนอนุบาลดี');
  });
});
