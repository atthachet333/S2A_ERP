import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, PackageCheck, PackageX, ShieldAlert } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '@/lib/api-client';
import { ContentCard, FilterBar, KPICard, KPIGrid, PageContainer, PageHeader } from '@/components/layout/page';
import { GuidanceCard, HelpTip } from '@/components/GuidanceCard';
import { displayEnum, money as displayMoney } from '@/lib/presentation';
import Badge from '@/components/ui/Badge';
import { movementInfo } from '@/lib/operations-vocab';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';

const LOT_STATUSES = ['GOOD', 'EXPIRING_SOON', 'EXPIRED', 'NO_EXPIRY'] as const;
type LotStatus = typeof LOT_STATUSES[number];
interface LotRow { lotId:string; lotNo:string; itemCode:string; itemName:string; warehouseId:string; warehouseName:string; onHand:number; reserved:number; available:number; unit:string; manufactureDate:string|null; expiryDate:string|null; daysRemaining:number|null; status:LotStatus; estimatedValue:number|null; costStatus:string; sourceType:string }
interface LotData { thresholdDays:number; basis:string; rows:LotRow[]; kpi:{ activeLots:number; expiringSoon:number; expiredLots:number; knownValueAtRisk:number; unknownValueAtRisk:number } }
const date = (value:string|null) => value ? new Intl.DateTimeFormat('th-TH', { dateStyle:'medium', timeZone:'Asia/Bangkok' }).format(new Date(value)) : '—';
const qty = (value:number) => value.toLocaleString('th-TH', { maximumFractionDigits:4 });
const money = (value:number|null) => displayMoney(value);


/** ป้ายสถานะวันหมดอายุของล็อต — ป้ายและโทนมาจาก presentation.ts ตัวเดียวกับทั้งระบบ
 *  ไม่ยืมคลาสของสถานะต้นทุนมาใช้อีก เพราะทำให้ "ใกล้หมดอายุ" กับ "หมดอายุแล้ว" สีเดียวกัน */
function LotStatusBadge({ status }: { status: LotStatus }) {
  const display = displayEnum(status);
  return <Badge variant={display.tone ?? 'muted'} dot>{display.label}</Badge>;
}

export default function InventoryLotsPage(){
  const [data,setData]=useState<LotData>(); const [error,setError]=useState(''); const [status,setStatus]=useState(''); const [warehouseId,setWarehouseId]=useState(''); const [keyword,setKeyword]=useState('');
  const query=useMemo(()=>{const q=new URLSearchParams();if(status)q.set('status',status);if(warehouseId)q.set('warehouseId',warehouseId);if(keyword.trim())q.set('keyword',keyword.trim());return q.toString()},[status,warehouseId,keyword]);
  useEffect(()=>{apiClient.get<LotData>(`/business/inventory/lots${query?`?${query}`:''}`).then(setData).catch((e:Error)=>setError(e.message))},[query]);
  const warehouses=[...new Map((data?.rows??[]).map(row=>[row.warehouseId,row.warehouseName])).entries()];
  return <PageContainer size="wide" className="analytics-page lot-inventory-page">
    <PageHeader breadcrumb="คลังสินค้า" title="ล็อตและวันหมดอายุ" description={`LOT & EXPIRY · ใช้ล็อตที่หมดอายุก่อน / FEFO · เกณฑ์ใกล้หมดอายุ ${data?.thresholdDays??7} วัน`} actions={<button className="btn" onClick={()=>void apiClient.download(`/business/inventory/lots/export.xlsx${query?`?${query}`:''}`,{expect:'xlsx',fallbackName:'lot-expiry-inventory.xlsx'})}><Download/>ส่งออก Excel</button>}/>
    <GuidanceCard><p>ใช้หน้านี้ตรวจสอบล็อตคงเหลือและวันหมดอายุ ระบบช่วยเรียงล็อตที่ควรใช้ก่อนตาม FEFO <HelpTip label="FEFO">เลือกใช้ล็อตที่หมดอายุก่อนเป็นอันดับแรก</HelpTip></p></GuidanceCard>
    {error&&<div className="alert error">{error}</div>}
    <KPIGrid columns={4}><KPICard label="ล็อตที่ใช้งาน / Active Lots" value={data?.kpi.activeLots??0} icon={<PackageCheck/>}/><KPICard label="ใกล้หมดอายุ / Expiring Soon" value={data?.kpi.expiringSoon??0} icon={<AlertTriangle/>}/><KPICard label="หมดอายุแล้ว / Expired" value={data?.kpi.expiredLots??0} icon={<PackageX/>}/><KPICard label="มูลค่าเสี่ยง / Value at Risk" value={money(data?.kpi.knownValueAtRisk??0)} hint={data?.kpi.unknownValueAtRisk?`${data.kpi.unknownValueAtRisk} ล็อตยังไม่มีข้อมูลต้นทุน`:data?.basis} icon={<ShieldAlert/>}/></KPIGrid>
    <FilterBar><input aria-label="ค้นหาสินค้า" placeholder="ค้นหารหัสหรือชื่อสินค้า" value={keyword} onChange={e=>setKeyword(e.target.value)}/><select aria-label="คลัง" value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}><option value="">ทุกคลัง</option>{warehouses.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select><select aria-label="สถานะ Lot" value={status} onChange={e=>setStatus(e.target.value)}><option value="">ทุกสถานะ</option>{LOT_STATUSES.map(value=><option key={value} value={value}>{displayEnum(value).label}</option>)}</select></FilterBar>
    <ContentCard padded={false}><div className="table-wrap"><table className="data-table"><thead><tr><th>สินค้า / Lot</th><th>คลัง</th><th>คงเหลือ / ใช้ได้</th><th>วันผลิต / หมดอายุ</th><th>สถานะ</th><th>มูลค่าโดยประมาณ</th><th>ที่มา</th></tr></thead>{!data&&!error&&<SkeletonRows rows={6} cols={7}/>}<tbody>{data?.rows.map(row=><tr key={`${row.lotId}-${row.warehouseId}`}><td><Link className="inline-link" to={`/inventory/lots/${row.lotId}`}><b>{row.itemName}</b></Link><small className="cell-sub">{row.itemCode} · Lot {row.lotNo}</small></td><td>{row.warehouseName}</td><td>{qty(row.onHand)} / {qty(row.available)} {row.unit}<small className="cell-sub">จอง {qty(row.reserved)}</small></td><td>{date(row.manufactureDate)} / {date(row.expiryDate)}<small className="cell-sub">{row.daysRemaining==null?'ไม่กำหนดอายุ':`${row.daysRemaining} วัน`}</small></td><td><LotStatusBadge status={row.status}/></td><td className={row.estimatedValue==null?'unknown-cost':''}>{money(row.estimatedValue)}</td><td>{row.sourceType}</td></tr>)}</tbody></table></div>{data?.rows.length===0&&<EmptyState icon={PackageX} title="ยังไม่มีล็อตตามตัวกรองนี้" description="ลองล้างตัวกรอง หรือรับสินค้าเข้าคลังพร้อมระบุล็อตและวันหมดอายุ"/>}</ContentCard>
  </PageContainer>
}

