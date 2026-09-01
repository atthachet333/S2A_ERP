import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PackagePlus, Boxes, AlertTriangle, History, TrendingUp, Lock } from 'lucide-react';
import { catalogApi, type Item, type ItemReceiptFilter, type ReceiveReasonCode } from '@/lib/catalog';
import { formatMoney } from '@/lib/utils';
import { ContentCard, EmptyState } from '@/components/layout/page';
import Badge from '@/components/ui/Badge';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { RECEIVE_REASON_LABEL, RECEIVE_REASONS, thaiMonthLabel, thaiReceivedAt, type ReceivingAccess } from '@/lib/stock-receiving';

/**
 * PHASE 35 — สต็อกคงเหลือ + ประวัติรับเข้าของวัตถุดิบหนึ่งรายการ
 *
 * ทั้งสองส่วนอ่านจาก backend ตรง ๆ ไม่คำนวณยอดเองที่หน้าจอ
 * สิ่งที่ backend ยังตอบไม่ได้ (เช่น ไม่มีสิทธิ์ หรือยังไม่รู้ต้นทุน) แสดงเป็นสถานะตามจริง ไม่เดาเลขให้
 */
export default function ItemStockPanel({
  item, access, onReceive, historyAnchorId,
}: {
  item: Pick<Item, 'id' | 'name' | 'baseUnit'>;
  access: ReceivingAccess;
  onReceive?: () => void;
  historyAnchorId?: string;
}) {
  return (
    <>
      <StockSummary item={item} access={access} onReceive={onReceive} />
      <ReceiptHistory item={item} access={access} onReceive={onReceive} anchorId={historyAnchorId} />
    </>
  );
}

