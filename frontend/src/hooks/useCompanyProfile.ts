import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/**
 * PHASE 14 — ข้อมูลบริษัทสำหรับการ์ดสรุปบนแดชบอร์ดและหน้าตั้งค่า
 * ใช้ endpoint เดิม /business/company (แหล่งเดียวกับที่เอกสาร PDF ใช้)
 * ต้องมีสิทธิ์ SYSTEM_SETTINGS — ผู้ใช้ที่ไม่มีสิทธิ์จะได้ error แล้วการ์ดจะไม่แสดง
 */
export interface CompanyProfile {
  id: string; code: string; nameTh: string; nameEn?: string | null; logoUrl?: string | null;
  taxId?: string | null; address?: string | null; phone?: string | null; email?: string | null;
  website?: string | null; lineId?: string | null;
  authorizedName?: string | null; documentFooter?: string | null;
  updatedAt?: string;
}

export function useCompanyProfile() {
  return useQuery({
    queryKey: ['company-profile'],
    queryFn: () => apiClient.get<CompanyProfile>('/business/company'),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

/** เฉพาะช่องที่มีค่าจริง — ใช้ทั้งการ์ดแดชบอร์ดและตัวอย่างเอกสาร */
export function companyContactRows(c: CompanyProfile | undefined): { label: string; value: string }[] {
  if (!c) return [];
  const rows: { label: string; value: string }[] = [];
  if (c.nameEn) rows.push({ label: 'ชื่ออังกฤษ', value: c.nameEn });
  if (c.taxId) rows.push({ label: 'เลขผู้เสียภาษี', value: c.taxId });
  if (c.phone) rows.push({ label: 'โทรศัพท์', value: c.phone });
  if (c.email) rows.push({ label: 'อีเมล', value: c.email });
  if (c.lineId) rows.push({ label: 'LINE', value: c.lineId });
  if (c.website) rows.push({ label: 'เว็บไซต์', value: c.website });
  if (c.address) rows.push({ label: 'ที่อยู่', value: c.address.replace(/\s*\n\s*/g, ' ') });
  return rows;
}
