import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import PDFDocument from 'pdfkit';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const TAG = `p23${Date.now().toString().slice(-6)}`;
const authHeader = (token: string) => ({ authorization: `Bearer ${token}` });

async function pdfBuffer(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 30 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica').fontSize(10).text(text, { lineGap: 4 });
    doc.end();
  });
}

function multipart(fileName: string, mime: string, bytes: Buffer) {
  const boundary = `----phase23${TAG}`;
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe.sequential('Phase 23 extraction -> human review -> existing receiving draft', () => {
  let app: FastifyInstance;
  let token = '';
  let otherToken = '';
  let viewerToken = '';
  let companyId = '';
  let warehouseId = '';
  let itemId = '';
  let supplierId = '';

  const createReceipt = () => app.inject({
    method: 'POST', url: '/api/business/receiving', headers: authHeader(token),
    payload: { warehouseId, items: [{ itemId, quantity: 1, unitPrice: 1 }] },
  });

  const attach = async (receiptId: string, bytes: Buffer, mime = 'application/pdf', name = 'phase23.pdf') => {
    const file = multipart(name, mime, bytes);
    return app.inject({ method: 'POST', url: `/api/business/receiving/${receiptId}/attachments`, headers: { ...authHeader(token), ...file.headers }, payload: file.payload });
  };

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.VIEWER } });
    companyId = (await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } })).id;
    const otherCompanyId = (await prisma.company.create({ data: { code: `P23_${TAG}`, nameTh: 'บริษัทขอบเขตอื่น' } })).id;
    const makeUser = async (username: string, membershipCompanyId: string, roleId = role.id) => {
      const user = await prisma.user.create({ data: { username, email: `${username}@s2a.test`, fullName: username, passwordHash: await bcrypt.hash('Phase23Pass!', 10), isActive: true, mustChangePassword: false } });
      await prisma.userRole.create({ data: { userId: user.id, roleId } });
      await prisma.companyMembership.create({ data: { userId: user.id, companyId: membershipCompanyId, roleId, isDefault: true } });
      return username;
    };
    const username = await makeUser(`p23_admin_${TAG}`, companyId);
    const otherUsername = await makeUser(`p23_other_${TAG}`, otherCompanyId);
    const viewerUsername = await makeUser(`p23_view_${TAG}`, companyId, viewerRole.id);
    const gram = await prisma.unit.upsert({ where: { code: `G_${TAG}` }, update: {}, create: { code: `G_${TAG}`, name: 'Gram' } });
    const kg = await prisma.unit.upsert({ where: { code: 'KG' }, update: {}, create: { code: 'KG', name: 'Kilogram' } });
    warehouseId = (await prisma.warehouse.create({ data: { companyId, code: `WH_${TAG}`, name: 'Phase 23 Warehouse' } })).id;
    supplierId = (await prisma.supplier.create({ data: { companyId, code: `SUP_${TAG}`, name: 'Phase Supplier', taxId: '0105566123456' } })).id;
    itemId = (await prisma.item.create({ data: {
      companyId, code: 'P23-RICE', name: 'Jasmine Rice', type: ItemType.RAW_MATERIAL,
      baseUnitId: gram.id, purchaseUnitId: kg.id, purchaseToBaseFactor: 1000,
    } })).id;
    app = await buildApp(); await app.ready();
    const login = async (loginUsername: string) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: loginUsername, password: 'Phase23Pass!' } })).json().data.accessToken as string;
    token = await login(username); otherToken = await login(otherUsername); viewerToken = await login(viewerUsername);
  });

  afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); });

  it('extracts text PDF, matches exact supplier/item/unit, and preserves numbers', async () => {
    const receipt = (await createReceipt()).json().data;
    const pdf = await pdfBuffer([
      'Supplier: Phase Supplier', 'Tax ID: 0105566123456', 'Invoice No: INV-P23-001', 'Date: 24/08/2026',
      'Currency: THB', 'P23-RICE Jasmine Rice 2 KG 47.50 95.00', 'Subtotal: 95.00', 'Grand Total: 95.00',
    ].join('\n'));
    const attachment = (await attach(receipt.id, pdf)).json().data;
    const response = await app.inject({ method: 'POST', url: `/api/business/receiving/${receipt.id}/attachments/${attachment.id}/extractions`, headers: authHeader(token), payload: {} });
    expect(response.statusCode).toBe(201);
    const extraction = response.json().data;
    expect(extraction.status).toBe('READY');
    expect(extraction.matchedSupplierId).toBe(supplierId);
    expect(extraction.lines).toHaveLength(1);
    expect(extraction.lines[0]).toMatchObject({ matchedItemId: itemId, matchStatus: 'MATCHED', quantity: '2', unitPrice: '47.5', lineTotal: '95' });
  });

  it('requires explicit replacement, applies to the same DRAFT without ledger changes, then normal confirm creates stock', async () => {
    const receipt = (await createReceipt()).json().data;
    const receiptNo = receipt.receiptNo as string;
    const pdf = await pdfBuffer(['Supplier: Phase Supplier', 'Tax ID: 0105566123456', 'Invoice No: APPLY-001', 'P23-RICE Jasmine Rice 2 KG 47.50 95.00', 'Grand Total: 95.00'].join('\n'));
    const attachment = (await attach(receipt.id, pdf)).json().data;
    const extraction = (await app.inject({ method: 'POST', url: `/api/business/receiving/${receipt.id}/attachments/${attachment.id}/extractions`, headers: authHeader(token), payload: {} })).json().data;
    expect(await prisma.stockLedger.count({ where: { refId: receipt.id } })).toBe(0);

    const guarded = await app.inject({ method: 'POST', url: `/api/business/receiving/${receipt.id}/extractions/${extraction.id}/apply`, headers: authHeader(token), payload: {} });
    expect(guarded.statusCode).toBe(409);
    expect(guarded.json().error.code).toBe('REPLACE_CONFIRMATION_REQUIRED');

    const applied = await app.inject({ method: 'POST', url: `/api/business/receiving/${receipt.id}/extractions/${extraction.id}/apply`, headers: authHeader(token), payload: { replaceLinesConfirmed: true } });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().data).toMatchObject({ id: receipt.id, receiptNo, status: 'DRAFT', supplierId });
    expect(Number(applied.json().data.items[0].quantity)).toBe(2);
    expect(Number(applied.json().data.items[0].unitPrice)).toBe(47.5);
    expect(await prisma.stockLedger.count({ where: { refId: receipt.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: receipt.id, action: 'DOCUMENT_EXTRACTION_APPLIED' } })).toBe(1);

    const confirmed = await app.inject({ method: 'POST', url: `/api/business/receiving/${receipt.id}/confirm`, headers: authHeader(token) });
    expect(confirmed.statusCode).toBe(200);
    expect(await prisma.stockLedger.count({ where: { refId: receipt.id } })).toBeGreaterThan(0);
    const historical = await app.inject({ method: 'POST', url: `/api/business/receiving/${receipt.id}/attachments/${attachment.id}/extractions`, headers: authHeader(token), payload: {} });
    expect(historical.statusCode).toBe(409);
    expect(historical.json().error.code).toBe('RECEIPT_NOT_DRAFT');
  });

  it('enforces company scope on extraction endpoints', async () => {
    const receipt = (await createReceipt()).json().data;
    const attachment = (await attach(receipt.id, await pdfBuffer('P23-RICE Jasmine Rice 1 KG 10.00 10.00'))).json().data;
    const response = await app.inject({ method: 'POST', url: `/api/business/receiving/${receipt.id}/attachments/${attachment.id}/extractions`, headers: authHeader(otherToken), payload: {} });
    expect(response.statusCode).toBe(404);
    const otherReceipt = (await createReceipt()).json().data;
    const crossReceipt = await app.inject({ method: 'POST', url: `/api/business/receiving/${otherReceipt.id}/attachments/${attachment.id}/extractions`, headers: authHeader(token), payload: {} });
    expect(crossReceipt.statusCode).toBe(404);
  });

  it('requires receiving permission and leaves unknown supplier/item unresolved', async () => {
    const receipt = (await createReceipt()).json().data;
    const attachment = (await attach(receipt.id, await pdfBuffer(['Supplier: Unknown Vendor', 'UNKNOWN-01 Unknown Material 1 KG 10.00 10.00'].join('\n')))).json().data;
    const forbidden = await app.inject({ method: 'POST', url: `/api/business/receiving/${receipt.id}/attachments/${attachment.id}/extractions`, headers: authHeader(viewerToken), payload: {} });
    expect(forbidden.statusCode).toBe(403);
    const result = await app.inject({ method: 'POST', url: `/api/business/receiving/${receipt.id}/attachments/${attachment.id}/extractions`, headers: authHeader(token), payload: {} });
    expect(result.statusCode).toBe(201);
    expect(result.json().data.matchedSupplierId).toBeNull();
    expect(result.json().data.lines[0].matchStatus).toBe('UNMATCHED');
    expect(result.json().data.status).toBe('REVIEW_REQUIRED');
  });

  it('persists OCR-unavailable failure without modifying the draft', async () => {
    const receipt = (await createReceipt()).json().data;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const attachment = (await attach(receipt.id, png, 'image/png', 'controlled.png')).json().data;
    const response = await app.inject({ method: 'POST', url: `/api/business/receiving/${receipt.id}/attachments/${attachment.id}/extractions`, headers: authHeader(token), payload: {} });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('OCR_UNAVAILABLE');
    const unchanged = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: receipt.id }, include: { items: true } });
    expect(unchanged.status).toBe('DRAFT');
    expect(unchanged.items).toHaveLength(1);
    expect(await prisma.stockLedger.count({ where: { refId: receipt.id } })).toBe(0);
  });
});
