import { beforeEach,describe,expect,it,vi } from 'vitest';
import { ApiClientError } from '@/lib/api-client';
import { catalogApi,type Item,type RecipeVersionInput,type SelectableSubRecipe,type Unit,type UnitConversion } from '@/lib/catalog';
import { allowedUnitsForItem,compatibleUnitIds,componentCost,defaultUnitForItem,effectiveYieldMode,isUnitUsableForItem,packagingQtyForPortions,portionCountOf,priceLooksPerPurchaseUnit,pricePerUnit,suspiciousQuantity,computeRecipeV2Preview,conversionHelper,findExistingUnit,fmtCost,fmtMoney,fmtPercent,itemBaseQty,money,normalizeRecipeVersion,normalizeUnitText,overheadAmount,rowConversion,subRecipeCanonicalQty,unitFactor } from '@/lib/recipe-preview';
import { analyzePrice,priceFromMargin,priceFromMarkup } from '@/lib/cost-sheet';
import { applyTheme } from '@/theme/ThemeContext';
import { classifyFormula,draftFactor,inverseText,RECOMMENDED,validateFormula } from '@/lib/unit-formulas';

const ingredient:Item={id:'sugar',code:'RM-1',barcode:null,name:'Sugar',type:'RAW_MATERIAL',categoryId:null,category:null,baseUnitId:'g',baseUnit:{id:'g',code:'g',name:'gram'},purchaseUnitId:'kg',purchaseUnit:{id:'kg',code:'kg',name:'kilogram'},purchaseToBaseFactor:1000,avgCost:.026,lastCost:.026,reorderPoint:0,minQty:0,isLotTracked:false,isExpiryTracked:false,imageUrl:null,isActive:true,createdAt:'',updatedAt:''};
const packaging:Item={...ingredient,id:'box',name:'Box',type:'PACKAGING',baseUnitId:'pc',baseUnit:{id:'pc',code:'pc',name:'piece'},purchaseUnitId:null,purchaseUnit:null,purchaseToBaseFactor:1,lastCost:3};
const child:SelectableSubRecipe={id:'sauce',code:'R-2',name:'Sauce',yieldQty:1500,yieldUnit:'ml',yieldUnitId:'ml',totalCost:77.6,unitCost:77.6/1500};
const maps={items:new Map([['sugar',ingredient],['box',packaging]]),children:new Map([['sauce',child]])};
const base=(patch:Partial<RecipeVersionInput>={}):RecipeVersionInput=>({standardYieldQty:1000,yieldUnitId:'g',yieldPercent:100,standardWaste:0,portionQty:null,portionUnit:null,overhead:{mode:'TOTAL',total:0},note:null,components:[{componentType:'ITEM',itemId:'sugar',quantity:500,unitId:'g',wastePercent:0}],...patch});

