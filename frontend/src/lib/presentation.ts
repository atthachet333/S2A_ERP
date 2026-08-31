export type DisplayValue = { label: string; tone?: 'success'|'warning'|'danger'|'muted'|'info' };

const THAI_UNITS: Record<string,string> = {
  KG:'กิโลกรัม', G:'กรัม', L:'ลิตร', ML:'มิลลิลิตร', PCS:'ชิ้น',
  BOWL:'ชาม', BOX:'กล่อง', BAG:'ถุง', PACK:'แพ็ก', BOTTLE:'ขวด',
};

export function displayUnit(unit?: {code?:string|null;name?:string|null}|string|null): string {
  const code=(typeof unit==='string'?unit:unit?.code)?.trim();
  const configured=typeof unit==='string'?undefined:unit?.name?.trim();
  if(!code)return configured||'ยังไม่ได้ระบุหน่วย';
  const thai=THAI_UNITS[code.toUpperCase()]||configured;
  return thai&&thai.toUpperCase()!==code.toUpperCase()?`${thai} / ${code}`:code;
}

const ENUMS: Record<string,DisplayValue> = {
  ACTUAL:{label:'ผลผลิตตามหน่วยจริง / Actual Yield',tone:'info'},
  BATCH:{label:'ผลผลิตแบบต่อชุด / Batch Yield',tone:'info'},
  PRICED:{label:'มีข้อมูลต้นทุน / Cost Available',tone:'success'},
  ZERO:{label:'ต้นทุนศูนย์ที่ยืนยันแล้ว / Confirmed Zero Cost',tone:'info'},
  MISSING:{label:'ยังไม่มีข้อมูลต้นทุน / Cost Required',tone:'warning'},
  UNKNOWN:{label:'ยังไม่มีข้อมูล / Unknown',tone:'muted'},
  DRAFT:{label:'แบบร่าง / Draft',tone:'muted'}, CONFIRMED:{label:'ยืนยันแล้ว / Confirmed',tone:'success'},
  COMPLETED:{label:'ผลิตเสร็จแล้ว / Completed',tone:'success'}, CANCELLED:{label:'ยกเลิกแล้ว / Cancelled',tone:'danger'},
  PARTIALLY_RECEIVED:{label:'รับของบางส่วน / Partially Received',tone:'warning'},
  RECEIVED:{label:'รับครบแล้ว / Fully Received',tone:'success'}, READY:{label:'พร้อมดำเนินการ / Ready',tone:'success'},
  EXPIRED:{label:'หมดอายุแล้ว / Expired',tone:'danger'}, EXPIRING_SOON:{label:'ใกล้หมดอายุ / Expiring Soon',tone:'warning'},
  GOOD:{label:'ปกติ / Good',tone:'success'}, NO_EXPIRY:{label:'ไม่กำหนดอายุ / No Expiry',tone:'muted'},
  ACTIVE:{label:'ใช้งาน / Active',tone:'success'}, INACTIVE:{label:'ไม่ได้ใช้งาน / Inactive',tone:'muted'},
};
export function displayEnum(value?:string|null): DisplayValue {
  if(!value)return ENUMS.UNKNOWN;
  return ENUMS[value]??{label:value.replaceAll('_',' '),tone:'muted'};
}
export const displayBoolean=(value:boolean,yes='เปิดใช้งาน / Enabled',no='ไม่ได้เปิดใช้ / Disabled'):DisplayValue=>
  ({label:value?yes:no,tone:value?'success':'muted'});
export const displayPriceType=(value:string)=>({RETAIL:'ราคาปลีก / Retail',WHOLESALE:'ราคาส่ง / Wholesale',AGENT:'ราคาตัวแทน / Agent',SPECIAL:'ราคาพิเศษ / Special'}[value]??value);
export const money=(value:number|null|undefined,decimals=2)=>value==null?'ยังไม่มีข้อมูลต้นทุน':`฿${value.toLocaleString('th-TH',{minimumFractionDigits:decimals,maximumFractionDigits:Math.max(decimals,4)})}`;
/**
 * แสดงปริมาณ/จำนวนให้คนอ่านออก — เป็นการ "จัดรูปแบบ" เท่านั้น ไม่แตะค่าที่คำนวณหรือเก็บไว้
 *
 * ปัญหาที่แก้: เลขทศนิยมลอยตัวรั่วออกหน้าจอ เช่น 0.35000000000000003
 * ซึ่งเกิดจากการเอาค่า number ไปวางตรง ๆ ใน JSX โดยไม่ผ่านตัวจัดรูปแบบ
 *
 *   0.35000000000000003 -> 0.35
 *   1.0000000000000000  -> 1
 *   1.5000000000000000  -> 1.5
 *
 * กติกา: ตัด noise ทิ้ง ตัดศูนย์ท้ายออก แต่ไม่บังคับให้เหลือ 2 ตำแหน่งเสมอ
 * ค่าที่เล็กมากจนปัดที่ 4 ตำแหน่งแล้วกลายเป็น 0 จะเพิ่มความละเอียดให้เท่าที่จำเป็น
 * เพื่อไม่ให้ "มีของอยู่นิดเดียว" กลายเป็น "ไม่มีของ"
 *
 * ห้ามใช้กับจำนวนเงิน — เงินใช้ money() ซึ่งมีกติกาทศนิยมของตัวเอง
 */
export function quantity(value:number|null|undefined, maxDecimals=4): string {
  if(value==null||!Number.isFinite(value))return '—';
  if(value===0)return '0';
  let decimals=maxDecimals;
  const magnitude=Math.abs(value);
  if(magnitude<1){
    const needed=Math.ceil(-Math.log10(magnitude))+2;
    decimals=Math.min(Math.max(maxDecimals,needed),8);
  }
  // toFixed ก่อนเพื่อล้าง noise ของ floating point แล้วค่อยให้ toLocaleString ตัดศูนย์ท้าย
  const cleaned=Number(value.toFixed(decimals));
  return cleaned.toLocaleString('th-TH',{maximumFractionDigits:decimals});
}
