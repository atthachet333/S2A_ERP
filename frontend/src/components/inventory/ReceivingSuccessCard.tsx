import { Link } from 'react-router-dom';
import { CheckCircle2, PackagePlus, History, Boxes } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import { RECEIVE_REASON_LABEL } from '@/lib/stock-receiving';
import type { StockReceivingResult } from './StockReceivingDialog';

/**
 * PHASE 35 — สรุปหลังรับเข้าสำเร็จ
 *
 * ตอบสามคำถามที่ผู้ใช้ถามทันทีหลังกดยืนยัน: เข้าไปเท่าไร ต้นทุนเท่าไร ตอนนี้เหลือเท่าไร
 * ยอดคงเหลือ/ต้นทุนล่าสุดมาจาก backend หลังบันทึกจริง ไม่ได้คำนวณเดาที่หน้าจอ
 */
export default function ReceivingSuccessCard({
  result, onReceiveMore, onViewHistory, onDismiss,
}: {
  result: StockReceivingResult;
  onReceiveMore?: () => void;
  onViewHistory?: () => void;
  onDismiss: () => void;
}) {
  const stock = result.stock;
  return (
    <section className="rb-callout sr-success" role="status">
      <CheckCircle2 aria-hidden />
      <div>
        <strong>รับวัตถุดิบเข้าสต็อกสำเร็จ · {result.receiptNo}</strong>
        <dl className="sr-success-grid">
          <div><dt>{result.itemName}</dt><dd className="num">+{result.quantity} {result.unitCode}</dd></div>
          <div><dt>ต้นทุนรับเข้า</dt><dd className="num">{result.unitPrice} บาท/{result.unitCode}</dd></div>
          <div><dt>มูลค่ารับเข้า</dt><dd className="num">{result.totalValue} บาท</dd></div>
          <div><dt>ประเภท</dt><dd>{RECEIVE_REASON_LABEL[result.reason]}</dd></div>
          {stock ? <>
            <div><dt>สต็อกคงเหลือ</dt><dd className="num">{formatMoney(stock.onHand, 4)} {stock.baseUnitCode}</dd></div>
            <div><dt>ต้นทุนล่าสุด</dt><dd className="num">{formatMoney(stock.lastCost, 4)} บาท/{stock.baseUnitCode}</dd></div>
          </> : (
            /* ผู้ใช้รับของได้แต่ไม่มีสิทธิ์ดูสต็อก — บอกตามจริง ไม่แสดงตัวเลขที่เดาเอง */
            <div><dt>สต็อกคงเหลือ</dt><dd>ต้องมีสิทธิ์ดูสต็อกจึงจะเห็นยอดคงเหลือ</dd></div>
          )}
        </dl>
        {result.remark && <p className="sr-success-remark">หมายเหตุ: {result.remark}</p>}
        <div className="sr-success-actions">
          {onReceiveMore && <button type="button" className="btn" onClick={onReceiveMore}><PackagePlus aria-hidden width={16} />รับเพิ่ม</button>}
          {onViewHistory && <button type="button" className="btn" onClick={onViewHistory}><History aria-hidden width={16} />ดูประวัติรับเข้า</button>}
          <Link className="btn" to="/inventory"><Boxes aria-hidden width={16} />ดูสต็อก</Link>
          <button type="button" className="btn" onClick={onDismiss}>ปิด</button>
        </div>
      </div>
    </section>
  );
}
