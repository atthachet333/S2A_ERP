import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { AuthUser } from '@/auth/AuthContext';
import { makeUser, renderWithProviders } from './test-utils';

type Cat = { id: string; code: string; name: string; type: string; isActive: boolean; itemCount: number };
const store = vi.hoisted(() => ({ user: null as AuthUser | null }));
const api = vi.hoisted(() => ({
  units: vi.fn(), categories: vi.fn(), createCategory: vi.fn(), createUnit: vi.fn(),
  item: vi.fn(), createItem: vi.fn(), addPrice: vi.fn(),
}));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: store.user }) }));
vi.mock('@/lib/catalog', () => ({ catalogApi: api }));
vi.mock('@/components/ui/ImageUpload', () => ({ default: () => null }));

import IngredientFormPage from '@/pages/catalog/IngredientFormPage';

const UNITS = [{ id: 'u1', code: 'G', name: 'กรัม', isActive: true }];
const CAT_PH = 'เช่น เนื้อสัตว์, ผัก, เครื่องปรุง';
let cats: Cat[];

function renderForm() { return renderWithProviders(<IngredientFormPage />, { route: '/ingredients/new' }); }

describe('ItemFormWorkspace — category creatable', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    cats = [{ id: 'c1', code: 'CAT-1', name: 'เนื้อสัตว์', type: 'RAW_MATERIAL', isActive: true, itemCount: 0 }];
    api.units.mockResolvedValue(UNITS);
    api.categories.mockImplementation(async () => cats);
    store.user = makeUser({ roles: ['MANAGER'], permissions: ['INGREDIENT_CREATE', 'INGREDIENT_EDIT'] });
  });

  it('shows the category picker with existing options and a create action', async () => {
    renderForm();
    fireEvent.click(await screen.findByRole('button', { name: 'หมวดหมู่วัตถุดิบ' }));
    expect(await screen.findByText('เนื้อสัตว์')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /เพิ่มหมวดหมู่/ })).toBeInTheDocument();
  });

  it('hides the create action when the user lacks permission', async () => {
    store.user = makeUser({ roles: ['VIEWER'], permissions: ['INGREDIENT_VIEW'] });
    renderForm();
    fireEvent.click(await screen.findByRole('button', { name: 'หมวดหมู่วัตถุดิบ' }));
    expect(await screen.findByText('เนื้อสัตว์')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /เพิ่มหมวดหมู่/ })).not.toBeInTheDocument();
  });

  it('creates a category (type RAW_MATERIAL, auto code) and auto-selects it', async () => {
    api.createCategory.mockImplementation(async (b: { name: string; code: string; type: string }) => {
      const c = { id: 'c9', code: b.code, name: b.name, type: b.type, isActive: true, itemCount: 0 };
      cats = [...cats, c]; return c;
    });
    renderForm();
    fireEvent.click(await screen.findByRole('button', { name: 'หมวดหมู่วัตถุดิบ' }));
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มหมวดหมู่/ }));
    fireEvent.change(await screen.findByPlaceholderText(CAT_PH), { target: { value: 'ผัก' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มหมวดหมู่' }));
    await waitFor(() => expect(api.createCategory).toHaveBeenCalledTimes(1));
    expect(api.createCategory).toHaveBeenCalledWith(expect.objectContaining({ name: 'ผัก', type: 'RAW_MATERIAL' }));
    expect(api.createCategory.mock.calls[0][0].code).toMatch(/^CAT-RM-/);
    // auto-selected → trigger now shows the new category
    expect(await screen.findByText('ผัก')).toBeInTheDocument();
  });

  it('shows a friendly duplicate message and preserves the parent form', async () => {
    api.createCategory.mockRejectedValue(Object.assign(new Error('มีหมวดหมู่นี้อยู่แล้ว'), { code: 'DUPLICATE_CATEGORY' }));
    renderForm();
    fireEvent.change(await screen.findByPlaceholderText(/ข้าวหอมมะลิ/), { target: { value: 'พริกไทย' } });
    fireEvent.click(screen.getByRole('button', { name: 'หมวดหมู่วัตถุดิบ' }));
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มหมวดหมู่/ }));
    fireEvent.change(await screen.findByPlaceholderText(CAT_PH), { target: { value: 'เนื้อสัตว์' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มหมวดหมู่' }));
    expect(await screen.findByText('มีหมวดหมู่นี้อยู่แล้ว')).toBeInTheDocument();
    expect((screen.getByPlaceholderText(/ข้าวหอมมะลิ/) as HTMLInputElement).value).toBe('พริกไทย');
  });
});
