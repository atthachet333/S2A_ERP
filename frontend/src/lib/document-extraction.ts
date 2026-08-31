export type ExtractionStatus = 'PENDING' | 'PROCESSING' | 'REVIEW_REQUIRED' | 'READY' | 'FAILED' | 'APPLIED';
export type MatchStatus = 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED';

export interface ExtractionLine {
  id: string;
  position: number;
  rawDescription: string;
  extractedItemCode?: string | null;
  quantity: string | null;
  unitText?: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
  matchedItemId: string | null;
  matchedUnitId: string | null;
  matchStatus: MatchStatus;
  warnings: string[];
  matchedItem?: { id: string; code: string; name: string; purchaseToBaseFactor: string; baseUnit: { id: string; code: string }; purchaseUnit?: { id: string; code: string } | null } | null;
  matchedUnit?: { id: string; code: string; name: string } | null;
}

export interface DocumentExtraction {
  id: string;
  attachmentId: string;
  version: number;
  status: ExtractionStatus;
  quality: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  supplierName?: string | null;
  supplierTaxId?: string | null;
  supplierDocumentNo?: string | null;
  documentDate?: string | null;
  currency?: string | null;
  matchedSupplierId: string | null;
  matchedSupplier?: { id: string; code: string; name: string } | null;
  subtotal: string | null;
  discount: string | null;
  vat: string | null;
  grandTotal: string | null;
  warnings: string[];
  failureCode?: string | null;
  failureMessage?: string | null;
  extractedAt?: string | null;
  appliedAt?: string | null;
  originalUrl: string;
  attachment: { id: string; originalName: string; mimeType: string };
  lines: ExtractionLine[];
}

export const matchLabel: Record<MatchStatus, string> = {
  MATCHED: 'ตรงกับข้อมูลในระบบ',
  AMBIGUOUS: 'ต้องเลือกให้ชัดเจน',
  UNMATCHED: 'ยังไม่พบข้อมูลที่ตรงกัน',
};

export const extractionStatusLabel: Record<ExtractionStatus, string> = {
  PENDING: 'รอประมวลผล', PROCESSING: 'กำลังอ่านเอกสาร', REVIEW_REQUIRED: 'รอตรวจทาน',
  READY: 'พร้อมนำไปใช้', FAILED: 'อ่านอัตโนมัติไม่ได้', APPLIED: 'นำไปใช้กับร่างแล้ว',
};