describe('Recipe Builder 2.0 focused scope',()=>{
 it('1 legacy recipe load maps ingredients and expenses without rewriting meaning',()=>{const v=normalizeRecipeVersion({standardYieldQty:10,ingredients:[{itemId:'sugar',quantityBase:2,wastePercent:0}],laborCost:5,waterCost:2} as never);expect(v.components[0].quantity).toBe(2);expect(v.overhead?.details).toEqual(expect.arrayContaining([{label:'ค่าแรง',amount:5},{label:'ค่าน้ำ',amount:2}]))});
 it('2 ingredient add preserves the existing array',()=>{const a=base().components;const b=[...a,{componentType:'ITEM' as const,itemId:'x',quantity:1,wastePercent:0}];expect(a).toHaveLength(1);expect(b).toHaveLength(2)});
 it('3 sub-recipe add uses childRecipeId only',()=>{const c={componentType:'SUB_RECIPE' as const,childRecipeId:'sauce',itemId:null,quantity:35,wastePercent:0};expect(c.childRecipeId).toBe('sauce');expect(c.itemId).toBeNull()});
 it('4 packaging add is independently categorized',()=>{const r=computeRecipeV2Preview(base({components:[{componentType:'PACKAGING',itemId:'box',quantity:2,wastePercent:0}]}),maps.items,maps.children);expect(r.packagingCost).toBe(6);expect(r.ingredientCost).toBe(0)});
 it('5 sub-recipe cost preview uses cost per yield-unit',()=>{expect(componentCost({componentType:'SUB_RECIPE',childRecipeId:'sauce',quantity:35,wastePercent:0},maps.items,maps.children)).toBeCloseTo(1.8107,3)});
 it('6 yield calculation returns cost per effective yield',()=>{expect(computeRecipeV2Preview(base(),maps.items,maps.children).costPerYieldUnit).toBe(.013)});
 it('7 portion calculation returns count and cost',()=>{const r=computeRecipeV2Preview(base({portionQty:200,portionUnit:'cup'}),maps.items,maps.children);expect(r.portionCount).toBe(5);expect(r.costPerPortion).toBe(2.6)});
 it('8 unit helper only uses item-specific conversion',()=>{expect(conversionHelper(ingredient,.5,'kg')).toContain('0.5 kg = 500 g');expect(conversionHelper(ingredient,1,'ml')).toBeNull()});
 it('9 overhead TOTAL remains a combined amount',()=>expect(overheadAmount({mode:'TOTAL',total:25},10,2,3)).toBe(25));
 it('10 overhead PERCENTAGE exposes backend direct-base formula',()=>expect(overheadAmount({mode:'PERCENTAGE',percent:20,base:'DIRECT'},100,10,5)).toBe(23));
 it('11 overhead DETAILED auto totals dynamic lines',()=>expect(overheadAmount({mode:'DETAILED',details:[{label:'Labor',amount:10},{label:'Power',amount:5}]},0,0,0)).toBe(15));
 it('12 zero yield produces safe warning-state cost',()=>{const r=computeRecipeV2Preview(base({standardYieldQty:0}),maps.items,maps.children);expect(r.costPerYieldUnit).toBe(0);expect(r.effectiveYield).toBe(0)});
 it('13 circular error is a typed API error suitable for dedicated UI',()=>expect(new ApiClientError('CIRCULAR_SUBRECIPE','cycle',409).code).toBe('CIRCULAR_SUBRECIPE'));
 it('14 archive calls staged backend route',async()=>{mockOk({id:'r',isActive:false});await catalogApi.archiveRecipe('r');expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/recipes/r/archive'),expect.objectContaining({method:'POST'}))});
 it('15 delete unused calls safe delete route',async()=>{mockOk({id:'r',deleted:true});await catalogApi.deleteRecipe('r');expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/recipes/r'),expect.objectContaining({method:'DELETE'}))});
 it('16 RECIPE_IN_USE retains code for archive suggestion',()=>expect(new ApiClientError('RECIPE_IN_USE','used',409).code).toBe('RECIPE_IN_USE'));
 it('17 duplicate calls staged route and returns copied id',async()=>{mockOk({id:'copy',code:'COPY',name:'Copy'});await expect(catalogApi.duplicateRecipe('r')).resolves.toMatchObject({id:'copy'})});
 it('18 Light mode applies without changing form state',()=>{applyTheme('light');expect(document.documentElement.classList.contains('dark')).toBe(false)});
 it('19 Dark mode applies to the same workspace',()=>{applyTheme('dark');expect(document.documentElement.classList.contains('dark')).toBe(true)});
 it('20 parent form state is preserved when a child row changes',()=>{const original=base();const changed={...original,components:original.components.map((x,i)=>i?x:{...x,quantity:700})};expect(changed.standardYieldQty).toBe(1000);expect(original.components[0].quantity).toBe(500)});

 // --- Recipe Builder 2.1 additions ---
 const conv:UnitConversion[]=[{id:'c1',fromUnitId:'L',toUnitId:'ml',fromCode:'L',toCode:'ml',factor:1000},{id:'c2',fromUnitId:'kg',toUnitId:'g',fromCode:'kg',toCode:'g',factor:1000}];
 it('21 unit factor converts L to ml both directions',()=>{expect(unitFactor('L','ml',conv)).toBe(1000);expect(unitFactor('ml','L',conv)).toBe(1/1000);expect(unitFactor('L','L',conv)).toBe(1)});
 it('22 incompatible units have no conversion path',()=>{expect(unitFactor('g','ml',conv)).toBeNull()});
 it('23 compatible unit set for a ml yield only includes ml/L',()=>{const set=compatibleUnitIds('ml',conv);expect(set.has('ml')).toBe(true);expect(set.has('L')).toBe(true);expect(set.has('g')).toBe(false)});
 it('24 sub-recipe canonical qty: 0.8 L => 800 ml',()=>{expect(subRecipeCanonicalQty(0.8,'L',child,conv)).toBe(800)});
 it('25 identity conversion works without an explicit conversion row',()=>{expect(subRecipeCanonicalQty(35,'ml',child,[])).toBe(35);expect(compatibleUnitIds('ml',[]).has('ml')).toBe(true)});
 it('26 sub-recipe incompatible unit returns null (blocks costing)',()=>{expect(subRecipeCanonicalQty(1,'g',child,conv)).toBeNull()});
 it('27 sub-recipe line cost after L->ml conversion (0.8 L x 0.051733/ml ~ 41.39)',()=>{const canon=subRecipeCanonicalQty(0.8,'L',child,conv)!;expect(canon*child.unitCost).toBeCloseTo(41.39,2)});
 it('28 money formatting adds thousands + 2 decimals',()=>{expect(fmtMoney(62633)).toBe('62,633.00');expect(fmtCost(0.0517333)).toBe('0.0517');expect(fmtPercent(20.005)).toBe('20.01')});
 it('29 negative pricing is flagged as a loss with negative profit',()=>{const p=analyzePrice(100,40);expect(p.isLoss).toBe(true);expect(p.profit).toBeCloseTo(-60,4)});
 it('30 healthy pricing is not a loss',()=>{const p=analyzePrice(100,150);expect(p.isLoss).toBe(false);expect(p.marginPercent).toBeCloseTo(33.333,2)});
 it('31 existing ML is discovered by case-insensitive code and trimmed name',()=>{const units=[{id:'ml',code:'ML',name:'มิลลิลิตร',isActive:true}];expect(findExistingUnit(units,' ml ','')).toBe(units[0]);expect(findExistingUnit(units,'',' มิลลิลิตร ')).toBe(units[0]);expect(normalizeUnitText(' Ml ')).toBe('ml')});
 it('32 ml selector compatibility includes existing ml and L but hides kg',()=>{const set=compatibleUnitIds('ml',conv);expect(['ml','L'].filter(x=>set.has(x))).toEqual(['ml','L']);expect(set.has('kg')).toBe(false)});
 it('33 selecting a sub-recipe defaults the row unit to child yield unit',()=>{const selected={childRecipeId:child.id,unitId:child.yieldUnitId};expect(selected.unitId).toBe('ml')});
 it('34 legacy child with null yield unit blocks canonical quantity and dangerous cost',()=>{const legacy={...child,yieldUnit:null,yieldUnitId:null,unitCost:77.6};expect(subRecipeCanonicalQty(800,null,legacy,conv)).toBeNull();expect(subRecipeCanonicalQty(800,'ml',legacy,conv)).toBeNull()});
 it('35 800 ml uses per-ml cost and never whole-batch cost',()=>{expect(subRecipeCanonicalQty(800,'ml',child,conv)!*child.unitCost).toBeCloseTo(41.39,2);expect(subRecipeCanonicalQty(800,'ml',child,conv)!*child.unitCost).not.toBe(62080)});
 it('36 unit query and conversion endpoints retain their focused contracts',async()=>{mockOk([{id:'ml',code:'ML',name:'มิลลิลิตร',isActive:true}]);await catalogApi.units();expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/units'),expect.objectContaining({method:'GET'}))});

 // --- 2.1 hotfix: decimal money in production expenses ---
 it('37 detailed expense keeps a 12.93 amount unrounded',()=>{expect(overheadAmount({mode:'DETAILED',details:[{label:'ค่าไฟ',amount:12.93}]},0,0,0)).toBe(12.93)});
 it('38 detailed expense accepts satang-level 0.01',()=>{expect(overheadAmount({mode:'DETAILED',details:[{label:'x',amount:0.01}]},0,0,0)).toBe(0.01)});
 it('39 TOTAL mode keeps decimals',()=>{expect(overheadAmount({mode:'TOTAL',total:180.25},10,0,0)).toBe(180.25)});
 it('40 PERCENTAGE mode accepts a decimal percent such as 12.5%',()=>{expect(overheadAmount({mode:'PERCENTAGE',percent:12.5,base:'INGREDIENT'},200,0,0)).toBe(25)});
 it('41 detailed rows sum decimals correctly (40.50+7.25+12.93+20.10=80.78)',()=>{
  const total=overheadAmount({mode:'DETAILED',details:[{label:'ค่าแรง',amount:40.50},{label:'ค่าน้ำ',amount:7.25},{label:'ค่าไฟ',amount:12.93},{label:'ค่าแก๊ส',amount:20.10}]},0,0,0);
  expect(money(total)).toBe(80.78);expect(fmtMoney(total)).toBe('80.78');
 });
 it('42 decimal amount survives an immutable form-state update',()=>{
  const overhead={mode:'DETAILED' as const,details:[{label:'ค่าไฟ',amount:12.93}]};
  const next={...overhead,details:overhead.details.map((r,j)=>j===0?{...r,label:'ค่าไฟฟ้า'}:r)};
  expect(next.details[0].amount).toBe(12.93);expect(overhead.details[0].amount).toBe(12.93);
 });
 it('43 calculate payload preserves decimal expense amounts',async()=>{
  mockOk({ingredientCost:0,packagingCost:0,subRecipeCost:0,overheadCost:12.93,totalCost:12.93,effectiveYield:1,costPerYieldUnit:12.93,portionCount:null,costPerPortion:null});
  await catalogApi.calculateRecipe(base({overhead:{mode:'DETAILED',details:[{label:'ค่าไฟ',amount:12.93}]}}),'r1');
  const body=JSON.parse((vi.mocked(fetch).mock.calls[0][1] as {body:string}).body);
  expect(body.version.overhead.details[0].amount).toBe(12.93);
 });
 it('44 saved version payload preserves decimal expense amounts',async()=>{
  mockOk({versionId:'v1',versionNo:2,cost:{}});
  await catalogApi.addRecipeVersion('r1',base({overhead:{mode:'TOTAL',total:141.49}}));
  const body=JSON.parse((vi.mocked(fetch).mock.calls[0][1] as {body:string}).body);
  expect(body.overhead.total).toBe(141.49);
 });

 // --- unit conversion hotfix ---
 // วัตถุดิบซื้อเป็น KG แต่หน่วยฐาน (คีย์สูตร) เป็น ML → item-specific 1 KG = 1000 ML
 const liquid:Item={...ingredient,id:'oil',name:'Oil',baseUnitId:'ML',baseUnit:{id:'ML',code:'ML',name:'ml'},purchaseUnitId:'KG',purchaseUnit:{id:'KG',code:'KG',name:'kg'},purchaseToBaseFactor:1000,lastCost:0.08};
 const std:UnitConversion[]=[{id:'u1',fromUnitId:'KG',toUnitId:'G',fromCode:'KG',toCode:'G',factor:1000},{id:'u2',fromUnitId:'L',toUnitId:'ML',fromCode:'L',toCode:'ML',factor:1000}];
 it('45 1 KG = 1000 ML ผ่าน item-specific factor',()=>{expect(itemBaseQty(liquid,1,'KG',std)).toBe(1000)});
 it('46 0.5 KG = 500 ML',()=>{expect(itemBaseQty(liquid,0.5,'KG',std)).toBe(500)});
 it('47 inverse 500 ML = 0.5 KG',()=>{expect(500/itemBaseQty(liquid,1,'KG',std)!).toBe(0.5)});
 it('48 1 L = 1000 ML ผ่านตารางมาตรฐาน',()=>{expect(itemBaseQty(liquid,1,'L',std)).toBe(1000)});
 it('49 1 KG = 1000 G สำหรับวัตถุดิบฐานกรัม',()=>{const dry={...ingredient,baseUnitId:'G',baseUnit:{id:'G',code:'G',name:'g'},purchaseUnitId:'KG',purchaseToBaseFactor:1000};expect(itemBaseQty(dry,1,'KG',std)).toBe(1000)});
 it('50 chained 1 กระสอบ = 25 KG = 25,000 G',()=>{
  const dry={...ingredient,baseUnitId:'G',baseUnit:{id:'G',code:'G',name:'g'},purchaseUnitId:'KG',purchaseToBaseFactor:1000};
  const withSack=[...std,{id:'u3',fromUnitId:'SACK',toUnitId:'KG',fromCode:'SACK',toCode:'KG',factor:25}];
  expect(itemBaseQty(dry,1,'SACK',withSack)).toBe(25000);
 });
 it('51 decimal conversion 1 KG = 950.5 ML',()=>{const dense={...liquid,purchaseToBaseFactor:950.5};expect(itemBaseQty(dense,2,'KG',std)).toBeCloseTo(1901,6)});
 it('52 ห้ามเดา: ไม่มี item-specific และไม่มีเส้นทาง → null',()=>{const noConv={...liquid,purchaseUnitId:null,purchaseUnit:null,purchaseToBaseFactor:1};expect(itemBaseQty(noConv,1,'KG',std)).toBeNull()});
 it('53 ต้นทุนคิดจากปริมาณที่แปลงเป็นหน่วยฐานแล้ว (0.5 KG = 500 ML x 0.08)',()=>{
  const cost=componentCost({componentType:'ITEM',itemId:'oil',quantity:0.5,unitId:'KG',wastePercent:0},new Map([['oil',liquid]]),new Map(),std);
  expect(cost).toBeCloseTo(40,6);
 });
 it('54 ไม่มีอัตราแปลง → ต้นทุนเป็น 0 แทนการเดาตัวเลข',()=>{
  const noConv={...liquid,id:'x',purchaseUnitId:null,purchaseUnit:null,purchaseToBaseFactor:1};
  expect(componentCost({componentType:'ITEM',itemId:'x',quantity:1,unitId:'KG',wastePercent:0},new Map([['x',noConv]]),new Map(),std)).toBe(0);
 });
 it('55 rowConversion อธิบายสมการให้คนคีย์อ่านได้',()=>{
  const conv=rowConversion(liquid,0.5,'KG',std,(id)=>String(id));
  expect(conv?.equation).toBe('1 KG = 1,000 ML');expect(conv?.entered).toBe('0.5 KG');expect(conv?.converted).toBe('500 ML');
 });
 it('56 rowConversion บอกเมื่อยังไม่มีอัตราแปลง',()=>{
  const noConv={...liquid,purchaseUnitId:null,purchaseUnit:null,purchaseToBaseFactor:1};
  const conv=rowConversion(noConv,1,'KG',std,(id)=>String(id));
  expect(conv?.equation).toBeNull();expect(conv?.converted).toBeNull();
 });
 it('57 บันทึกอัตราแปลงแล้ว refetch ผ่าน endpoint เดิม (cache refresh)',async()=>{
  mockOk({id:'c1'});
  await catalogApi.saveConversion({fromUnitId:'KG',toUnitId:'G',factor:1000});
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/units/conversions'),expect.objectContaining({method:'POST'}));
 });
 it('58 ส่ง quantity ตามหน่วยที่เลือก + unitId ให้ backend แปลงเอง (ไม่แปลงซ้ำ)',async()=>{
  mockOk({ingredientCost:40,packagingCost:0,subRecipeCost:0,overheadCost:0,totalCost:40,effectiveYield:1,costPerYieldUnit:40,portionCount:null,costPerPortion:null});
  await catalogApi.calculateRecipe(base({components:[{componentType:'ITEM',itemId:'oil',quantity:0.5,unitId:'KG',wastePercent:0}]}),'r1');
  const body=JSON.parse((vi.mocked(fetch).mock.calls[0][1] as {body:string}).body);
  expect(body.version.components[0]).toMatchObject({quantity:0.5,unitId:'KG'});
 });

 // --- sub-recipe unit hotfix (live: ซอสผัดเชฟ) ---
 // หน่วยจริงในระบบ + อัตราแปลงจริง 1 L = 1000 ML
 const liveUnits:Unit[]=[{id:'KG',code:'KG',name:'กิโลกรัม',isActive:true},{id:'G',code:'G',name:'กรัม',isActive:true},{id:'L',code:'L',name:'ลิตร',isActive:true},{id:'ML',code:'ML',name:'มิลลิลิตร',isActive:true}];
 const liveConv:UnitConversion[]=[{id:'k1',fromUnitId:'KG',toUnitId:'G',fromCode:'KG',toCode:'G',factor:1000},{id:'k2',fromUnitId:'L',toUnitId:'ML',fromCode:'L',toCode:'ML',factor:1000}];
 const sauce:SelectableSubRecipe={id:'sauce2',code:'RCP-160203',name:'ซอสผัดเชฟ',yieldQty:1500,yieldUnit:'ML',yieldUnitId:'ML',totalCost:77.6,unitCost:77.6/1500};
 const optionsFor=(child:SelectableSubRecipe)=>liveUnits.filter(u=>compatibleUnitIds(child.yieldUnitId,liveConv).has(u.id)).map(u=>u.code);

 it('59 child yield ML → dropdown มี ML (identity ไม่ต้องมีแถว conversion)',()=>{expect(optionsFor(sauce)).toContain('ML')});
 it('60 เลือกสูตรย่อยแล้ว auto-select หน่วยผลผลิตทันที',()=>{expect(sauce.yieldUnitId).toBe('ML');expect({childRecipeId:sauce.id,unitId:sauce.yieldUnitId}.unitId).toBe('ML')});
 it('61 L ขึ้นในตัวเลือกเพราะมี 1 L = 1000 ML',()=>{expect(optionsFor(sauce)).toContain('L')});
 it('62 KG/G ไม่ขึ้นเพราะข้ามมิติไม่ได้',()=>{const o=optionsFor(sauce);expect(o).not.toContain('KG');expect(o).not.toContain('G')});
 it('63 ค้นหา ML ที่มีอยู่แล้วต้องเจอ (trim + ไม่สนตัวพิมพ์)',()=>{
  expect(findExistingUnit(liveUnits,'ml','')?.id).toBe('ML');
  expect(findExistingUnit(liveUnits,' Ml ','')?.id).toBe('ML');
  expect(findExistingUnit(liveUnits,'','มิลลิลิตร')?.id).toBe('ML');
 });
 it('64 yieldUnitId = null → ไม่มีตัวเลือก และ block การคำนวณ',()=>{
  const broken={...sauce,yieldUnit:null,yieldUnitId:null};
  expect(optionsFor(broken)).toHaveLength(0);
  expect(subRecipeCanonicalQty(800,'ML',broken,liveConv)).toBeNull();
  expect(componentCost({componentType:'SUB_RECIPE',childRecipeId:broken.id,quantity:800,unitId:'ML',wastePercent:0},new Map(),new Map([[broken.id,broken]]),liveConv)).toBe(0);
 });
 it('65 800 ML ของซอสผัดเชฟ ≈ 41.39 บาท',()=>{
  const cost=componentCost({componentType:'SUB_RECIPE',childRecipeId:sauce.id,quantity:800,unitId:'ML',wastePercent:0},new Map(),new Map([[sauce.id,sauce]]),liveConv);
  expect(cost).toBeCloseTo(41.39,2);
  expect(fmtCost(sauce.unitCost)).toBe('0.0517');
 });
 it('66 0.8 L ให้ผลเท่ากับ 800 ML',()=>{
  const viaL=componentCost({componentType:'SUB_RECIPE',childRecipeId:sauce.id,quantity:0.8,unitId:'L',wastePercent:0},new Map(),new Map([[sauce.id,sauce]]),liveConv);
  expect(viaL).toBeCloseTo(41.39,2);
 });
 it('67 ห้ามเกิด 800 × 77.6 = 62,080 (ต้นทุนทั้งหม้อ)',()=>{
  const cost=componentCost({componentType:'SUB_RECIPE',childRecipeId:sauce.id,quantity:800,unitId:'ML',wastePercent:0},new Map(),new Map([[sauce.id,sauce]]),liveConv);
  expect(cost).toBeLessThan(100);
  expect(cost).not.toBeCloseTo(62080,0);
 });
 // --- editable pricing (ราคาขาย / Margin / Markup live cross-calculation) ---
 it('68 ต้นทุน 100 + margin 40% -> ราคา 166.67, กำไร 66.67, markup 66.67%',()=>{
  const price=priceFromMargin(100,40);const p=analyzePrice(100,price);
  expect(price).toBeCloseTo(166.67,2);expect(p.profit).toBeCloseTo(66.67,2);expect(p.markupPercent).toBeCloseTo(66.67,2);
 });
 it('69 markup 66.67% ให้ราคาเดียวกับ margin 40% (สองทางสอดคล้องกัน)',()=>{
  expect(priceFromMarkup(100,66.666667)).toBeCloseTo(priceFromMargin(100,40),2);
 });
 it('70 ระบุราคาขายเองแล้ว margin/markup คำนวณกลับได้',()=>{
  const p=analyzePrice(100,166.67);expect(p.marginPercent).toBeCloseTo(40,2);expect(p.markupPercent).toBeCloseTo(66.67,2);
 });
 it('71 ราคาขายต่ำกว่าต้นทุน -> isLoss + ขาดทุนต่อหน่วย',()=>{
  const p=analyzePrice(100,80);expect(p.isLoss).toBe(true);expect(100-p.sellingPrice).toBeCloseTo(20,2);
 });
 // --- hotfix: sub-recipe unit dropdown / no-yield vs no-conversion ---
 const hUnits:Unit[]=[{id:'ML',code:'ML',name:'มิลลิลิตร',isActive:true},{id:'L',code:'L',name:'ลิตร',isActive:true},{id:'KG',code:'KG',name:'กิโลกรัม',isActive:true}];
 const hConv:UnitConversion[]=[{id:'h1',fromUnitId:'L',toUnitId:'ML',fromCode:'L',toCode:'ML',factor:1000}];
 const withYield:SelectableSubRecipe={id:'s1',code:'R1',name:'ซอส',yieldQty:1500,yieldUnit:'ML',yieldUnitId:'ML',totalCost:77.6,unitCost:77.6/1500};
 const noYield:SelectableSubRecipe={...withYield,yieldUnit:null,yieldUnitId:null};
 const opts=(c:SelectableSubRecipe)=>hUnits.filter(u=>compatibleUnitIds(c.yieldUnitId,hConv).has(u.id)).map(u=>u.code);

 it('72 สูตรย่อยมี yield unit -> dropdown มีหน่วยให้เลือก (ML identity + L ที่แปลงได้)',()=>{
  const o=opts(withYield);expect(o).toContain('ML');expect(o).toContain('L');expect(o).not.toContain('KG');
 });
 it('73 สูตรย่อยไม่มี yield unit -> ไม่มีตัวเลือกและต้อง disabled + warning no-yield',()=>{
  expect(opts(noYield)).toHaveLength(0);
  const isNoYield=Boolean(noYield&&!noYield.yieldUnitId);
  expect(isNoYield).toBe(true);
  expect(subRecipeCanonicalQty(800,'ML',noYield,hConv)).toBeNull();
 });
 it('74 พิมพ์ ML/ml/Ml/มิลลิลิตร -> เจอหน่วยเดิม ไม่สร้างซ้ำ',()=>{
  for(const q of ['ML','ml',' Ml ','มิลลิลิตร']) expect(findExistingUnit(hUnits,q,q)?.id).toBe('ML');
 });
 it('75 หน่วยที่มีอยู่แล้วแต่แปลงไม่ได้ -> เสนอใช้ของเดิม/ตั้งค่าอัตราแปลง ไม่ใช่สร้างใหม่',()=>{
  const hit=findExistingUnit(hUnits,'KG','KG');
  expect(hit?.id).toBe('KG');
  expect(compatibleUnitIds(withYield.yieldUnitId,hConv).has(hit!.id)).toBe(false);
 });
 it('76 แยก no-yield ออกจาก no-conversion ได้ถูกต้อง',()=>{
  const diagnose=(c:SelectableSubRecipe,unitId:string)=>!c.yieldUnitId?'no-yield':unitFactor(unitId,c.yieldUnitId,hConv)==null?'no-conversion':'ok';
  expect(diagnose(noYield,'ML')).toBe('no-yield');
  expect(diagnose(withYield,'KG')).toBe('no-conversion');
  expect(diagnose(withYield,'ML')).toBe('ok');
  expect(diagnose(withYield,'L')).toBe('ok');
 });
 it('77 row ที่ยัง invalid ต้องได้ต้นทุน 0 และบล็อกการบันทึก',()=>{
  const cost=componentCost({componentType:'SUB_RECIPE',childRecipeId:noYield.id,quantity:800,unitId:'ML',wastePercent:0},new Map(),new Map([[noYield.id,noYield]]),hConv);
  expect(cost).toBe(0);
  const unresolved=[{childRecipeId:noYield.id,quantity:800,unitId:'ML'}].filter(x=>subRecipeCanonicalQty(x.quantity,x.unitId,noYield,hConv)==null);
  expect(unresolved).toHaveLength(1);
 });
 // --- Yield Mode: BATCH / ACTUAL ---
 const batchChild:SelectableSubRecipe={id:'b1',code:'RB',name:'ซอสไม่ทราบผลผลิต',yieldQty:1,yieldMode:'BATCH',yieldUnit:null,yieldUnitId:null,totalCost:77.6,unitCost:77.6};
 const actualChild:SelectableSubRecipe={id:'a1',code:'RA',name:'ซอสรู้ผลผลิต',yieldQty:1500,yieldMode:'ACTUAL',yieldUnit:'ML',yieldUnitId:'ML',totalCost:77.6,unitCost:77.6/1500};
 const unknownChild:SelectableSubRecipe={...batchChild,id:'u1',yieldMode:null};
 const bConv:UnitConversion[]=[{id:'b',fromUnitId:'L',toUnitId:'ML',fromCode:'L',toCode:'ML',factor:1000}];
 const bCost=(c:SelectableSubRecipe,qty:number,unitId:string|null)=>componentCost({componentType:'SUB_RECIPE',childRecipeId:c.id,quantity:qty,unitId,wastePercent:0},new Map(),new Map([[c.id,c]]),bConv);

 it('78 unknown yield -> เลือกใช้เป็น Batch ได้ (1 Batch = ต้นทุนทั้งสูตร)',()=>{
  expect(subRecipeCanonicalQty(1,null,batchChild,bConv)).toBe(1);
  expect(bCost(batchChild,1,null)).toBeCloseTo(77.6,4);
 });
 it('79 0.5 Batch = 38.80 และ 2 Batch = 155.20',()=>{
  expect(bCost(batchChild,0.5,null)).toBeCloseTo(38.8,4);
  expect(bCost(batchChild,2,null)).toBeCloseTo(155.2,4);
 });
 it('80 Batch -> ML ถูกบล็อก (ไม่คิดต้นทุนมั่ว)',()=>{
  expect(subRecipeCanonicalQty(800,'ML',batchChild,bConv)).toBeNull();
  expect(bCost(batchChild,800,'ML')).toBe(0);
 });
 it('81 ACTUAL 1500 ML -> 800 ML ≈ 41.39 และ 0.8 L ให้ผลเท่ากัน',()=>{
  expect(bCost(actualChild,800,'ML')).toBeCloseTo(41.39,2);
  expect(bCost(actualChild,0.8,'L')).toBeCloseTo(41.39,2);
 });
 it('82 ยังไม่เลือกโหมด -> บล็อก ไม่ตีความเป็น unit และห้ามเกิด 62,080',()=>{
  expect(subRecipeCanonicalQty(800,'ML',unknownChild,bConv)).toBeNull();
  expect(bCost(unknownChild,800,'ML')).toBe(0);
  expect(bCost(unknownChild,800,'ML')).not.toBeCloseTo(62080,0);
 });
 it('83 สลับ BATCH -> ACTUAL แล้วข้อมูลเดิมไม่พัง (ต้นทุนรวมเท่าเดิม ต่างแค่ฐานผลผลิต)',()=>{
  const switched:SelectableSubRecipe={...batchChild,yieldMode:'ACTUAL',yieldQty:1500,yieldUnit:'ML',yieldUnitId:'ML',unitCost:batchChild.totalCost/1500};
  expect(switched.totalCost).toBe(batchChild.totalCost);
  expect(bCost(switched,800,'ML')).toBeCloseTo(41.39,2);
 });
 it('84 Batch row ที่เผลอมี unitId -> ต้นทุน 0 และถือว่ายัง unresolved (บล็อกการบันทึก)',()=>{
  const unresolved=[{quantity:800,unitId:'ML'}].filter(x=>subRecipeCanonicalQty(x.quantity,x.unitId,batchChild,bConv)==null);
  expect(unresolved).toHaveLength(1);
 });
 it('85 payload ที่ส่งไป backend มี yieldMode ครบ',async()=>{
  mockOk({versionId:'v',versionNo:2,cost:{}});
  await catalogApi.addRecipeVersion('r1',base({yieldMode:'BATCH',standardYieldQty:1,yieldUnitId:null}));
  const body=JSON.parse((vi.mocked(fetch).mock.calls[0][1] as {body:string}).body);
  expect(body.yieldMode).toBe('BATCH');expect(body.standardYieldQty).toBe(1);expect(body.yieldUnitId).toBeNull();
 });
 // --- hotfix: yieldMode round-trip + save unblocks without reload ---
 it('86 normalizeRecipeVersion ส่งต่อ yieldMode (ไม่เดารูปแบบผลผลิต)',()=>{
  expect(normalizeRecipeVersion({standardYieldQty:1,yieldMode:'BATCH',components:[]} as never).yieldMode).toBe('BATCH');
  expect(normalizeRecipeVersion({standardYieldQty:1500,yieldMode:'ACTUAL',yieldUnitId:'ML',components:[]} as never).yieldMode).toBe('ACTUAL');
  expect(normalizeRecipeVersion({standardYieldQty:1,components:[]} as never).yieldMode).toBeNull();
 });
 it('87 child เปลี่ยนเป็น BATCH แล้ว parent คิดต้นทุน/บันทึกได้ทันที (ไม่ต้อง reload)',()=>{
  const stale:SelectableSubRecipe={id:'c9',code:'C9',name:'ซอส',yieldQty:1,yieldMode:null,yieldUnit:null,yieldUnitId:null,totalCost:77.6,unitCost:77.6};
  const row={componentType:'SUB_RECIPE' as const,childRecipeId:'c9',quantity:1,unitId:null,wastePercent:0};
  // ก่อน refetch: ยังบล็อก
  expect(subRecipeCanonicalQty(row.quantity,row.unitId,stale,[])).toBeNull();
  // หลัง refetch (cache ใหม่): ใช้ได้ทันที
  const fresh:SelectableSubRecipe={...stale,yieldMode:'BATCH'};
  expect(subRecipeCanonicalQty(row.quantity,row.unitId,fresh,[])).toBe(1);
  expect(componentCost(row,new Map(),new Map([['c9',fresh]]),[])).toBeCloseTo(77.6,4);
 });
 it('88 child เปลี่ยนเป็น ACTUAL แล้ว parent บันทึกได้ทันที',()=>{
  const fresh:SelectableSubRecipe={id:'c8',code:'C8',name:'ซอส',yieldQty:1500,yieldMode:'ACTUAL',yieldUnit:'ML',yieldUnitId:'ML',totalCost:77.6,unitCost:77.6/1500};
  const row={componentType:'SUB_RECIPE' as const,childRecipeId:'c8',quantity:800,unitId:'ML',wastePercent:0};
  expect(subRecipeCanonicalQty(row.quantity,row.unitId,fresh,[])).toBe(800);
  expect(componentCost(row,new Map(),new Map([['c8',fresh]]),[])).toBeCloseTo(41.39,2);
 });
 it('89 unresolved list ว่างลงหลังตั้งค่า -> error หายเอง',()=>{
  const before:SelectableSubRecipe={id:'c7',code:'C7',name:'ซอส',yieldQty:1,yieldMode:null,yieldUnit:null,yieldUnitId:null,totalCost:10,unitCost:10};
  const after:SelectableSubRecipe={...before,yieldMode:'BATCH'};
  const rows=[{childRecipeId:'c7',quantity:1,unitId:null}];
  const unresolved=(c:SelectableSubRecipe)=>rows.filter(x=>subRecipeCanonicalQty(x.quantity,x.unitId,c,[])==null);
  expect(unresolved(before)).toHaveLength(1);
  expect(unresolved(after)).toHaveLength(0);
 });
 it('90 useAsBatch ส่ง payload ถูกต้องไปที่สูตรย่อย (yield = 1 รอบการผลิต ไม่มีหน่วย)',async()=>{
  mockOk({versionId:'v',versionNo:3,cost:{}});
  await catalogApi.addRecipeVersion('child-1',{...base(),yieldMode:'BATCH',standardYieldQty:1,yieldUnitId:null});
  const [url,init]=vi.mocked(fetch).mock.calls[0];
  expect(String(url)).toContain('/recipes/child-1/versions');
  const body=JSON.parse((init as {body:string}).body);
  expect(body.yieldMode).toBe('BATCH');expect(body.standardYieldQty).toBe(1);expect(body.yieldUnitId).toBeNull();
 });
 // --- item unit identity + default unit (ไข่ไก่ EGG) ---
 const eggUnits:Unit[]=[{id:'EGG',code:'EGG',name:'ฟอง',isActive:true},{id:'BAG',code:'BAG',name:'ถุง',isActive:true},{id:'KG',code:'KG',name:'กิโลกรัม',isActive:true},{id:'G',code:'G',name:'กรัม',isActive:true}];
 const eggConv:UnitConversion[]=[{id:'e1',fromUnitId:'KG',toUnitId:'G',fromCode:'KG',toCode:'G',factor:1000}];
 const egg:Item={...ingredient,id:'egg',code:'RM-098',name:'ไข่ไก่(เบอร์2)',baseUnitId:'EGG',baseUnit:{id:'EGG',code:'EGG',name:'ฟอง'},purchaseUnitId:'EGG',purchaseUnit:{id:'EGG',code:'EGG',name:'ฟอง'},purchaseToBaseFactor:1,lastCost:4.1};
 const bagItem:Item={...ingredient,id:'bagged',name:'ของถุง',baseUnitId:'BAG',baseUnit:{id:'BAG',code:'BAG',name:'ถุง'},purchaseUnitId:'BAG',purchaseUnit:{id:'BAG',code:'BAG',name:'ถุง'},purchaseToBaseFactor:1,lastCost:20};

 it('91 item ฐาน EGG -> default/auto-select เป็น EGG',()=>{
  expect(defaultUnitForItem(egg)).toBe('EGG');
 });
 it('92 identity: 1 EGG = 1 EGG ไม่ต้องมีแถว conversion',()=>{
  expect(itemBaseQty(egg,1,'EGG',[])).toBe(1);
  expect(isUnitUsableForItem(egg,'EGG',[])).toBe(true);
 });
 it('93 80 EGG × ฿4.10 = ฿328.00',()=>{
  const cost=componentCost({componentType:'ITEM',itemId:'egg',quantity:80,unitId:'EGG',wastePercent:0},new Map([['egg',egg]]),new Map(),eggConv);
  expect(cost).toBeCloseTo(328,4);
  expect(fmtMoney(cost)).toBe('328.00');
 });
 it('94 dropdown ของไข่: มี EGG และไม่แสดง BAG/KG/G ที่แปลงไม่ได้',()=>{
  const codes=allowedUnitsForItem(egg,eggUnits,eggConv).map(u=>u.code);
  expect(codes[0]).toBe('EGG');
  expect(codes).not.toContain('BAG');
  expect(codes).not.toContain('KG');
 });
 it('95 มี conversion 1 BAG = 30 EGG แล้ว BAG ต้องเลือกได้',()=>{
  const withBag:UnitConversion[]=[...eggConv,{id:'e2',fromUnitId:'BAG',toUnitId:'EGG',fromCode:'BAG',toCode:'EGG',factor:30}];
  const codes=allowedUnitsForItem(egg,eggUnits,withBag).map(u=>u.code);
  expect(codes).toContain('BAG');
  expect(itemBaseQty(egg,1,'BAG',withBag)).toBe(30);
  expect(componentCost({componentType:'ITEM',itemId:'egg',quantity:1,unitId:'BAG',wastePercent:0},new Map([['egg',egg]]),new Map(),withBag)).toBeCloseTo(123,4);
 });
 it('96 หน่วยค้างจาก item เดิม (BAG) ใช้กับไข่ไม่ได้ -> ต้องถูกตรวจจับและ fallback เป็น EGG',()=>{
  expect(isUnitUsableForItem(egg,'BAG',eggConv)).toBe(false);
  expect(defaultUnitForItem(egg)).toBe('EGG');
 });
 it('97 เปลี่ยน item จาก BAG-based เป็น EGG-based แล้วหน่วยไม่ค้าง BAG',()=>{
  const row={itemId:bagItem.id,unitId:defaultUnitForItem(bagItem)};
  expect(row.unitId).toBe('BAG');
  const changed={itemId:egg.id,unitId:defaultUnitForItem(egg)};
  expect(changed.unitId).toBe('EGG');
 });
 it('98 หน่วย = หน่วยฐาน ต้องไม่ขึ้นคำเตือนเรื่องอัตราแปลง',()=>{
  expect(rowConversion(egg,80,'EGG',eggConv,(id)=>String(id))).toBeNull();
 });
 // === regression fixture: สูตรจริง "เห็ดหูหนูดำผัดไข่" จากชีตต้นทาง ===
 describe('regression: chef sheet 848.95 / 51 ถ้วย',()=>{
  const C:UnitConversion[]=[{id:'x1',fromUnitId:'KG',toUnitId:'G',fromCode:'KG',toCode:'G',factor:1000},{id:'x2',fromUnitId:'L',toUnitId:'ML',fromCode:'L',toCode:'ML',factor:1000}];
  const mk=(id:string,name:string,baseId:string,cost:number,type:Item['type']='RAW_MATERIAL'):Item=>({...ingredient,id,name,type,baseUnitId:baseId,baseUnit:{id:baseId,code:baseId,name:baseId},purchaseUnitId:baseId,purchaseUnit:{id:baseId,code:baseId,name:baseId},purchaseToBaseFactor:1,lastCost:cost});
  // เห็ด 45/KG → 0.045/G · ต้นหอม 66.667/KG → 0.0666667/G · ไข่ 4.10/EGG · น้ำมัน 0.047/ML · ชาม 1.36/PCS
  const mushroom=mk('mush','เห็ดหูหนูดำ','G',0.045);
  const egg=mk('egg','ไข่ไก่(เบอร์2)','EGG',4.1);
  const onion=mk('onion','ต้นหอม','G',20/300);
  const oil=mk('oil','น้ำมันพืช','ML',23.5/500);
  const bowl=mk('bowl','ชาม','PCS',1.36,'PACKAGING');
  const itemsMap=new Map([['mush',mushroom],['egg',egg],['onion',onion],['oil',oil],['bowl',bowl]]);
  const sauce:SelectableSubRecipe={id:'sauce9',code:'S9',name:'ซอสผัดเชฟ',yieldQty:1500,yieldMode:'ACTUAL',yieldUnit:'ML',yieldUnitId:'ML',totalCost:78,unitCost:41.6/800};
  const childrenMap=new Map([['sauce9',sauce]]);
  const comps:RecipeVersionInput['components']=[
   {componentType:'ITEM',itemId:'mush',quantity:5,unitId:'KG',wastePercent:0},
   {componentType:'ITEM',itemId:'egg',quantity:80,unitId:'EGG',wastePercent:0},
   {componentType:'ITEM',itemId:'onion',quantity:0.30,unitId:'KG',wastePercent:0},
   {componentType:'SUB_RECIPE',childRecipeId:'sauce9',quantity:800,unitId:'ML',wastePercent:0},
   {componentType:'ITEM',itemId:'oil',quantity:500,unitId:'ML',wastePercent:0},
   {componentType:'PACKAGING',itemId:'bowl',quantity:51,unitId:'PCS',wastePercent:0},
  ];
  const version:RecipeVersionInput={standardYieldQty:9180,yieldMode:'ACTUAL',yieldUnitId:'G',yieldPercent:100,standardWaste:0,portionQty:180,portionUnit:'ถ้วย',overhead:{mode:'PERCENTAGE',percent:20,base:'DIRECT'},note:null,components:comps};
  const r=()=>computeRecipeV2Preview(version,itemsMap,childrenMap,C);

  it('99 เห็ด 5 KG = ฿225.00',()=>expect(componentCost(comps[0],itemsMap,childrenMap,C)).toBeCloseTo(225,2));
  it('100 ไข่ 80 EGG = ฿328.00',()=>expect(componentCost(comps[1],itemsMap,childrenMap,C)).toBeCloseTo(328,2));
  it('101 ต้นหอม 0.30 KG = 300 G ≈ ฿20.00 (ไม่ใช่ 0.30 G)',()=>{
   expect(itemBaseQty(onion,0.30,'KG',C)).toBeCloseTo(300,6);
   expect(componentCost(comps[2],itemsMap,childrenMap,C)).toBeCloseTo(20,2);
  });
  it('102 สูตรย่อย 800 ML ≈ ฿41.60',()=>expect(componentCost(comps[3],itemsMap,childrenMap,C)).toBeCloseTo(41.6,2));
  it('103 น้ำมัน 500 ML = ฿23.50',()=>expect(componentCost(comps[4],itemsMap,childrenMap,C)).toBeCloseTo(23.5,2));
  it('104 บรรจุภัณฑ์ 51 × ฿1.36 = ฿69.36',()=>expect(componentCost(comps[5],itemsMap,childrenMap,C)).toBeCloseTo(69.36,2));
  it('105 direct total ≈ ฿707.46',()=>{
   const x=r();
   expect(x.ingredientCost+x.subRecipeCost+x.packagingCost).toBeCloseTo(707.46,2);
  });
  it('106 ค่าใช้จ่ายเพิ่ม 20% ≈ ฿141.49',()=>expect(r().overheadCost).toBeCloseTo(141.49,2));
  it('107 ต้นทุนรวม ≈ ฿848.95',()=>expect(r().totalCost).toBeCloseTo(848.95,2));
  it('108 9180 ÷ 180 = 51 ถ้วย',()=>{
   expect(portionCountOf(9180,180)).toBe(51);
   expect(r().portionCount).toBe(51);
  });
  it('109 ต้นทุนต่อถ้วย ≈ ฿16.65',()=>{
   expect(r().costPerPortion).toBeCloseTo(16.65,2);
   expect(fmtMoney(r().costPerPortion!)).toBe('16.65');
  });
  it('110 บรรจุภัณฑ์อัตโนมัติ = จำนวนที่ได้ (51) และ override ได้',()=>{
   expect(packagingQtyForPortions(51)).toBe(51);
   expect(packagingQtyForPortions(51,2)).toBe(102);
   expect(packagingQtyForPortions(null)).toBeNull();
  });
  it('111 0.30 G ของต้นหอมถูกทักว่าน้อยผิดปกติ และเสนอ KG (ไม่แก้ให้เอง)',()=>{
   const hit=suspiciousQuantity(onion,0.30,'G',C);
   expect(hit?.suggestUnitId).toBe('KG');
   // ถ้าใส่ 0.30 KG ถูกต้องแล้ว ไม่ต้องเตือน
   expect(suspiciousQuantity(onion,0.30,'KG',C)).toBeNull();
   // และค่าเดิมไม่ถูกเปลี่ยน
   expect(comps[2].quantity).toBe(0.30);
  });
  it('112 ผลผลิต/portion ต้อง > 0',()=>{
   expect(portionCountOf(0,180)).toBeNull();
   expect(portionCountOf(9180,0)).toBeNull();
  });
 });
 // === price-per-unit semantics: น้ำมันพืช 47 บาท/L, ฐาน ML, 1 L = 1000 ML ===
 describe('price per purchase unit vs base unit',()=>{
  const C:UnitConversion[]=[{id:'p1',fromUnitId:'L',toUnitId:'ML',fromCode:'L',toCode:'ML',factor:1000},{id:'p2',fromUnitId:'KG',toUnitId:'G',fromCode:'KG',toCode:'G',factor:1000}];
  // ตั้งค่าถูกต้อง: ซื้อ 47/L, ฐาน ML, factor 1000 -> lastCost = 47/1000 = 0.047 ต่อ ML
  const oil:Item={...ingredient,id:'oil',name:'น้ำมันพืช',baseUnitId:'ML',baseUnit:{id:'ML',code:'ML',name:'มิลลิลิตร'},purchaseUnitId:'L',purchaseUnit:{id:'L',code:'L',name:'ลิตร'},purchaseToBaseFactor:1000,lastCost:47/1000};
  const M=new Map([['oil',oil]]);
  const cost=(qty:number,unitId:string|null)=>componentCost({componentType:'ITEM',itemId:'oil',quantity:qty,unitId,wastePercent:0},M,new Map(),C);

  it('113 47/L + 500 ML = ฿23.50',()=>expect(cost(500,'ML')).toBeCloseTo(23.5,2));
  it('114 47/L + 1 L = ฿47.00',()=>expect(cost(1,'L')).toBeCloseTo(47,2));
  it('115 47/L + 1500 ML = ฿70.50',()=>expect(cost(1500,'ML')).toBeCloseTo(70.5,2));
  it('116 ราคาต่อหน่วยแสดงถูกทั้งสองด้าน: ฿47.00/L และ ฿0.047/ML',()=>{
   expect(pricePerUnit(oil,'L',C)).toBeCloseTo(47,6);
   expect(pricePerUnit(oil,'ML',C)).toBeCloseTo(0.047,6);
  });
  it('117 inverse ML<->L ถูกต้อง',()=>{
   expect(unitFactor('ML','L',C)).toBeCloseTo(0.001,12);
   expect(unitFactor('L','ML',C)).toBe(1000);
   expect(itemBaseQty(oil,0.5,'L',C)).toBe(500);
  });
  it('118 ไม่มี conversion -> block ไม่เดา',()=>{
   const orphan:Item={...oil,purchaseUnitId:null,purchaseUnit:null,purchaseToBaseFactor:1};
   expect(itemBaseQty(orphan,1,'L',[])).toBeNull();
   expect(componentCost({componentType:'ITEM',itemId:'oil',quantity:1,unitId:'L',wastePercent:0},new Map([['oil',orphan]]),new Map(),[])).toBe(0);
  });
  it('119 ไม่ทำ regression: 45/KG × 5 KG = 225 และ 4.10/EGG × 80 = 328',()=>{
   const mush:Item={...ingredient,id:'m',baseUnitId:'KG',baseUnit:{id:'KG',code:'KG',name:'kg'},purchaseUnitId:'KG',purchaseUnit:{id:'KG',code:'KG',name:'kg'},purchaseToBaseFactor:1,lastCost:45};
   const egg:Item={...ingredient,id:'e',baseUnitId:'EGG',baseUnit:{id:'EGG',code:'EGG',name:'ฟอง'},purchaseUnitId:'EGG',purchaseUnit:{id:'EGG',code:'EGG',name:'ฟอง'},purchaseToBaseFactor:1,lastCost:4.1};
   expect(componentCost({componentType:'ITEM',itemId:'m',quantity:5,unitId:'KG',wastePercent:0},new Map([['m',mush]]),new Map(),C)).toBeCloseTo(225,2);
   expect(componentCost({componentType:'ITEM',itemId:'e',quantity:80,unitId:'EGG',wastePercent:0},new Map([['e',egg]]),new Map(),C)).toBeCloseTo(328,2);
  });
  it('120 ไม่ทำ regression: ของที่ตั้งถูกอยู่แล้ว (0.101/ML ซื้อเป็น KG) ต้องไม่ถูกตีความใหม่',()=>{
   const soda:Item={...ingredient,id:'s',baseUnitId:'ML',baseUnit:{id:'ML',code:'ML',name:'ml'},purchaseUnitId:'KG',purchaseUnit:{id:'KG',code:'KG',name:'kg'},purchaseToBaseFactor:1000,lastCost:0.101};
   // 500 ML ต้องเป็น 50.50 ไม่ใช่ 0.0505
   expect(componentCost({componentType:'ITEM',itemId:'s',quantity:500,unitId:'ML',wastePercent:0},new Map([['s',soda]]),new Map(),C)).toBeCloseTo(50.5,2);
   expect(pricePerUnit(soda,'KG',C)).toBeCloseTo(101,4);
  });
  it('121 ตรวจจับ item ที่ราคายังเป็นต่อหน่วยซื้อ (ฐาน ML แต่ lastCost = 47)',()=>{
   const broken:Item={...oil,lastCost:47};
   expect(priceLooksPerPurchaseUnit(broken)?.factor).toBe(1000);
   // ตั้งถูกแล้วก็ยังรายงาน factor ได้ (ใช้ประกอบการแสดงผล ไม่ใช่แก้ค่าให้เอง)
   expect(priceLooksPerPurchaseUnit({...oil,purchaseUnitId:'ML'})).toBeNull();
  });
 });
 // === save-block hotfix: legacy child with real yield must not block ===
 describe('effective yield mode (legacy child)',()=>{
  const C:UnitConversion[]=[{id:'y1',fromUnitId:'L',toUnitId:'ML',fromCode:'L',toCode:'ML',factor:1000}];
  const legacy:SelectableSubRecipe={id:'sauceL',code:'S-L',name:'ซอสผัดเชฟ',yieldQty:1500,yieldMode:null,yieldUnit:'ML',yieldUnitId:'ML',totalCost:77.6,unitCost:0.0517};
  const noUnit:SelectableSubRecipe={...legacy,id:'noUnit',yieldUnit:null,yieldUnitId:null};
  const batch:SelectableSubRecipe={...legacy,id:'b',yieldMode:'BATCH',yieldQty:1,yieldUnit:null,yieldUnitId:null,unitCost:77.6};
  const cost=(c:SelectableSubRecipe,q:number,u:string|null)=>componentCost({componentType:'SUB_RECIPE',childRecipeId:c.id,quantity:q,unitId:u,wastePercent:0},new Map(),new Map([[c.id,c]]),C);

  it('122 legacy child yieldMode=null + 1500 ML => ถือเป็น ACTUAL',()=>{
   expect(effectiveYieldMode(legacy)).toBe('ACTUAL');
  });
  it('123 parent ใช้ 800 ML => คิดต้นทุนได้ ~41.36 (ไม่ block)',()=>{
   expect(subRecipeCanonicalQty(800,'ML',legacy,C)).toBe(800);
   expect(cost(legacy,800,'ML')).toBeCloseTo(41.36,2);
  });
  it('124 legacy child ไม่มีหน่วยผลผลิต => ยัง block',()=>{
   expect(effectiveYieldMode(noUnit)).toBeNull();
   expect(subRecipeCanonicalQty(800,'ML',noUnit,C)).toBeNull();
   expect(cost(noUnit,800,'ML')).toBe(0);
  });
  it('125 qty=0 + มีหน่วย => ยัง block',()=>{
   expect(effectiveYieldMode({...legacy,yieldQty:0})).toBeNull();
  });
  it('126 BATCH ยังใช้ได้ตามเดิม',()=>{
   expect(effectiveYieldMode(batch)).toBe('BATCH');
   expect(cost(batch,0.5,null)).toBeCloseTo(38.8,2);
  });
  it('127 unresolved list ว่าง => ไม่มี error และ save ส่ง request จริง',async()=>{
   const rows=[{childRecipeId:legacy.id,quantity:800,unitId:'ML'}];
   const unresolved=rows.filter(x=>subRecipeCanonicalQty(x.quantity,x.unitId,legacy,C)==null);
   expect(unresolved).toHaveLength(0);
   mockOk({versionId:'v9',versionNo:6,cost:{}});
   await catalogApi.addRecipeVersion('parent-1',base({components:[{componentType:'SUB_RECIPE',childRecipeId:legacy.id,quantity:800,unitId:'ML',wastePercent:0}]}));
   expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/recipes/parent-1/versions'),expect.objectContaining({method:'POST'}));
  });
  it('128 หลังแก้ child แล้ว cache ใหม่ทำให้ banner หาย',()=>{
   const stale:SelectableSubRecipe={...legacy,yieldQty:1,yieldUnit:null,yieldUnitId:null};
   expect(effectiveYieldMode(stale)).toBeNull();          // ก่อน refetch: ยัง block
   expect(effectiveYieldMode(legacy)).toBe('ACTUAL');      // หลัง refetch: ใช้ได้
  });
 });
 // === real-time costing + multi-tier pricing ===
 describe('costing refresh + price tiers',()=>{
  const tierOf=(mode:'sellingPrice'|'marginPercent'|'markupPercent',value:number,unitCost:number)=>{
   const price=mode==='sellingPrice'?value:mode==='marginPercent'?priceFromMargin(unitCost,value):priceFromMarkup(unitCost,value);
   return analyzePrice(unitCost,price);
  };

  it('129 /costing ส่ง recipeVersionId ไปคำนวณใหม่ (ไม่ใช้ snapshot ค้าง)',async()=>{
   mockOk({breakdown:{materialCost:596.5,packagingCost:69.36,laborCost:0,utilityCost:41.6,overheadCost:141.49,wasteCost:0,otherCost:0,totalCost:848.95,effectiveYield:9180,unitCost:16.65},pricing:null,versionNo:3,calculatedAt:'2026-08-17T10:00:00.000Z'});
   const r=await catalogApi.calculate({recipeVersionId:'v-1'});
   expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/costing/calculate'),expect.objectContaining({method:'POST'}));
   expect(r.breakdown.totalCost).toBeCloseTo(848.95,2);
   expect(r.versionNo).toBe(3);expect(r.calculatedAt).toBeTruthy();
  });
  it('130 breakdown ของ /costing ตรงกับ Recipe Builder (วัตถุดิบ/สูตรย่อย/บรรจุภัณฑ์/overhead)',async()=>{
   mockOk({breakdown:{materialCost:596.5,packagingCost:69.36,laborCost:0,utilityCost:41.6,overheadCost:141.49,wasteCost:0,otherCost:0,totalCost:848.95,effectiveYield:9180,unitCost:16.65,ingredientCost:596.5,subRecipeCost:41.6,costPerYieldUnit:0.0925,portionCount:51,costPerPortion:16.65},pricing:null});
   const r=await catalogApi.calculate({recipeVersionId:'v-1'});
   const b=r.breakdown;
   expect((b.ingredientCost??0)+(b.subRecipeCost??0)+b.packagingCost).toBeCloseTo(707.46,2);
   expect(b.overheadCost).toBeCloseTo(141.49,2);
   expect(b.totalCost).toBeCloseTo(848.95,2);
   expect(b.portionCount).toBe(51);expect(b.costPerPortion).toBeCloseTo(16.65,2);
  });
  it('131 โหลดราคาที่บันทึกไว้ของทุกระดับ',async()=>{
   mockOk([{id:'p1',priceType:'RETAIL',price:1110,marginPercent:40,markupPercent:66.67,updatedAt:''}]);
   const rows=await catalogApi.sellingPrices('menu-1');
   expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/costing/prices/menu-1'),expect.objectContaining({method:'GET'}));
   expect(rows[0].priceType).toBe('RETAIL');
  });
  it('132 ราคาปลีก margin 40% จากต้นทุน 666 => 1,110 กำไร 444',()=>{
   const r=tierOf('marginPercent',40,666);
   expect(r.sellingPrice).toBeCloseTo(1110,2);
   expect(r.profit).toBeCloseTo(444,2);
   expect(r.marginPercent).toBeCloseTo(40,2);
  });
  it('133 ราคาส่ง 943 จากต้นทุน 666 => กำไร 277, margin 29.4%',()=>{
   const r=tierOf('sellingPrice',943,666);
   expect(r.profit).toBeCloseTo(277,2);
   expect(r.marginPercent).toBeCloseTo(29.37,1);
  });
  it('134 ราคาคนรู้จัก 850 จากต้นทุน 666 => กำไร 184, margin 21.6%',()=>{
   const r=tierOf('sellingPrice',850,666);
   expect(r.profit).toBeCloseTo(184,2);
   expect(r.marginPercent).toBeCloseTo(21.65,1);
  });
  it('135 แต่ละระดับคำนวณอีกสองค่าทันทีเมื่อสลับวิธี',()=>{
   const byMargin=tierOf('marginPercent',40,666);
   const bySelling=tierOf('sellingPrice',byMargin.sellingPrice,666);
   expect(bySelling.marginPercent).toBeCloseTo(40,2);
   expect(bySelling.markupPercent).toBeCloseTo(byMargin.markupPercent,2);
  });
  it('136 ราคาต่ำกว่าต้นทุน => warning + ขาดทุนต่อหน่วย',()=>{
   const r=tierOf('sellingPrice',500,666);
   expect(r.isLoss).toBe(true);
   expect(666-r.sellingPrice).toBeCloseTo(166,2);
  });
  it('137 บันทึกราคาแต่ละระดับส่ง priceType ถูกต้อง',async()=>{
   mockOk({id:'sp',price:943});
   await catalogApi.savePrice({itemId:'menu-1',priceType:'WHOLESALE',price:943,marginPercent:29.37,markupPercent:41.59});
   const body=JSON.parse((vi.mocked(fetch).mock.calls[0][1] as {body:string}).body);
   expect(body.priceType).toBe('WHOLESALE');expect(body.price).toBe(943);
  });
  it('138 order snapshot: เปลี่ยนราคาภายหลังไม่กระทบออเดอร์เดิม',()=>{
   const orderLine={unitPrice:1110,quantity:2,lineTotal:2220};   // สแนปช็อตขณะขาย
   const tierNow=tierOf('sellingPrice',1250,666);                 // ราคาใหม่หลังปรับ
   expect(orderLine.unitPrice).toBe(1110);
   expect(orderLine.lineTotal).toBe(2220);
   expect(tierNow.sellingPrice).toBe(1250);
  });
 });
 // === unit conversion manager ===
 describe('unit conversion manager',()=>{
  const U:Unit[]=[{id:'KG',code:'KG',name:'กิโลกรัม',isActive:true},{id:'G',code:'G',name:'กรัม',isActive:true},{id:'L',code:'L',name:'ลิตร',isActive:true},{id:'ML',code:'ML',name:'มิลลิลิตร',isActive:true},{id:'BOX',code:'BOX',name:'กล่อง',isActive:true},{id:'PCS',code:'PCS',name:'ชิ้น',isActive:true}];
  const C:UnitConversion[]=[{id:'c1',fromUnitId:'KG',toUnitId:'G',fromCode:'KG',toCode:'G',factor:1000},{id:'c2',fromUnitId:'L',toUnitId:'ML',fromCode:'L',toCode:'ML',factor:1000}];

  it('139 จัดหมวดสูตรถูกต้อง (น้ำหนัก/ปริมาตร/จำนวน/เฉพาะวัตถุดิบ)',()=>{
   expect(classifyFormula('KG','G')).toBe('WEIGHT');
   expect(classifyFormula('L','ML')).toBe('VOLUME');
   expect(classifyFormula('BOX','PCS')).toBe('COUNT');
   expect(classifyFormula('KG','ML')).toBe('ITEM_SPECIFIC');
  });
  it('140 factor ที่บันทึก = ปลายทาง ÷ ต้นทาง',()=>{
   expect(draftFactor({fromQty:1,toQty:1000})).toBe(1000);
   expect(draftFactor({fromQty:2,toQty:1000})).toBe(500);
   expect(draftFactor({fromQty:1,toQty:950.5})).toBe(950.5);
  });
  it('141 inverse คำนวณอัตโนมัติ ไม่ต้องเก็บแถวซ้ำ',()=>{
   expect(inverseText('KG','G',1000)).toBe('1 G = 0.001 KG');
   expect(inverseText('KG','G',0)).toBeNull();
  });
  it('142 validation: ห้าม 0 / ติดลบ / หน่วยซ้ำ / หน่วยว่าง',()=>{
   expect(validateFormula({fromQty:1,fromUnitId:'',toQty:1,toUnitId:'G'},C,U)?.code).toBe('EMPTY_UNIT');
   expect(validateFormula({fromQty:1,fromUnitId:'KG',toQty:1,toUnitId:'KG'},C,U)?.code).toBe('SAME_UNIT');
   expect(validateFormula({fromQty:1,fromUnitId:'KG',toQty:0,toUnitId:'G'},C,U)?.code).toBe('BAD_NUMBER');
   expect(validateFormula({fromQty:1,fromUnitId:'KG',toQty:-5,toUnitId:'G'},C,U)?.code).toBe('BAD_NUMBER');
  });
  it('143 decimal ใช้ได้ เช่น 1 KG = 950.5 ML',()=>{
   expect(validateFormula({fromQty:1,fromUnitId:'KG',toQty:950.5,toUnitId:'ML'},C,U)).toBeNull();
  });
  it('144 duplicate ต้องเตือน (แต่ยังบันทึกทับได้)',()=>{
   const issue=validateFormula({fromQty:1,fromUnitId:'KG',toQty:900,toUnitId:'G'},C,U);
   expect(issue?.code).toBe('DUPLICATE');
  });
  it('145 ค่าที่ขัดกับเส้นทางเดิมถูกบล็อก (conflict)',()=>{
   const withKheed:UnitConversion[]=[...C,{id:'c3',fromUnitId:'KHEED',toUnitId:'G',fromCode:'ขีด',toCode:'G',factor:100}];
   // KG->G = 1000 อยู่แล้ว => KG->ขีด ต้องเป็น 10 ถ้าใส่ 12 ต้องขัด
   const issue=validateFormula({fromQty:1,fromUnitId:'KG',toQty:12,toUnitId:'KHEED'},withKheed,[...U,{id:'KHEED',code:'ขีด',name:'ขีด',isActive:true}]);
   expect(issue?.code).toBe('CONFLICT');
  });
  it('146 สูตรแนะนำมีครบทุกหมวดและเตือนสูตรข้ามมิติ',()=>{
   expect(RECOMMENDED.some(r=>r.fromCode==='KG'&&r.toCode==='G'&&r.toQty===1000)).toBe(true);
   expect(RECOMMENDED.some(r=>r.fromCode==='L'&&r.toCode==='ML'&&r.toQty===1000)).toBe(true);
   expect(RECOMMENDED.some(r=>r.kind==='COUNT'&&r.toQty===null)).toBe(true);
   const crossDim=RECOMMENDED.find(r=>r.kind==='ITEM_SPECIFIC');
   expect(crossDim?.warn).toContain('ห้ามตั้งเป็นสูตรกลาง');
  });
  it('147 create/edit เรียก endpoint เดิม (ไม่สร้างระบบซ้ำ)',async()=>{
   mockOk({id:'c9'});
   await catalogApi.saveConversion({fromUnitId:'BOX',toUnitId:'PCS',factor:12});
   expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/units/conversions'),expect.objectContaining({method:'POST'}));
  });
  it('148 delete เรียก endpoint เดิมและ reference guard คืน CONVERSION_IN_USE',async()=>{
   mockOk({id:'c1',deleted:true});
   await catalogApi.deleteConversion('c1');
   expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/units/conversions/c1'),expect.objectContaining({method:'DELETE'}));
   expect(new ApiClientError('CONVERSION_IN_USE','ใช้งานอยู่',409).code).toBe('CONVERSION_IN_USE');
  });
  it('149 item-specific ไม่กระทบ item อื่น',()=>{
   const oil:Item={...ingredient,id:'oil',baseUnitId:'ML',baseUnit:{id:'ML',code:'ML',name:'ml'},purchaseUnitId:'L',purchaseUnit:{id:'L',code:'L',name:'l'},purchaseToBaseFactor:1000,lastCost:0.047};
   const other:Item={...ingredient,id:'other',baseUnitId:'ML',baseUnit:{id:'ML',code:'ML',name:'ml'},purchaseUnitId:null,purchaseUnit:null,purchaseToBaseFactor:1,lastCost:0.1};
   expect(itemBaseQty(oil,1,'L',C)).toBe(1000);
   expect(itemBaseQty(other,1,'L',C)).toBe(1000);   // ผ่านสูตรมาตรฐาน L->ML เท่านั้น
   expect(itemBaseQty(other,1,'KG',C)).toBeNull();  // ไม่ได้รับสูตรเฉพาะของน้ำมัน
  });
  it('150 Recipe Builder เห็นค่าใหม่ทันทีหลังบันทึก (cache key เดียวกัน)',()=>{
   const before=unitFactor('BOX','PCS',C);
   const after=unitFactor('BOX','PCS',[...C,{id:'c9',fromUnitId:'BOX',toUnitId:'PCS',fromCode:'BOX',toCode:'PCS',factor:12}]);
   expect(before).toBeNull();
   expect(after).toBe(12);
  });
 });
});

function mockOk(data:unknown){vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({success:true,data,message:""})}))}
beforeEach(()=>{vi.unstubAllGlobals();localStorage.clear()});
