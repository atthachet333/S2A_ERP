import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, FileScan, LoaderCircle, Save, Sparkles, TriangleAlert } from 'lucide-react';
import { ApiClientError, apiClient } from '@/lib/api-client';
import type { ReceiptAttachment } from '@/lib/receipt-attachment';
import { extractionStatusLabel, matchLabel, type DocumentExtraction, type ExtractionLine } from '@/lib/document-extraction';
import { useToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

type Supplier = { id: string; code: string; name: string };
type Item = { id: string; code: string; name: string; baseUnit: { code: string }; purchaseUnit?: { code: string } };
type Unit = { id: string; code: string; name: string; isActive: boolean };
type Lookups = { suppliers: Supplier[]; items: Item[] };

const numberValue = (value: string | null) => value === null ? '' : value;

export function DocumentExtractionReview({ receiptId, attachments }: { receiptId: string; attachments: ReceiptAttachment[] }) {
  const { toast } = useToast();
  const [results, setResults] = useState<DocumentExtraction[]>([]);
  const [active, setActive] = useState<DocumentExtraction | null>(null);
  const [lookups, setLookups] = useState<Lookups>({ suppliers: [], items: [] });
  const [units, setUnits] = useState<Unit[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);

  const load = async () => {
    const rows = await apiClient.get<DocumentExtraction[]>(`/business/receiving/${receiptId}/extractions`);
    setResults(rows);
    setActive((current) => current ? rows.find((row) => row.id === current.id) ?? rows[0] ?? null : rows[0] ?? null);
  };

  useEffect(() => { void load(); }, [receiptId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void Promise.all([
      apiClient.get<Lookups>('/business/operations/lookups'),
      apiClient.get<Unit[]>('/units'),
    ]).then(([options, unitRows]) => { setLookups(options); setUnits(unitRows.filter((unit) => unit.isActive)); });
  }, []);

  const run = async (attachment: ReceiptAttachment) => {
    if (processingId) return;
    setProcessingId(attachment.id);
    try {
      const result = await apiClient.post<DocumentExtraction>(`/business/receiving/${receiptId}/attachments/${attachment.id}/extractions`, {});
      setActive(result);
      toast({ title: 'อ่านเอกสารแล้ว', description: 'กรุณาตรวจสอบทุกช่องก่อนนำข้อมูลไปใช้', variant: 'success' });
      await load();
    } catch (error) {
      if (error instanceof ApiClientError && error.details) setActive(error.details as DocumentExtraction);
      toast({ title: 'ระบบอ่านเอกสารนี้อัตโนมัติไม่ได้', description: 'คุณยังสามารถกรอกใบรับเข้าสินค้าตามปกติได้', variant: 'error' });
      await load();
    } finally { setProcessingId(null); }
  };

  const updateLine = (id: string, patch: Partial<ExtractionLine>) => setActive((current) => current ? {
    ...current,
    lines: current.lines.map((line) => line.id === id ? {
      ...line, ...patch,
      matchStatus: (patch.matchedItemId ?? line.matchedItemId) && (patch.matchedUnitId ?? line.matchedUnitId) ? 'MATCHED' : 'UNMATCHED',
    } : line),
  } : current);

  const reviewPayload = (extraction: DocumentExtraction) => ({
    matchedSupplierId: extraction.matchedSupplierId,
    lines: extraction.lines.map((line) => ({
      id: line.id, matchedItemId: line.matchedItemId, matchedUnitId: line.matchedUnitId,
      quantity: line.quantity === '' ? null : Number(line.quantity),
      unitPrice: line.unitPrice === '' ? null : Number(line.unitPrice),
      lineTotal: line.lineTotal === '' ? null : Number(line.lineTotal),
    })),
  });

  const saveReview = async () => {
    if (!active || saving) return;
    setSaving(true);
    try {
      const saved = await apiClient.patch<DocumentExtraction>(`/business/receiving/${receiptId}/extractions/${active.id}`, reviewPayload(active));
      setActive(saved); await load();
      toast({ title: 'บันทึกการตรวจทานแล้ว', variant: 'success' });
    } catch (error) { toast({ title: 'บันทึกไม่สำเร็จ', description: error instanceof Error ? error.message : '', variant: 'error' }); }
    finally { setSaving(false); }
  };

  const apply = async () => {
    if (!active || saving) return;
    setSaving(true);
    try {
      await apiClient.patch<DocumentExtraction>(`/business/receiving/${receiptId}/extractions/${active.id}`, reviewPayload(active));
      await apiClient.post(`/business/receiving/${receiptId}/extractions/${active.id}/apply`, { replaceLinesConfirmed: true });
      toast({ title: 'นำข้อมูลไปใช้กับใบรับเข้าแล้ว', description: 'เอกสารยังเป็นร่างและยังไม่มีผลต่อสต็อก', variant: 'success' });
      await load();
    } catch (error) { toast({ title: 'นำข้อมูลไปใช้ไม่ได้', description: error instanceof Error ? error.message : '', variant: 'error' }); }
    finally { setSaving(false); }
  };

  const unresolved = useMemo(() => active?.lines.filter((line) => line.matchStatus !== 'MATCHED' || !line.quantity || line.unitPrice === null || line.lineTotal === null).length ?? 0, [active]);

  return <section className="extract-workspace" aria-label="อ่านและตรวจทานข้อมูลจากเอกสารต้นฉบับ">
    <div className="extract-actions">
      <div><h3><Sparkles aria-hidden />ตัวช่วยอ่านเอกสาร</h3><p>ระบบช่วยเติมร่างเท่านั้น คุณต้องตรวจทานก่อน และจะไม่ยืนยันรับเข้าสินค้าอัตโนมัติ</p></div>
      <div className="extract-file-actions">
        {attachments.map((attachment) => <button type="button" className="btn" key={attachment.id} disabled={Boolean(processingId)} onClick={() => void run(attachment)}>
          {processingId === attachment.id ? <LoaderCircle className="spin" aria-hidden /> : <FileScan aria-hidden />}
          {processingId === attachment.id ? 'กำลังอ่าน…' : `อ่านข้อมูลจาก ${attachment.originalName}`}
        </button>)}
      </div>
    </div>

    {results.length > 1 && <label className="extract-version">ผลการอ่าน
      <select value={active?.id ?? ''} onChange={(event) => setActive(results.find((row) => row.id === event.target.value) ?? null)}>
        {results.map((row) => <option value={row.id} key={row.id}>ครั้งที่ {row.version} · {row.attachment.originalName} · {extractionStatusLabel[row.status]}</option>)}
      </select>
    </label>}

    {active?.status === 'FAILED' && <div className="extract-failure" role="status">
      <AlertCircle aria-hidden /><div><b>ระบบอ่านเอกสารนี้อัตโนมัติไม่ได้</b><p>{active.failureMessage}<br />คุณยังสามารถกรอกใบรับเข้าสินค้าตามปกติได้</p></div>
      <a className="btn" href={active.originalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden />ดูไฟล์ต้นฉบับ</a>
    </div>}

    {active && active.status !== 'FAILED' && <>
      <div className="extract-meta">
        <span className={`extract-state state-${active.status.toLowerCase()}`}>{extractionStatusLabel[active.status]}</span>
        <span>คุณภาพ {active.quality ?? '—'}</span><span>ผลครั้งที่ {active.version}</span>
        <a href={active.originalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden />ดูไฟล์ต้นฉบับ</a>
      </div>
      <div className="extract-header-grid">
        <label>ผู้ขายที่ระบบอ่านได้<input value={active.supplierName ?? ''} readOnly /></label>
        <label>ผู้ขายในระบบ<select value={active.matchedSupplierId ?? ''} onChange={(event) => setActive({ ...active, matchedSupplierId: event.target.value || null })}>
          <option value="">ไม่พบผู้ขายที่ตรงกัน — กรุณาเลือก</option>
          {lookups.suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.code} · {supplier.name}</option>)}
        </select></label>
        <label>เลขที่เอกสาร<input value={active.supplierDocumentNo ?? ''} readOnly /></label>
        <label>วันที่เอกสาร<input value={active.documentDate?.slice(0, 10) ?? ''} readOnly /></label>
      </div>
      <div className="extract-table-wrap"><table className="extract-table">
        <thead><tr><th>ข้อความต้นฉบับ</th><th>สินค้าที่ตรงกัน</th><th>จำนวน</th><th>หน่วย</th><th>ราคา/หน่วย</th><th>ยอดรวม</th><th>สถานะ</th></tr></thead>
        <tbody>{active.lines.map((line) => <tr key={line.id} className={`match-${line.matchStatus.toLowerCase()}`}>
          <td data-label="ข้อความต้นฉบับ"><b>{line.rawDescription}</b>{line.extractedItemCode && <small>{line.extractedItemCode}</small>}</td>
          <td data-label="สินค้า"><select aria-label={`สินค้ารายการ ${line.position}`} value={line.matchedItemId ?? ''} onChange={(event) => updateLine(line.id, { matchedItemId: event.target.value || null })}>
            <option value="">เลือกสินค้า</option>{lookups.items.map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}
          </select></td>
          <td data-label="จำนวน"><input type="number" min="0.0001" step="any" value={numberValue(line.quantity)} onChange={(event) => updateLine(line.id, { quantity: event.target.value })} /></td>
          <td data-label="หน่วย"><select aria-label={`หน่วยรายการ ${line.position}`} value={line.matchedUnitId ?? ''} onChange={(event) => updateLine(line.id, { matchedUnitId: event.target.value || null })}>
            <option value="">{line.unitText ? `${line.unitText} — เลือกหน่วย` : 'เลือกหน่วย'}</option>{units.map((unit) => <option value={unit.id} key={unit.id}>{unit.code} · {unit.name}</option>)}
          </select></td>
          <td data-label="ราคา/หน่วย"><input type="number" min="0" step="any" value={numberValue(line.unitPrice)} onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })} /></td>
          <td data-label="ยอดรวม"><input type="number" min="0" step="any" value={numberValue(line.lineTotal)} onChange={(event) => updateLine(line.id, { lineTotal: event.target.value })} /></td>
          <td data-label="สถานะ"><span className="match-label">{line.matchStatus === 'MATCHED' ? <CheckCircle2 aria-hidden /> : line.matchStatus === 'AMBIGUOUS' ? <TriangleAlert aria-hidden /> : <AlertCircle aria-hidden />}{matchLabel[line.matchStatus]}</span>{line.warnings.map((warning) => <small key={warning}>{warning}</small>)}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="extract-summary">
        <dl><div><dt>ยอดก่อนส่วนลด</dt><dd>{active.subtotal ?? '—'}</dd></div><div><dt>ส่วนลด</dt><dd>{active.discount ?? '—'}</dd></div><div><dt>VAT</dt><dd>{active.vat ?? '—'}</dd></div><div><dt>ยอดสุทธิ</dt><dd>{active.grandTotal ?? '—'} {active.currency ?? ''}</dd></div></dl>
        {active.warnings.map((warning) => <p key={warning}><TriangleAlert aria-hidden />{warning}</p>)}
      </div>
      <div className="extract-review-actions">
        <span>{unresolved ? `ยังต้องตรวจสอบ ${unresolved} รายการ` : 'รายการพร้อมนำไปใช้ — กรุณาตรวจยอดอีกครั้ง'}</span>
        <button type="button" className="btn" disabled={saving} onClick={() => void saveReview()}><Save aria-hidden />บันทึกการตรวจทาน</button>
        <button type="button" className="btn primary" disabled={saving || unresolved > 0 || active.status === 'APPLIED'} onClick={() => setApplyOpen(true)}>นำข้อมูลไปใช้กับใบรับเข้า</button>
      </div>
    </>}

    <ConfirmDialog open={applyOpen} title="แทนที่รายการในร่างด้วยข้อมูลที่ตรวจทานแล้ว?" confirmLabel="นำข้อมูลไปใช้กับร่าง" onClose={() => setApplyOpen(false)} onConfirm={() => void apply()}
      description={<p>รายการเดิมหรือการแก้ไขด้วยมือในร่างอาจถูกแทนที่ เอกสารจะยังคงเป็น <b>DRAFT</b> ใช้เลขเดิม และจะยังไม่เพิ่มสต็อก</p>} />
  </section>;
}
