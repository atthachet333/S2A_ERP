import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus, AlertTriangle, Info } from 'lucide-react';
import MasterModal from '@/components/ui/MasterModal';
import { useToast } from '@/components/ui/Toast';
import { catalogApi, type Item, type ItemStockSummary, type ItemType } from '@/lib/catalog';
import { formatMoney } from '@/lib/utils';
import {
  bangkokNow, buildReceivingRequest, decimalToString, RECEIVE_REASON_HINT, RECEIVE_REASON_LABEL,
  RECEIVE_REASONS, receivingMath, type PriceMode, type ReceiveReason, type ReceivingFormValues,
} from '@/lib/stock-receiving';

/**
 * PHASE 35 — นำเข้าสต็อกจากหน้าวัตถุดิบ
 *
 * ทุกครั้งที่กดยืนยัน จะสร้าง "ใบรับของ" หนึ่งใบผ่าน POST /business/receiving (confirm: true)
 * รับซ้ำวัตถุดิบเดิมคนละราคาคนละวัน = ใบใหม่ทุกครั้ง หลักฐานเดิมไม่ถูกแตะ
 */

export interface StockReceivingResult {
  receiptNo: string;
  itemName: string;
  quantity: string;
  unitCode: string;
  unitPrice: string;
  totalValue: string;
  reason: ReceiveReason;
  remark: string;
  stock: ItemStockSummary | null;
}

const emptyForm = (itemId: string): ReceivingFormValues => ({
  itemId,
  warehouseId: '',
  supplierId: '',
  ...bangkokNow(),
  quantity: '',
  mode: 'UNIT',
  unitPrice: '',
  totalPrice: '',
  reason: 'PURCHASE',
  remark: '',
  supplierDocNo: '',
  lotNo: '',
  manufactureDate: '',
  expiryDate: '',
});

export type ReceivingDialogItem = Pick<Item, 'id' | 'name' | 'code' | 'lastCost' | 'isLotTracked' | 'isExpiryTracked' | 'baseUnit' | 'purchaseUnit' | 'purchaseToBaseFactor'>;

