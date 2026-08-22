import type { Company } from '@prisma/client';
import type { DocumentCompany } from './document.service.js';

/**
 * PHASE 13B — แหล่งข้อมูลบริษัทชุดเดียวสำหรับทุกเอกสารและหน้าตั้งค่า
 *
 * เดิมมีการเขียนทับชื่อบริษัทเป็น 'ครัวสดดี' อยู่สองที่
 *   1) route สร้าง PDF        (แก้ไปแล้วใน Phase 13)
 *   2) GET /business/company  (ยังเหลืออยู่ — หน้าตั้งค่าจึงแสดงชื่อผิด
 *                              และถ้าผู้ใช้กดบันทึก จะเขียนชื่อผิดทับของจริงในฐานข้อมูล)
 * ทั้งสองที่จึงมาใช้ helper นี้แทน เพื่อไม่ให้เกิด mapping ซ้ำอีก
 */
export function toDocumentCompany(company: Company): DocumentCompany {
  return {
    nameTh: company.nameTh,
    nameEn: company.nameEn,
    logoUrl: company.logoUrl,
    address: company.address,
    phone: company.phone,
    email: company.email,
    taxId: company.taxId,
    website: company.website,
    lineId: company.lineId,
    documentFooter: company.documentFooter,
  };
}

/** field ที่หน้าตั้งค่าแก้ไขได้ — ตรงกับที่ PATCH /company รับจริง */
export const COMPANY_DOCUMENT_FIELDS = [
  'nameTh', 'nameEn', 'taxId', 'address',
  'phone', 'email', 'website', 'lineId',
  'authorizedName', 'documentFooter', 'logoUrl',
] as const;