function StockSummary({
  item, access, onReceive,
}: {
  item: Pick<Item, 'id' | 'name' | 'baseUnit'>;
  access: ReceivingAccess;
  onReceive?: () => void;
}) {
  const stock = useQuery({
    queryKey: ['item-stock', item.id],
    queryFn: () => catalogApi.itemStock(item.id),
    enabled: access.canViewStock,
  });

  if (!access.canViewStock) {
    return (
      <ContentCard title={<><Boxes aria-hidden width={17} />สต็อกคงเหลือ</>}>
        <p className="md-hint"><Lock aria-hidden width={14} />บัญชีนี้ยังไม่มีสิทธิ์ดูยอดสต็อก</p>
      </ContentCard>
    );
  }

  const d = stock.data;
  const unit = d?.baseUnitCode ?? item.baseUnit?.code ?? '';

  return (
    <ContentCard
      title={<><Boxes aria-hidden width={17} />สต็อกคงเหลือ</>}
      actions={onReceive && <button type="button" className="btn primary" onClick={onReceive}><PackagePlus aria-hidden width={16} />นำเข้าสต็อก</button>}
    >
      {stock.isLoading && <p className="md-hint">กำลังโหลด…</p>}
      {stock.isError && <p className="md-error"><AlertTriangle aria-hidden />โหลดยอดสต็อกไม่สำเร็จ</p>}

      {/* ยังไม่เคยมีสต็อกจริง ต่างจาก "เคยมีแล้วตอนนี้เหลือศูนย์" — ห้ามแสดง 0 เหมือนกันทั้งสองกรณี */}
      {d && !d.hasStockHistory && (
        <EmptyState icon={Boxes} title="ยังไม่มีสต็อก"
          description="วัตถุดิบนี้ยังไม่เคยมีการรับเข้าจริงในระบบ"
          action={onReceive ? <button type="button" className="btn primary" onClick={onReceive}><PackagePlus aria-hidden width={16} />นำเข้าสต็อก</button> : undefined} />
      )}

      {d && d.hasStockHistory && (
        <>
          <dl className="sr-stock-grid">
            <div><dt>สต็อกคงเหลือ</dt><dd className="num lead">{formatMoney(d.onHand, 4)} {unit}</dd></div>
            <div><dt>จองไว้แล้ว</dt><dd className="num">{formatMoney(d.reserved, 4)} {unit}</dd></div>
            <div><dt>ต้นทุนล่าสุด</dt><dd className="num">{formatMoney(d.lastCost, 4)} บาท/{unit}</dd></div>
            <div>
              <dt>มูลค่าสต็อก</dt>
              <dd className="num">{d.stockValue === null ? <span className="md-none">ยังประเมินไม่ได้</span> : `${formatMoney(d.stockValue, 2)} บาท`}</dd>
            </div>
            <div>
              <dt>ต้นทุนเฉลี่ยรับเข้า</dt>
              <dd className="num">{d.weightedAverageCost === null ? <span className="md-none">—</span> : `${formatMoney(d.weightedAverageCost, 4)} บาท/${unit}`}</dd>
            </div>
            <div>
              <dt>รับเข้าล่าสุด</dt>
              <dd>{d.lastReceivedAt ? thaiReceivedAt(d.lastReceivedAt) : <span className="md-none">—</span>}</dd>
            </div>
          </dl>

          {/* ต้องบอกให้ชัดว่าตัวเลขไหนคือของจริงตามนโยบาย ไม่ใช่วางเลขสองชุดไว้เฉย ๆ ให้ผู้ใช้เดา */}
          <p className="md-hint">
            มูลค่าสต็อกคิดตามนโยบายเดียวกับทั้งระบบ คือ คงเหลือ x ต้นทุนล่าสุด
            {d.weightedAverageCost !== null && d.weightedAverageValue !== null && (
              <> · ถ้าคิดตามต้นทุนเฉลี่ยของการรับเข้าแทน จะได้ {formatMoney(d.weightedAverageValue, 2)} บาท (ตัวเลขอ้างอิง ไม่ใช่มูลค่าทางบัญชีของระบบ)</>
            )}
          </p>
          {d.costStatus === 'MISSING' && (
            <p className="md-hint"><AlertTriangle aria-hidden width={13} />ยังไม่เคยมีใครบันทึกต้นทุนของวัตถุดิบนี้ ระบบจึงยังประเมินมูลค่าไม่ได้</p>
          )}

          {d.byWarehouse.length > 1 && (
            <div className="table-wrap">
              <table className="data-table md-table">
                <thead><tr><th>คลัง</th><th>Lot</th><th className="num">คงเหลือ</th><th className="num">จองไว้</th></tr></thead>
                <tbody>
                  {d.byWarehouse.map((row) => (
                    <tr key={`${row.warehouseId}-${row.lotId ?? 'nolot'}`}>
                      <td data-label="คลัง">{row.warehouseName}</td>
                      <td data-label="Lot">{row.lotNo ?? '—'}</td>
                      <td className="num" data-label="คงเหลือ">{formatMoney(row.onHand, 4)}</td>
                      <td className="num" data-label="จองไว้">{formatMoney(row.reserved, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </ContentCard>
  );
}

function ReceiptHistory({
  item, access, onReceive, anchorId,
}: {
  item: Pick<Item, 'id' | 'name' | 'baseUnit'>;
  access: ReceivingAccess;
  onReceive?: () => void;
  anchorId?: string;
}) {
  const [filter, setFilter] = useState<ItemReceiptFilter>({});
  const history = useQuery({
    queryKey: ['item-receipts', item.id, filter],
    queryFn: () => catalogApi.itemReceipts(item.id, filter),
    enabled: access.canViewReceipts,
  });

  if (!access.canViewReceipts) {
    return (
      <ContentCard title={<><History aria-hidden width={17} />ประวัติรับเข้าสต็อก</>}>
        <p className="md-hint"><Lock aria-hidden width={14} />บัญชีนี้ยังไม่มีสิทธิ์ดูงานรับของ</p>
      </ContentCard>
    );
  }

  const d = history.data;
  const rows = d?.receipts ?? [];
  /* เดือนที่เลือกอยู่ต้องอยู่ในรายการเสมอ ไม่งั้นพอกรองแล้วตัวเลือกจะหายไปเอง */
  const months = [...new Set([...(d?.months ?? []), ...(filter.month ? [filter.month] : [])])].sort().reverse();
  const suppliers = [...new Map(rows.filter((r) => r.supplierId).map((r) => [r.supplierId!, r.supplierName ?? r.supplierId!])).entries()];
  const hasFilter = Boolean(filter.month || filter.supplierId || filter.reason || filter.lotNo);

  return (
    <div id={anchorId}>
    <ContentCard
      title={<><History aria-hidden width={17} />ประวัติรับเข้าสต็อก</>}
      description="เรียงจากใหม่ไปเก่า · แต่ละแถวคือหลักฐานของการรับเข้าครั้งนั้น ราคาในอดีตไม่ถูกแก้ตามราคาใหม่"
      actions={onReceive && <button type="button" className="btn" onClick={onReceive}><PackagePlus aria-hidden width={16} />นำเข้าสต็อก</button>}
      padded={false}
    >
      {d && d.trend && (
        <div className="sr-trend">
          <TrendingUp aria-hidden />
          <span>
            {thaiReceivedAt(d.trend.firstAt)} {formatMoney(d.trend.firstCost, 2)} บาท/{d.baseUnitCode}
            {' → '}
            {thaiReceivedAt(d.trend.lastAt)} {formatMoney(d.trend.lastCost, 2)} บาท/{d.baseUnitCode}
          </span>
          <b className={d.trend.changeAmount >= 0 ? 'up' : 'down'}>
            {d.trend.changeAmount >= 0 ? '+' : ''}{formatMoney(d.trend.changeAmount, 2)} บาท ({d.trend.changeAmount >= 0 ? '+' : ''}{formatMoney(d.trend.changePercent, 1)}%)
          </b>
          {/* สองจุดคือ "การเปลี่ยนแปลง" ยังไม่พอจะเรียกว่าแนวโน้ม จึงบอกจำนวนตัวอย่างไว้ตรง ๆ */}
          <small>{d.trend.sampleCount < 3 ? `เทียบจากการรับเข้า ${d.trend.sampleCount} ครั้ง — ยังน้อยเกินกว่าจะสรุปเป็นแนวโน้ม` : `จากการรับเข้า ${d.trend.sampleCount} ครั้ง`}</small>
        </div>
      )}

      {(months.length > 0 || suppliers.length > 0 || hasFilter) && (
        <div className="sr-filters">
          <select value={filter.month ?? ''} onChange={(e) => setFilter((f) => ({ ...f, month: e.target.value || undefined }))} aria-label="เดือน">
            <option value="">ทุกเดือน</option>
            {months.map((m) => <option key={m} value={m}>{thaiMonthLabel(m)}</option>)}
          </select>
          <select value={filter.supplierId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, supplierId: e.target.value || undefined }))} aria-label="ผู้ขาย">
            <option value="">ทุกผู้ขาย</option>
            {suppliers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select value={filter.reason ?? ''} onChange={(e) => setFilter((f) => ({ ...f, reason: (e.target.value || undefined) as ReceiveReasonCode | undefined }))} aria-label="ประเภทการรับเข้า">
            <option value="">ทุกประเภท</option>
            {RECEIVE_REASONS.map((r) => <option key={r} value={r}>{RECEIVE_REASON_LABEL[r]}</option>)}
          </select>
          {hasFilter && <button type="button" className="btn" onClick={() => setFilter({})}>ล้างตัวกรอง</button>}
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table md-table sr-history">
          <thead>
            <tr>
              <th>วันที่ / เวลา</th><th>เอกสาร</th><th>ผู้ขาย</th>
              <th className="num">จำนวน</th><th className="num">ราคา/หน่วย</th><th className="num">มูลค่ารวม</th>
              <th>ประเภท</th><th>Lot / หมดอายุ</th><th>หมายเหตุ</th><th>ผู้บันทึก</th>
            </tr>
          </thead>
          {history.isLoading ? <SkeletonRows rows={4} cols={10} /> : (
            <tbody>
              {rows.map((r) => (
                <tr key={r.receiptItemId} className={r.status === 'REVERSED' ? 'is-reversed' : undefined}>
                  <td data-label="วันที่ / เวลา">{thaiReceivedAt(r.receivedAt)}</td>
                  <td data-label="เอกสาร">
                    <span className="md-two-line">
                      <b className="num">{r.receiptNo}</b>
                      {r.status !== 'CONFIRMED' && <Badge variant={r.status === 'REVERSED' ? 'muted' : 'gold'}>{r.status === 'REVERSED' ? 'กลับรายการแล้ว' : r.status}</Badge>}
                    </span>
                  </td>
                  <td data-label="ผู้ขาย">{r.supplierName ?? '—'}</td>
                  <td className="num" data-label="จำนวน">
                    {formatMoney(r.quantity, 4)} {r.purchaseUnitCode}
                    {r.purchaseUnitCode !== r.baseUnitCode && <small> ({formatMoney(r.baseQty, 4)} {r.baseUnitCode})</small>}
                  </td>
                  <td className="num" data-label="ราคา/หน่วย">{formatMoney(r.unitPrice, 2)}</td>
                  <td className="num" data-label="มูลค่ารวม">{formatMoney(r.totalValue, 2)}</td>
                  <td data-label="ประเภท">{r.reasonLabel}</td>
                  <td data-label="Lot / หมดอายุ">
                    {r.lotNo ? <span className="md-two-line"><b>{r.lotNo}</b>{r.expiryDate && <small>หมดอายุ {thaiReceivedAt(r.expiryDate).replace(/ \d{2}:\d{2} น\.$/, '')}</small>}</span> : '—'}
                  </td>
                  <td data-label="หมายเหตุ">{r.remark ?? '—'}</td>
                  <td data-label="ผู้บันทึก">{r.createdByName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>

      {history.isError && <EmptyState variant="error" icon={AlertTriangle} title="โหลดประวัติรับเข้าไม่สำเร็จ" description="ลองใหม่อีกครั้ง" />}
      {!history.isLoading && !history.isError && rows.length === 0 && (
        hasFilter
          ? <EmptyState icon={History} title="ไม่พบรายการตามตัวกรอง" description="ลองเปลี่ยนเดือน ผู้ขาย หรือประเภทการรับเข้า"
              action={<button type="button" className="btn" onClick={() => setFilter({})}>ล้างตัวกรอง</button>} />
          : <EmptyState icon={History} title="ยังไม่มีประวัติรับเข้า" description="เมื่อรับวัตถุดิบนี้เข้าสต็อก รายการจะขึ้นที่นี่พร้อมราคาและหมายเหตุของครั้งนั้น"
              action={onReceive ? <button type="button" className="btn primary" onClick={onReceive}><PackagePlus aria-hidden width={16} />นำเข้าสต็อก</button> : undefined} />
      )}
    </ContentCard>
    </div>
  );
}