export default function StockReceivingDialog({
  open, item, pickerType, allowPick = false, onClose, onReceived,
}: {
  open: boolean;
  /** วัตถุดิบที่ถูกเลือกไว้ล่วงหน้าจากแถว/หน้ารายละเอียด — null เมื่อเปิดจากปุ่มรวม */
  item: ReceivingDialogItem | null;
  /** จำกัดตัวเลือกให้เหลือเฉพาะชนิดนี้ (เว้นว่าง = วัตถุดิบและบรรจุภัณฑ์ทั้งหมด) */
  pickerType?: ItemType;
  /** เปิดโดยไม่ระบุวัตถุดิบ แล้วให้เลือกในฟอร์ม */
  allowPick?: boolean;
  onClose: () => void;
  onReceived: (result: StockReceivingResult) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<ReceivingFormValues>(() => emptyForm(item?.id ?? ''));
  const [submitted, setSubmitted] = useState(false);
  const set = (patch: Partial<ReceivingFormValues>) => setForm((f) => ({ ...f, ...patch }));

  const lookups = useQuery({
    queryKey: ['receiving-lookups'],
    queryFn: () => catalogApi.receivingLookups(),
    enabled: open,
  });

  /* เปิดจากปุ่มรวม (ยังไม่รู้ว่าจะรับอะไร) จึงต้องมีรายการให้เลือกในฟอร์ม
     ไม่เดาให้เองว่าเป็นรายการแรกของหน้าที่เปิดอยู่ */
  const picking = !item && (allowPick || Boolean(pickerType));
  const selectable = useQuery({
    queryKey: ['selectable-items', pickerType],
    queryFn: () => catalogApi.selectableItems(pickerType),
    enabled: open && picking,
  });
  const activeItem: ReceivingDialogItem | null = item ?? (selectable.data ?? []).find((row) => row.id === form.itemId) ?? null;

  // เปิด modal ใหม่ทุกครั้ง = ฟอร์มสะอาด ไม่มีค่าค้างจากการรับครั้งก่อน
  useEffect(() => {
    if (open) { setForm(emptyForm(item?.id ?? '')); setSubmitted(false); }
  }, [open, item?.id]);

  // มีคลังเดียวก็ไม่ต้องให้เลือก — เลือกให้เลย แต่ยังเปลี่ยนได้
  const warehouses = useMemo(() => lookups.data?.warehouses ?? [], [lookups.data]);
  useEffect(() => {
    if (!form.warehouseId && warehouses.length === 1) set({ warehouseId: warehouses[0].id });
  }, [warehouses]); // eslint-disable-line react-hooks/exhaustive-deps

  const purchaseUnitCode = activeItem?.purchaseUnit?.code ?? activeItem?.baseUnit?.code ?? '';
  const baseUnitCode = activeItem?.baseUnit?.code ?? '';
  const factor = Number(activeItem?.purchaseToBaseFactor ?? 1) || 1;
  const differentUnits = Boolean(purchaseUnitCode && baseUnitCode && purchaseUnitCode !== baseUnitCode);

  const math = useMemo(() => receivingMath(form), [form]);
  const validation = useMemo(
    () => (activeItem ? buildReceivingRequest(form, activeItem) : null),
    [form, activeItem],
  );

  const receive = useMutation({
    mutationFn: async () => {
      if (!validation?.request) throw new Error(validation?.error ?? 'ข้อมูลยังไม่ครบ');
      const receipt = await catalogApi.receiveStock(validation.request.body);
      /* อ่านยอดคงเหลือหลังรับเข้าเพื่อแสดงในหน้าสรุป
         ผู้ใช้บางคนรับของได้แต่ไม่มีสิทธิ์ดูสต็อก — กรณีนั้นข้ามไป ไม่ให้ทั้งงานล้ม */
      const stock = await catalogApi.itemStock(activeItem!.id).catch(() => null);
      return { receipt, stock };
    },
    onSuccess: ({ receipt, stock }) => {
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['item', activeItem?.id] });
      void qc.invalidateQueries({ queryKey: ['item-stock', activeItem?.id] });
      void qc.invalidateQueries({ queryKey: ['item-receipts', activeItem?.id] });
      void qc.invalidateQueries({ queryKey: ['selectable-items'] });
      onReceived({
        receiptNo: receipt.receiptNo,
        itemName: activeItem?.name ?? '',
        quantity: math.quantity ? decimalToString(math.quantity) : form.quantity,
        unitCode: purchaseUnitCode,
        unitPrice: math.unitPrice ? decimalToString(math.unitPrice) : '',
        totalValue: math.totalPrice ? decimalToString(math.totalPrice) : '',
        reason: form.reason,
        remark: form.remark?.trim() ?? '',
        stock,
      });
      onClose();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'นำเข้าสต็อกไม่สำเร็จ', 'error'),
  });

  if (!item && !picking) return null;

  const showError = submitted ? validation?.error ?? (form.itemId ? '' : 'เลือกวัตถุดิบก่อน') : '';
  const submit = () => {
    setSubmitted(true);
    if (!validation?.request) return;
    receive.mutate();
  };

  return (
    <MasterModal
      open={open}
      width={720}
      title="นำเข้าสต็อก"
      description={activeItem
        ? <>{activeItem.name} <span className="num">({activeItem.code})</span> · ทุกครั้งที่รับเข้าจะบันทึกเป็นใบรับของแยกใบ ราคาครั้งก่อนไม่ถูกแก้</>
        : 'เลือกวัตถุดิบที่จะรับเข้า — ทุกครั้งที่รับเข้าจะบันทึกเป็นใบรับของแยกใบ ราคาครั้งก่อนไม่ถูกแก้'}
      error={showError}
      busy={receive.isPending}
      confirmLabel="ยืนยันรับเข้าสต็อก"
      confirmIcon={<PackagePlus aria-hidden width={16} />}
      onClose={onClose}
      onConfirm={submit}
    >
      <div className="md-fields sr-form">
        {picking && (
          <label className="full">วัตถุดิบ *
            <select value={form.itemId} onChange={(e) => set({ itemId: e.target.value, lotNo: '', manufactureDate: '', expiryDate: '' })}>
              <option value="">เลือกวัตถุดิบ</option>
              {(selectable.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.name} ({row.code})</option>)}
            </select>
          </label>
        )}
        <label>วันที่รับเข้า *
          <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
        <label>เวลารับเข้า *
          <input type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} />
          <span className="md-hint">เวลาไทย</span>
        </label>

        <label>คลังที่รับเข้า *
          <select value={form.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}>
            <option value="">เลือกคลัง</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label>ผู้ขาย (Supplier)
          <select value={form.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
            <option value="">ไม่ระบุ</option>
            {(lookups.data?.suppliers ?? []).map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
          </select>
          <span className="md-hint">ระบุแล้วราคานี้จะเข้าไปอยู่ในประวัติราคาของผู้ขายรายนั้นด้วย</span>
        </label>

        <label>จำนวน *
          <input type="number" min="0" step="any" inputMode="decimal" value={form.quantity}
            onChange={(e) => set({ quantity: e.target.value })} placeholder="1" />
          <span className="md-hint">หน่วยที่ซื้อ: {purchaseUnitCode || '—'}</span>
        </label>

        <div className="md-field">
          <span id="sr-price-mode">กรอกราคาแบบ</span>
          <div className="sr-mode" role="group" aria-labelledby="sr-price-mode">
            {(['UNIT', 'TOTAL'] as PriceMode[]).map((mode) => (
              <button key={mode} type="button" className={form.mode === mode ? 'active' : ''}
                aria-pressed={form.mode === mode} onClick={() => set({ mode })}>
                {mode === 'UNIT' ? 'ราคาต่อหน่วย' : 'ราคารวม'}
              </button>
            ))}
          </div>
        </div>

        {form.mode === 'UNIT' ? (
          <label>ราคาต่อหน่วย (บาท/{purchaseUnitCode || 'หน่วย'}) *
            <input type="number" min="0" step="any" inputMode="decimal" value={form.unitPrice}
              onChange={(e) => set({ unitPrice: e.target.value })} placeholder="35" />
          </label>
        ) : (
          <label>ราคารวม (บาท) *
            <input type="number" min="0" step="any" inputMode="decimal" value={form.totalPrice}
              onChange={(e) => set({ totalPrice: e.target.value })} placeholder="35" />
          </label>
        )}

        <div className="md-field full sr-preview" aria-live="polite">
          <div><span>จำนวน</span><strong>{math.quantity ? `${decimalToString(math.quantity)} ${purchaseUnitCode}` : '—'}</strong></div>
          <div><span>ราคาต่อหน่วย</span><strong>{math.unitPrice ? `${decimalToString(math.unitPrice)} บาท/${purchaseUnitCode}` : '—'}</strong></div>
          <div className="lead"><span>ราคารวม</span><strong>{math.totalPrice ? `${decimalToString(math.totalPrice)} บาท` : '—'}</strong></div>
          {differentUnits && math.unitPrice && (
            <p className="md-hint full">
              1 {purchaseUnitCode} = {factor} {baseUnitCode} · ต้นทุนต่อหน่วยฐานที่จะบันทึก {formatMoney(Number(decimalToString(math.unitPrice)) / factor, 4)} บาท/{baseUnitCode}
            </p>
          )}
          {math.roundedUnitPrice && (
            <p className="md-hint full"><Info aria-hidden width={13} />
              ราคารวมหารด้วยจำนวนไม่ลงตัว ระบบปัดราคาต่อหน่วยเป็น 4 ตำแหน่ง ยอดรวมที่บันทึกจริงคือตัวเลขด้านบน
            </p>
          )}
        </div>

        <div className="md-field full">
          <span id="sr-reason">ประเภทการรับเข้า *</span>
          <div className="sr-reasons" role="group" aria-labelledby="sr-reason">
            {RECEIVE_REASONS.map((reason) => (
              <button key={reason} type="button" className={form.reason === reason ? 'active' : ''}
                aria-pressed={form.reason === reason} onClick={() => set({ reason })}>
                <b>{RECEIVE_REASON_LABEL[reason]}</b>
                <small>{RECEIVE_REASON_HINT[reason]}</small>
              </button>
            ))}
          </div>
        </div>

        {activeItem?.isLotTracked && (
          <>
            <label>เลข Lot *
              <input value={form.lotNo} onChange={(e) => set({ lotNo: e.target.value })} placeholder="LOT-001" />
            </label>
            <label>วันที่ผลิต
              <input type="date" value={form.manufactureDate} onChange={(e) => set({ manufactureDate: e.target.value })} />
            </label>
            <label>วันหมดอายุ {activeItem.isExpiryTracked ? '*' : ''}
              <input type="date" value={form.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} />
            </label>
          </>
        )}

        <label className="full">เลขที่เอกสารผู้ขาย
          <input value={form.supplierDocNo} onChange={(e) => set({ supplierDocNo: e.target.value })} placeholder="(ไม่บังคับ) เช่น INV-2569-0912" />
        </label>

        <label className="full">หมายเหตุ / Remark
          <textarea rows={2} value={form.remark} onChange={(e) => set({ remark: e.target.value })}
            placeholder="เช่น หมูจากตลาดเช้า ราคาขึ้น" />
          <span className="md-hint">ไม่บังคับ · ข้อความนี้จะติดไปกับประวัติรับเข้าครั้งนี้ตลอดไป</span>
        </label>

        {activeItem && !activeItem.isLotTracked && (
          <p className="md-hint full"><Info aria-hidden width={13} />
            วัตถุดิบนี้ยังไม่ได้เปิดการติดตาม Lot จึงไม่ต้องกรอก Lot และวันหมดอายุ
          </p>
        )}
        {lookups.isError && (
          <p className="md-error full"><AlertTriangle aria-hidden />โหลดรายชื่อคลัง/ผู้ขายไม่สำเร็จ ลองปิดแล้วเปิดใหม่อีกครั้ง</p>
        )}
      </div>
    </MasterModal>
  );
}
