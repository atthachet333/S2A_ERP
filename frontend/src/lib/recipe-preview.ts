import type { Item, RecipeDraftCost, RecipeOverhead, RecipeVersionInput, SelectableSubRecipe, Unit, UnitConversion } from './catalog';

const n=(value:number|null|undefined)=>Number.isFinite(value)?Number(value):0;
export const money=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

// ---------- number formatting (PART 19) ----------
/** เงิน: ทศนิยม 2 ตำแหน่ง + คั่นหลักพัน (฿62,633.00) */
export const fmtMoney=(value:number)=>money(n(value)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
/** ต้นทุนต่อหน่วย (กรัม/มล.): สูงสุด 4 ตำแหน่ง */
export const fmtCost=(value:number)=>n(value).toLocaleString('en-US',{maximumFractionDigits:4});
/** ปริมาณ: สูงสุด 4 ตำแหน่ง + คั่นหลักพัน */
export const fmtQty=(value:number)=>n(value).toLocaleString('en-US',{maximumFractionDigits:4});
/** เปอร์เซ็นต์: สูงสุด 2 ตำแหน่ง */
export const fmtPercent=(value:number)=>(Number.isFinite(value)?n(value):0).toLocaleString('en-US',{maximumFractionDigits:2});

// ---------- unit conversion (PART 2 / 10) — อ้างอิงตาราง UnitConversion เท่านั้น ----------
type ConvLike={fromUnitId:string;toUnitId:string;factor:number};
/**
 * ตัวคูณ m ที่ทำให้ qty(to) = qty(from) × m — BFS บนกราฟการแปลงหน่วย (สองทิศ)
 * คืน null เมื่อไม่มีเส้นทางแปลง (ไม่เดา ไม่ข้ามมิติ)  · schema: 1 fromUnit = factor toUnit
 */
export function unitFactor(fromId:string|null|undefined,toId:string|null|undefined,conversions:ConvLike[]):number|null{
  if(!fromId||!toId)return null;
  if(fromId===toId)return 1;
  const adj=new Map<string,{to:string;f:number}[]>();
  const push=(a:string,b:string,f:number)=>{const l=adj.get(a)??[];l.push({to:b,f});adj.set(a,l);};
  for(const c of conversions){const f=n(c.factor);if(f>0){push(c.fromUnitId,c.toUnitId,f);push(c.toUnitId,c.fromUnitId,1/f);}}
  const seen=new Set([fromId]);const queue:[string,number][]=[[fromId,1]];
  while(queue.length){const [u,acc]=queue.shift()!;if(u===toId)return acc;for(const e of adj.get(u)??[]){if(!seen.has(e.to)){seen.add(e.to);queue.push([e.to,acc*e.f]);}}}
  return null;
}
/** เซ็ตหน่วยที่ “แปลงเข้ากันได้” กับหน่วยเป้าหมาย (รวมตัวเป้าหมายเอง) — ใช้กรอง dropdown หน่วยสูตรย่อย */
export function compatibleUnitIds(targetId:string|null|undefined,conversions:ConvLike[]):Set<string>{
  const set=new Set<string>();if(!targetId)return set;set.add(targetId);
  for(const c of conversions){if(unitFactor(c.fromUnitId,targetId,conversions)!=null)set.add(c.fromUnitId);if(unitFactor(c.toUnitId,targetId,conversions)!=null)set.add(c.toUnitId);}
  return set;
}
export const normalizeUnitText=(value:string|null|undefined)=>value?.trim().toLocaleLowerCase()??'';
export function findExistingUnit(units:Unit[],code:string,name:string):Unit|undefined{
  const normalizedCode=normalizeUnitText(code);const normalizedName=normalizeUnitText(name);
  return units.find(unit=>(normalizedCode!==''&&normalizeUnitText(unit.code)===normalizedCode)||(normalizedName!==''&&normalizeUnitText(unit.name)===normalizedName));
}
/** แปลงปริมาณที่ผู้ใช้กรอก (display unit) → หน่วยผลผลิตของสูตรย่อย (canonical) เพื่อคิดต้นทุน · null = หน่วยเข้ากันไม่ได้ */
/**
 * โหมดผลผลิตที่ใช้งานจริง — สะท้อน backend/src/lib/unit-convert.ts
 * สูตรเก่าที่มีผลผลิตจริงครบ (qty > 0 + มีหน่วย) ถือเป็น ACTUAL แม้ yieldMode ใน DB ยังเป็น null
 */
export function effectiveYieldMode(child:{yieldMode?:'ACTUAL'|'BATCH'|null;yieldUnitId:string|null;yieldQty:number}|undefined):'ACTUAL'|'BATCH'|null{
  if(!child)return null;
  if(child.yieldMode==='BATCH'||child.yieldMode==='ACTUAL')return child.yieldMode;
  if(child.yieldUnitId&&n(child.yieldQty)>0)return 'ACTUAL';
  return null;
}

export function subRecipeCanonicalQty(displayQty:number,unitId:string|null|undefined,child:SelectableSubRecipe|undefined,conversions:ConvLike[]):number|null{
  if(!child)return null;
  const mode=effectiveYieldMode(child);
  if(mode===null)return null; // ยังไม่ได้กำหนดวิธีคิดผลผลิต — ไม่เดา
  const yieldUnitId=child.yieldUnitId;
  // BATCH: ปริมาณคือจำนวน Batch (0.5 = ครึ่งสูตร) และห้ามแปลงเป็นหน่วยอื่น — ตรงกับ backend/lib/unit-convert.ts
  if(mode==='BATCH')return unitId?null:n(displayQty);
  // ยังไม่เลือกโหมด และไม่มีหน่วยผลผลิต → ไม่เดา (กันเคส 800 "unit" × ต้นทุนทั้งหม้อ)
  if(!yieldUnitId)return null;
  // ไม่ระบุหน่วย = ปริมาณถูกเก็บเป็นหน่วยผลผลิตอยู่แล้ว (สูตรเก่า)
  if(!unitId||unitId===yieldUnitId)return n(displayQty);
  const f=unitFactor(unitId,yieldUnitId,conversions);
  return f==null?null:n(displayQty)*f;
}
export type { UnitConversion };

export function normalizeRecipeVersion(input:Partial<RecipeVersionInput> & Record<string,unknown>):RecipeVersionInput {
  const legacy=input as Record<string,unknown>;
  const legacyDetails=[['ค่าแรง',legacy.laborCost],['ค่าน้ำ',legacy.waterCost],['ค่าไฟ',legacy.electricCost],['ค่าแก๊ส',legacy.gasCost],['อื่น ๆ',legacy.otherCost]]
    .map(([label,amount])=>({label:String(label),amount:n(amount as number)})).filter(x=>x.amount>0);
  const legacyOverhead=n(legacy.overheadCost as number);
  const overhead=input.overhead ?? ((legacyDetails.length||legacyOverhead)?{mode:'DETAILED',details:[...legacyDetails,...(legacyOverhead?[{label:'Overhead',amount:legacyOverhead}]:[])]}:null);
  const oldIngredients=Array.isArray(legacy.ingredients)?legacy.ingredients as Record<string,unknown>[]:[];
  // yieldMode ต้องส่งต่อเสมอ ไม่งั้นการโหลดสูตรจะ "เดา" รูปแบบผลผลิตเอง
  return { standardYieldQty:n(input.standardYieldQty),yieldMode:input.yieldMode??null,yieldUnitId:input.yieldUnitId??null,yieldPercent:n(input.yieldPercent)||100,standardWaste:n(input.standardWaste),portionQty:input.portionQty??null,portionUnit:input.portionUnit??null,overhead,note:input.note??null,
    components:input.components ?? oldIngredients.map(x=>({componentType:'ITEM',itemId:String(x.itemId),childRecipeId:null,quantity:n((x.quantityBase??x.quantity) as number),unitId:(x.unitId as string|null)??null,wastePercent:n(x.wastePercent as number),note:(x.note as string|null)??null})) };
}

/**
 * ปริมาณในหน่วยฐานของวัตถุดิบ — สะท้อน backend/src/lib/unit-convert.ts ตรง ๆ
 * item-specific (purchaseToBaseFactor) ชนะ universal เสมอ · แปลงไม่ได้ = null (ห้ามเดา)
 */
export function itemBaseQty(item:Item|undefined,quantity:number,unitId:string|null|undefined,conversions:ConvLike[]):number|null{
  if(!item)return null;
  const qty=n(quantity);
  if(!unitId||unitId===item.baseUnitId)return qty;
  const factor=n(item.purchaseToBaseFactor)>0?n(item.purchaseToBaseFactor):1;
  if(item.purchaseUnitId&&unitId===item.purchaseUnitId)return qty*factor;
  const direct=unitFactor(unitId,item.baseUnitId,conversions);
  if(direct!=null)return qty*direct;
  if(item.purchaseUnitId){const via=unitFactor(unitId,item.purchaseUnitId,conversions);if(via!=null)return qty*via*factor;}
  return null;
}

/** หน่วยเริ่มต้นของแถววัตถุดิบ — ใช้หน่วยที่ item ใช้จริง (base) ก่อน แล้วค่อย purchase */
export function defaultUnitForItem(item:Item|undefined):string|null{
  if(!item)return null;
  return item.baseUnitId||item.purchaseUnitId||null;
}

/**
 * หน่วยที่เลือกได้ของวัตถุดิบหนึ่งรายการ (เรียงลำดับ: หน่วยฐาน → หน่วยซื้อ → หน่วยที่แปลงถึงฐานได้จริง)
 * ไม่แสดงหน่วยที่ไม่เกี่ยวข้อง เช่น BAG กับไข่ที่ไม่มี 1 BAG = X EGG
 */
export function allowedUnitsForItem(item:Item|undefined,units:Unit[],conversions:ConvLike[]):Unit[]{
  if(!item)return [];
  const out:Unit[]=[];const seen=new Set<string>();
  const push=(id:string|null|undefined)=>{if(!id||seen.has(id))return;const u=units.find(x=>x.id===id);if(u){seen.add(id);out.push(u);}};
  push(item.baseUnitId);                                    // identity: 1 EGG = 1 EGG (ไม่ต้องมีแถว conversion)
  if(item.purchaseToBaseFactor>0)push(item.purchaseUnitId);  // item-specific factor
  for(const u of units){if(!seen.has(u.id)&&itemBaseQty(item,1,u.id,conversions)!=null)push(u.id);}
  return out;
}

/** หน่วยนี้ใช้กับวัตถุดิบนี้ได้จริงหรือไม่ (ใช้ตรวจ row ที่โหลดมาแล้วหน่วยค้างจาก item เดิม) */
export function isUnitUsableForItem(item:Item|undefined,unitId:string|null|undefined,conversions:ConvLike[]):boolean{
  if(!item||!unitId)return false;
  return unitId===item.baseUnitId||itemBaseQty(item,1,unitId,conversions)!=null;
}

/** จำนวนที่ได้ = ผลผลิต ÷ ขนาดต่อหน่วย (หน่วยเดียวกัน) · null เมื่อข้อมูลไม่พอ */
export function portionCountOf(yieldQty:number,portionQty:number|null|undefined):number|null{
  const y=n(yieldQty),p=n(portionQty);
  if(y<=0||p<=0)return null;
  return y/p;
}

/**
 * เตือนเมื่อปริมาณ "น้อยผิดปกติ" เมื่อเทียบกับหน่วยที่เลือก — กันเคสคีย์ 0.30 G แทน 0.30 KG
 * คืนหน่วยที่น่าจะหมายถึง (หน่วยใหญ่กว่า) เพื่อ "ถาม" ผู้ใช้ · ไม่แก้ค่าให้เอง
 */
export function suspiciousQuantity(item:Item|undefined,quantity:number,unitId:string|null|undefined,conversions:ConvLike[]):{suggestUnitId:string;suggestCode:string}|null{
  if(!item||!unitId)return null;
  const qty=n(quantity);
  if(qty<=0||qty>=1)return null; // เฉพาะค่าที่น้อยกว่า 1 หน่วย
  // หาหน่วยที่ใหญ่กว่าหน่วยที่เลือก (1 หน่วยนั้น = >1 หน่วยที่เลือก) เช่น KG เทียบ G
  const bigger=conversions
    .map(c=>({id:c.fromUnitId,f:unitFactor(c.fromUnitId,unitId,conversions)}))
    .filter((x):x is{id:string;f:number}=>x.f!=null&&x.f>1&&x.id!==unitId);
  if(!bigger.length)return null;
  const best=bigger.sort((a,b)=>a.f-b.f)[0];
  return {suggestUnitId:best.id,suggestCode:best.id};
}

/** จำนวนบรรจุภัณฑ์ที่ควรใช้เมื่อผูกกับจำนวนที่ได้ (1 ใบ/หน่วยขาย) */
export function packagingQtyForPortions(portionCount:number|null|undefined,perPortion=1):number|null{
  const c=n(portionCount);
  if(c<=0)return null;
  return c*(n(perPortion)||1);
}

/**
 * ราคาต่อ 1 หน่วยที่ระบุ — แปลงจากต้นทุนต่อหน่วยฐาน (lastCost) ด้วยอัตราแปลงของ item/มาตรฐาน
 * เช่น lastCost 0.047/ML → ราคาต่อ 1 L = 47.00 · null = ยังแปลงหน่วยนี้ไม่ได้ (ห้ามเดา)
 */
export function pricePerUnit(item:Item|undefined,unitId:string|null|undefined,conversions:ConvLike[]):number|null{
  if(!item)return null;
  const qty=itemBaseQty(item,1,unitId??item.baseUnitId,conversions);
  return qty==null?null:qty*n(item.lastCost);
}

/**
 * ตรวจว่าต้นทุนต่อหน่วยฐานดู "สูงผิดปกติเท่ากับราคาต่อหน่วยซื้อ" หรือไม่
 * เช่น หน่วยฐาน ML, หน่วยซื้อ L, 1 L = 1000 ML แต่ lastCost = 47 (ควรเป็น 0.047)
 * ใช้เตือนเท่านั้น — ไม่แก้ราคาให้เอง เพราะราคาจริงต้องมาจากการบันทึกราคาซื้อ
 */
export function priceLooksPerPurchaseUnit(item:Item|undefined):{factor:number}|null{
  if(!item||!item.purchaseUnitId||item.purchaseUnitId===item.baseUnitId)return null;
  const factor=n(item.purchaseToBaseFactor);
  if(factor<=1||n(item.lastCost)<=0)return null;
  // ต้นทุนต่อหน่วยฐานควรน้อยกว่าราคาต่อหน่วยซื้อประมาณ factor เท่า — ถ้าไม่ต่างเลย แปลว่ายังไม่ได้หาร
  return {factor};
}

export function componentCost(component:RecipeVersionInput['components'][number],items:Map<string,Item>,children:Map<string,SelectableSubRecipe>,conversions:ConvLike[]=[]):number {
  const waste=1+n(component.wastePercent)/100;
  if(component.componentType==='SUB_RECIPE'){
    const child=children.get(component.childRecipeId??'');
    const qty=subRecipeCanonicalQty(component.quantity,component.unitId,child,conversions);
    return qty==null?0:n(child?.unitCost)*qty*waste;
  }
  const item=items.get(component.itemId??'');
  const base=itemBaseQty(item,component.quantity,component.unitId,conversions);
  return item&&base!=null?n(item.lastCost)*base*waste:0;
}

export function overheadAmount(overhead:RecipeOverhead|null|undefined,ingredient:number,subRecipe:number,packaging:number):number {
  if(!overhead)return 0;
  if(overhead.mode==='TOTAL')return n(overhead.total);
  if(overhead.mode==='DETAILED')return (overhead.details??[]).reduce((sum,row)=>sum+n(row.amount),0);
  const direct=ingredient+subRecipe+packaging;
  const base=overhead.base==='INGREDIENT'?ingredient:direct; // TOTAL is intentionally the current direct subtotal; overhead never compounds itself.
  return base*n(overhead.percent)/100;
}

export function computeRecipeV2Preview(version:RecipeVersionInput,items:Map<string,Item>,children:Map<string,SelectableSubRecipe>,conversions:ConvLike[]=[]):RecipeDraftCost {
  let ingredientCost=0,packagingCost=0,subRecipeCost=0;
  for(const c of version.components){const cost=componentCost(c,items,children,conversions);if(c.componentType==='PACKAGING')packagingCost+=cost;else if(c.componentType==='SUB_RECIPE')subRecipeCost+=cost;else ingredientCost+=cost;}
  const overheadCost=overheadAmount(version.overhead,ingredientCost,subRecipeCost,packagingCost);
  const totalCost=ingredientCost+packagingCost+subRecipeCost+overheadCost;
  const effectiveYield=n(version.standardYieldQty)*n(version.yieldPercent)/100;
  const portionCount=version.portionQty&&version.portionQty>0?effectiveYield/version.portionQty:null;
  return {ingredientCost,packagingCost,subRecipeCost,overheadCost,totalCost,effectiveYield,costPerYieldUnit:effectiveYield>0?totalCost/effectiveYield:0,portionCount,costPerPortion:portionCount&&portionCount>0?totalCost/portionCount:null};
}

export function conversionHelper(item:Item,quantity:number,unitId:string|null|undefined):string|null {
  if(!item.purchaseUnit||!item.baseUnit||item.purchaseToBaseFactor<=0||unitId!==item.purchaseUnitId)return null;
  return `1 ${item.purchaseUnit.code} = ${item.purchaseToBaseFactor} ${item.baseUnit.code} · ${quantity} ${item.purchaseUnit.code} = ${quantity*item.purchaseToBaseFactor} ${item.baseUnit.code}`;
}

/**
 * รายละเอียดการแปลงหน่วยของแถวหนึ่ง สำหรับแสดงให้คนคีย์เข้าใจทันที (PART 11)
 * คืน null เมื่อไม่ต้องแปลง (ใช้หน่วยฐานอยู่แล้ว) · converted=null คือ "ยังไม่มีอัตราแปลง"
 */
export interface RowConversion { equation:string|null; entered:string; converted:string|null; baseQty:number|null }
export function rowConversion(item:Item|undefined,quantity:number,unitId:string|null|undefined,conversions:ConvLike[],unitCodeOf:(id:string|null|undefined)=>string):RowConversion|null{
  if(!item||!unitId||unitId===item.baseUnitId)return null;
  const from=unitCodeOf(unitId),base=item.baseUnit?.code??unitCodeOf(item.baseUnitId);
  const baseQty=itemBaseQty(item,quantity,unitId,conversions);
  const perOne=itemBaseQty(item,1,unitId,conversions);
  return {
    equation:perOne!=null?`1 ${from} = ${fmtQty(perOne)} ${base}`:null,
    entered:`${fmtQty(quantity)} ${from}`,
    converted:baseQty!=null?`${fmtQty(baseQty)} ${base}`:null,
    baseQty,
  };
}

// Compatibility adapter retained for existing callers/tests.
export interface PreviewLine { itemId:string; quantity:number; unit:'base'|'purchase'; wastePercent:number }
export interface PreviewExpenses { laborCost:number; electricCost:number; waterCost:number; gasCost:number; overheadCost:number; otherCost:number }
export function computeRecipePreview(lines:PreviewLine[],items:Map<string,Item>,expenses:PreviewExpenses,yieldQty:number,yieldPercent:number){let material=0,packaging=0;for(const line of lines){const item=items.get(line.itemId);if(!item)continue;const qty=line.quantity*(line.unit==='purchase'?item.purchaseToBaseFactor:1);const cost=qty*item.lastCost*(1+line.wastePercent/100);if(item.type==='PACKAGING')packaging+=cost;else material+=cost;}const utility=expenses.electricCost+expenses.waterCost+expenses.gasCost;const total=material+packaging+expenses.laborCost+utility+expenses.overheadCost+expenses.otherCost;const effective=yieldQty*yieldPercent/100;return {material,packaging,utility,total,unit:effective>0?total/effective:0};}
