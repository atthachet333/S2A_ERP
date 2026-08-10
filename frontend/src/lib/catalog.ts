import { apiClient, sessionStore, ApiClientError } from './api-client';

/**
 * Data layer สำหรับโมดูล food-costing (items/menus/recipes/costing/uploads)
 * เรียกผ่าน apiClient กลางเท่านั้น — ไม่ hardcode URL กระจาย
 */

export type ItemType = 'RAW_MATERIAL' | 'PACKAGING' | 'SEMI_FINISHED' | 'FINISHED_GOOD' | 'CONSUMABLE' | 'WASTE';

export interface Unit { id: string; code: string; name: string; isActive: boolean }
export interface UnitConversion { id: string; fromUnitId: string; toUnitId: string; fromCode: string; toCode: string; factor: number }
export interface Category { id: string; code: string; name: string; type: ItemType | null; isActive: boolean; itemCount: number }
export interface UnitRef { id: string; code: string; name: string }
export interface CategoryRef { id: string; code: string; name: string }

export interface Item {
  id: string; code: string; barcode: string | null; name: string; type: ItemType;
  categoryId: string | null; category: CategoryRef | null;
  baseUnitId: string; baseUnit: UnitRef | null;
  purchaseUnitId: string | null; purchaseUnit: UnitRef | null; purchaseToBaseFactor: number;
  avgCost: number; lastCost: number; reorderPoint: number; minQty: number;
  isLotTracked: boolean; isExpiryTracked: boolean; imageUrl: string | null;
  isActive: boolean; createdAt: string; updatedAt: string;
}
export interface PriceRow {
  id: string; baseUnitCost: number; source: string | null;
  purchasePrice: number | null; purchaseQuantity: number | null; pricePerPurchaseUnit: number | null;
  supplierId: string | null; note: string | null; createdAt: string;
}
export interface ItemDetail extends Item {
  priceHistory: PriceRow[];
  priceStats: { last: number | null; min: number | null; max: number | null; count: number };
}
export interface Paginated<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }
export interface ItemSummary { total: number; active: number; noPrice: number; latestPriceUpdate: string | null }

export interface MenuRow {
  id: string; code: string; name: string; imageUrl: string | null; category: { id: string; name: string } | null;
  sellingUnit: string | null; isActive: boolean; recipeId: string | null; hasRecipe: boolean;
  totalCost: number | null; sellingPrice: number | null; margin: number | null;
}
export interface MenuDetail {
  id: string; code: string; name: string; imageUrl: string | null; categoryId: string | null;
  category: { id: string; name: string } | null; sellingUnit: UnitRef | null; isActive: boolean;
  recipes: { id: string; code: string }[]; activeRecipeId: string | null; activeVersionNo: number | null;
  currentCost: number | null; sellingPrice: number | null; margin: number | null;
  createdAt: string; updatedAt: string;
}

export interface RecipeRow {
  id: string; code: string; name: string; isActive: boolean;
  product: { id: string; code: string; name: string; imageUrl: string | null };
  versionCount: number; activeVersionNo: number | null; yield: number | null; totalCost: number | null; unitCost: number | null; updatedAt: string;
}

export interface CostBreakdown {
  materialCost: number; packagingCost: number; laborCost: number; utilityCost: number;
  overheadCost: number; wasteCost: number; otherCost: number; totalCost: number; effectiveYield: number; unitCost: number;
}
export interface PricingResult { sellingPrice: number; profit: number; marginPercent: number; markupPercent: number; isLoss: boolean }

export const catalogApi = {
  units: () => apiClient.get<Unit[]>('/units'),
  createUnit: (body: unknown) => apiClient.post<Unit>('/units', body),
  conversions: () => apiClient.get<UnitConversion[]>('/units/conversions'),
  saveConversion: (body: unknown) => apiClient.post<{ id: string }>('/units/conversions', body),
  categories: () => apiClient.get<Category[]>('/categories'),
  createCategory: (body: unknown) => apiClient.post<Category>('/categories', body),
  updateCategory: (id: string, body: unknown) => apiClient.patch<Category>(`/categories/${id}`, body),

  itemSummary: () => apiClient.get<ItemSummary>('/items/summary'),
  items: (params: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
    return apiClient.get<Paginated<Item>>(`/items?${q.toString()}`);
  },
  item: (id: string) => apiClient.get<ItemDetail>(`/items/${id}`),
  createItem: (body: unknown) => apiClient.post<Item>('/items', body),
  updateItem: (id: string, body: unknown) => apiClient.patch<Item>(`/items/${id}`, body),
  deactivateItem: (id: string) => apiClient.post<Item>(`/items/${id}/deactivate`),
  activateItem: (id: string) => apiClient.post<Item>(`/items/${id}/activate`),
  addPrice: (id: string, body: unknown) => apiClient.post<{ baseUnitCost: number }>(`/items/${id}/prices`, body),

  menus: () => apiClient.get<MenuRow[]>('/menus'),
  menu: (id: string) => apiClient.get<MenuDetail>(`/menus/${id}`),
  createMenu: (body: unknown) => apiClient.post<{ id: string; code: string; name: string }>('/menus', body),
  updateMenu: (id: string, body: unknown) => apiClient.patch<{ id: string; code: string; name: string; isActive: boolean }>(`/menus/${id}`, body),

  recipes: () => apiClient.get<RecipeRow[]>('/recipes'),
  recipe: (id: string) => apiClient.get<RecipeDetail>(`/recipes/${id}`),
  createRecipe: (body: unknown) => apiClient.post<{ id: string; code: string; versionNo: number; cost: CostBreakdown; menuCreated?: boolean }>('/recipes', body),
  addRecipeVersion: (id: string, body: unknown) => apiClient.post<{ versionId: string; versionNo: number; cost: CostBreakdown }>(`/recipes/${id}/versions`, body),

  calculate: (body: unknown) => apiClient.post<{ breakdown: CostBreakdown; pricing: PricingResult | null }>('/costing/calculate', body),
  savePrice: (body: unknown) => apiClient.post<{ id: string; price: number }>('/costing/price', body),
};

export interface RecipeIngredientView {
  id: string; itemId: string; quantityBase: number; unitId: string | null; wastePercent: number; lineCost: number;
  item: { id: string; code: string; name: string; type: ItemType; imageUrl: string | null; baseUnitCode: string | null; lastCost: number } | null;
}
export interface RecipeVersionView {
  id: string; versionNo: number; isActive: boolean; standardYieldQty: number; yieldPercent: number; standardWaste: number;
  laborCost: number; electricCost: number; waterCost: number; gasCost: number; overheadCost: number; otherCost: number;
  note: string | null; createdAt: string; cost: CostBreakdown | null; ingredients: RecipeIngredientView[];
}
export interface RecipeDetail {
  id: string; code: string; name: string; description: string | null; isActive: boolean;
  product: { id: string; code: string; name: string; imageUrl: string | null };
  versions: RecipeVersionView[];
}

/** อัปโหลดรูป (multipart) — คืน url ที่เก็บใน DB ต่อไป */
export async function uploadImage(kind: 'items' | 'menus', file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  const token = sessionStore.accessToken();
  const res = await fetch(`/api/uploads/${kind}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const payload = await res.json().catch(() => null);
  if (!payload || !payload.success) {
    throw new ApiClientError(payload?.error?.code ?? 'UPLOAD_FAILED', payload?.error?.message ?? 'อัปโหลดรูปไม่สำเร็จ', res.status);
  }
  return payload.data;
}