interface LotDetail { id:string;lotNo:string;manufactureDate:string|null;receivedDate:string;expiryDate:string|null;status:LotStatus;daysRemaining:number|null;item:{code:string;name:string;baseUnit:{code:string}};sourceReceipt?:{id:string;receiptNo:string}|null;sourceProduction?:{id:string;orderNo:string}|null;balances:{id:string;onHand:number;reserved:number;available:number;warehouse:{code:string;name:string}}[];stockLedgers:{id:string;movementType:string;refType:string;refNo?:string|null;qtyIn:string;qtyOut:string;balanceAfter:string;createdAt:string;warehouse:{code:string;name:string}}[] }
export function InventoryLotDetailPage(){const{id=''}=useParams();const[data,setData]=useState<LotDetail>();const[error,setError]=useState('');useEffect(()=>{apiClient.get<LotDetail>(`/business/inventory/lots/${id}`).then(setData).catch((e:Error)=>setError(e.message))},[id]);return <PageContainer size="wide"><PageHeader breadcrumb={<><Link to="/inventory/lots">Lot และวันหมดอายุ</Link><span> · รายละเอียด</span></>} title={data?`${data.item.name} · Lot ${data.lotNo}`:'รายละเอียด Lot'} description="Traceability ตั้งแต่ต้นทางถึงการเคลื่อนไหวล่าสุด" actions={<Link className="btn" to="/inventory/lots">กลับรายการ Lot</Link>}/>{error&&<div className="alert error">{error}</div>}{data&&<><KPIGrid columns={4}><KPICard label="สถานะ" value={data.status}/><KPICard label="วันรับ" value={date(data.receivedDate)}/><KPICard label="วันหมดอายุ" value={date(data.expiryDate)}/><KPICard label="เหลือ" value={data.daysRemaining==null?'ไม่กำหนด':`${data.daysRemaining} วัน`}/></KPIGrid><ContentCard title="ข้อมูล Lot"><div className="ops-field-grid"><p><b>สินค้า</b><br/>{data.item.code} · {data.item.name}</p><p><b>วันผลิต</b><br/>{date(data.manufactureDate)}</p><p><b>ต้นทาง</b><br/>{data.sourceReceipt?.receiptNo??data.sourceProduction?.orderNo??'ADJUSTMENT'}</p></div></ContentCard><ContentCard title="ยอดปัจจุบันตามคลัง" padded={false}><div className="table-wrap"><table className="data-table"><thead><tr><th>คลัง</th><th>คงเหลือ</th><th>จอง</th><th>พร้อมใช้</th></tr></thead><tbody>{data.balances.map(row=><tr key={row.id}><td>{row.warehouse.code} · {row.warehouse.name}</td><td>{qty(row.onHand)}</td><td>{qty(row.reserved)}</td><td>{qty(row.available)} {data.item.baseUnit.code}</td></tr>)}</tbody></table></div></ContentCard><ContentCard title="Traceability Timeline" padded={false}><div className="table-wrap"><table className="data-table"><thead><tr><th>เวลา</th><th>Movement</th><th>เอกสาร</th><th>คลัง</th><th>เข้า / ออก</th><th>คงเหลือหลังรายการ</th></tr></thead><tbody>{data.stockLedgers.map(row=><tr key={row.id}><td>{new Date(row.createdAt).toLocaleString('th-TH')}</td><td>{movementInfo(row.movementType).label}</td><td>{row.refNo??row.refType}</td><td>{row.warehouse.name}</td><td>{qty(Number(row.qtyIn))} / {qty(Number(row.qtyOut))}</td><td>{qty(Number(row.balanceAfter))}</td></tr>)}</tbody></table></div></ContentCard></>}</PageContainer>}
