import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Archive, Beaker, Boxes, Check, ChevronDown, Coins, Copy, FileText, Info, Layers,
  Loader2, Package, Plus, RotateCcw, Save, Settings2, Trash2, TrendingUp, Utensils, X,
} from 'lucide-react';
import {
  catalogApi, type Item, type RecipeComponentInput, type RecipeDraftCost, type RecipeOverhead,
  type RecipeVersionInput, type SelectableSubRecipe, type Unit, type UnitConversion, type YieldMode,
} from '@/lib/catalog';
import { ApiClientError } from '@/lib/api-client';
import { analyzePrice, priceFromMargin, priceFromMarkup } from '@/lib/cost-sheet';
import {
  allowedUnitsForItem, compatibleUnitIds, componentCost, effectiveYieldMode, pricePerUnit, packagingQtyForPortions, portionCountOf, suspiciousQuantity, defaultUnitForItem, isUnitUsableForItem, itemBaseQty, computeRecipeV2Preview, findExistingUnit, fmtCost, fmtMoney,
  fmtPercent, fmtQty, money, normalizeRecipeVersion, normalizeUnitText, overheadAmount, rowConversion, subRecipeCanonicalQty, unitFactor,
} from '@/lib/recipe-preview';
import { useI18n, type Locale } from '@/i18n/i18n';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import CreatableCombobox from '@/components/ui/CreatableCombobox';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { PageContainer, PageHeader, StickySummary } from '@/components/layout/page';
import { firstBlockerMessage, recipeSaveBlockers } from '@/lib/recipe-validation';

/** หัวข้อในหน้า — ใช้ทั้ง section nav และปุ่ม "ไปแก้" ของสรุปการตรวจ */
const SECTION_IDS = ['info', 'yield', 'ingredients', 'sub', 'packaging', 'overhead', 'price'] as const;
type SectionId = (typeof SECTION_IDS)[number];

/** เลื่อนไปยัง section แล้วโฟกัสให้ผู้ใช้เห็นว่ามาถึงจุดไหน (เคารพ prefers-reduced-motion) */
function scrollToSection(target: SectionId) {
  const el = document.getElementById(`rb-${target}`);
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  el.focus?.({ preventScroll: true });
}

const copy = {
 th:{title:'Recipe Builder 2.0',eyebrow:'FOOD COSTING',info:'ข้อมูลสูตร',infoDesc:'เมนู ชื่อ และรหัสของสูตร',yield:'ผลผลิต',yieldDesc:'ปริมาณและหน่วยที่ได้จากสูตรนี้',ingredients:'วัตถุดิบ',ingredientsDesc:'วัตถุดิบหลักที่ใช้ในการผลิต',sub:'สูตรย่อย',subDesc:'ซอส/ส่วนผสมกึ่งสำเร็จที่คิดต้นทุนต่อหน่วยแล้ว',packaging:'บรรจุภัณฑ์',packagingDesc:'กล่อง ถุง หรือภาชนะที่ใช้',overhead:'ค่าใช้จ่ายการผลิตเพิ่มเติม',overheadDesc:'ค่าแรง/น้ำ/ไฟ/แก๊ส เพิ่มเติม',price:'ราคาและกำไร',priceDesc:'ตั้งราคาขายและดูกำไร',
  save:'บันทึก',duplicate:'ทำสำเนา',print:'พิมพ์',archive:'เก็บถาวร',restore:'กู้คืน',remove:'ลบสูตร',name:'ชื่อสูตร',code:'รหัสสูตร',menu:'เมนู',newMenu:'เมนูใหม่',existingMenu:'เมนูเดิม',description:'รายละเอียด',totalYield:'จำนวนผลผลิต',portionSize:'ขนาดต่อหน่วย',portionName:'ชื่อหน่วย',portionCount:'จำนวนที่ได้',costPortion:'ต้นทุนต่อ',
  addIngredient:'เพิ่มวัตถุดิบ',addSub:'เพิ่มสูตรย่อย',addPackaging:'เพิ่มบรรจุภัณฑ์',search:'ค้นหา...',quantity:'ปริมาณใช้',unit:'หน่วย',waste:'สูญเสีย %',usedCost:'ต้นทุนที่ใช้',total:'ยอดรวม',percentage:'เปอร์เซ็นต์',detailed:'แยกรายการ',totalExpense:'ค่าใช้จ่ายรวม',calcBase:'ฐานคำนวณ',addExpense:'เพิ่มรายการค่าใช้จ่าย',
  summary:'สรุปต้นทุนสด',groupDirect:'ต้นทุนทางตรง',groupProduction:'ต้นทุนการผลิต',groupTotal:'รวมทั้งหมด',groupYield:'ผลผลิต',groupPricing:'ราคาและกำไร',ingredientCost:'ต้นทุนวัตถุดิบ',subCost:'ต้นทุนสูตรย่อย',packagingCost:'ต้นทุนบรรจุภัณฑ์',overheadCost:'ค่าใช้จ่ายการผลิต',totalCost:'ต้นทุนรวม',costYield:'ต้นทุนต่อ',sellingPrice:'ราคาขาย',profit:'กำไร',margin:'กำไรเทียบราคาขาย',markup:'กำไรบวกจากต้นทุน',
  zeroYield:'ผลผลิตต้องมากกว่า 0',circular:'ไม่สามารถเพิ่มสูตรย่อยแบบวนซ้ำได้',inUse:'สูตรนี้มีประวัติการใช้งาน จึงไม่สามารถลบถาวรได้',archiveInstead:'เก็บถาวรแทน',confirmArchive:'ยืนยันเก็บสูตรนี้ถาวร?',confirmDelete:'พิมพ์ชื่อสูตรเพื่อยืนยันการลบถาวร',reason:'เหตุผลการสร้างเวอร์ชันใหม่',saved:'บันทึกสูตรแล้ว',copied:'ทำสำเนาสูตรสำเร็จ',archived:'เก็บสูตรถาวรแล้ว',restored:'กู้คืนสูตรแล้ว',deleted:'ลบสูตรถาวรแล้ว',empty:'ยังไม่มีรายการ',collapse:'ย่อ/ขยายสรุป',
  addUnit:'เพิ่มหน่วยใหม่',addMenuItem:'เพิ่มเมนูใหม่',addItemNew:'เพิ่มวัตถุดิบใหม่',addPackagingNew:'เพิ่มบรรจุภัณฑ์ใหม่',selectItem:'เลือกวัตถุดิบ',selectPackaging:'เลือกบรรจุภัณฑ์',selectSub:'เลือกสูตรย่อย',selectMenu:'เลือกเมนู',selectUnit:'เลือกหน่วย',
  unitHelper:'ตัวช่วยหน่วย',equationUsed:'สมการที่ใช้',enteredQty:'ปริมาณที่กรอก',convertedQty:'แปลงแล้ว',showConversion:'ดูการแปลงหน่วย',hideConversion:'ซ่อนการแปลงหน่วย',purchasePriceLabel:'ราคาซื้อ',usedInRecipe:'ใช้ในสูตร',pricePerUnitLabel:'ราคาต่อ',noConversion:'ยังไม่มีอัตราแปลงหน่วยนี้',incompatibleUnit:'หน่วยนี้ยังใช้กับสูตรย่อยนี้ไม่ได้จนกว่าจะตั้งค่าอัตราแปลง',setupConversion:'ตั้งค่าอัตราแปลง',unitCreated:'เพิ่มหน่วยแล้ว',unitReused:'มีหน่วยนี้อยู่แล้ว ระบบเลือกหน่วยเดิมให้แล้ว',subNoYieldUnit:'สูตรย่อยนี้ยังไม่ได้กำหนดหน่วยผลผลิต',editSubRecipe:'แก้ไขสูตรย่อย',yieldModeLabel:'รูปแบบผลผลิต',reconcileTitle:'ตรวจสอบสูตรก่อนบันทึก',itemsWord:'รายการ',pcsWord:'ชิ้น',portionWord:'หน่วย',autoPackaging:'คำนวณตามจำนวนผลผลิต',autoPackagingHint:'จะตั้งจำนวนบรรจุภัณฑ์ให้เท่ากับ',portionSizeHint:'ระบุเป็นหน่วยเดียวกับผลผลิต:',sellingUnitName:'หน่วยขาย',sellingUnitPh:'เช่น ถ้วย',suspiciousQty:'“{name}” ใส่ {qty} {from} ซึ่งอาจน้อยผิดปกติ — ต้องการใช้ {qty} {to} หรือไม่?',useSuggested:'ใช้ {to}',yieldUnitLabel:'หน่วยผลผลิต',pickYieldMode:'กรุณาเลือกรูปแบบผลผลิตก่อน (ผลผลิตจริง หรือ 1 รอบการผลิต)',needYieldUnit:'กรุณาระบุหน่วยผลผลิต',fixSubFirst:'กรุณากำหนดวิธีคิดผลผลิตของสูตรย่อยนี้ก่อนบันทึก',batchSummary:'สูตรนี้คิดต้นทุนต่อ 1 รอบการผลิต',modeActual:'ผลผลิตจริง',modeBatch:'คิดเป็น 1 รอบการผลิต',modeActualHint:'รู้ผลผลิตจริง เช่น 1500 ML / 5 KG / 40 ถ้วย',modeBatchHint:'สูตรนี้คิดต้นทุนต่อ 1 รอบการผลิต',batchUnit:'รอบการผลิต',costPerBatch:'ต้นทุนต่อรอบ',batchHint:'ใส่เป็นจำนวนรอบการผลิต เช่น 0.5 = ครึ่งสูตร',unknownYield:'ยังไม่ได้กำหนดวิธีคิดผลผลิต',unknownYieldLong:'สูตรย่อยนี้ยังไม่ได้กำหนดวิธีคิดผลผลิต',useAsBatch:'ใช้เป็น 1 รอบการผลิต',setActualYield:'กำหนดผลผลิตจริง',batchNotConvertible:'สูตรนี้คิดเป็นรอบการผลิต จึงยังแปลงเป็นหน่วยอื่นไม่ได้',batchApplied:'ตั้งสูตรย่อยเป็นแบบรอบการผลิตแล้ว',batchFailed:'ตั้งเป็นรอบการผลิตไม่สำเร็จ',batchReason:'กำหนดรูปแบบผลผลิตเป็นรอบการผลิต',noCompatibleUnit:'ไม่มีอัตราแปลงหน่วยที่ใช้กับสูตรนี้',needConversion:'ต้องตั้งค่าอัตราแปลงก่อน',unitHelperSub:'ใช้หน่วยผลผลิตของสูตรย่อย หรือหน่วยที่แปลงได้จาก',baseUnitTag:'หน่วยที่ใช้จริง',unitExistsNoConversion:'มีหน่วยนี้อยู่แล้ว แต่ยังไม่มีอัตราแปลงระหว่างหน่วยนี้กับหน่วยผลผลิตของสูตรย่อย',itemCreated:'เพิ่มรายการแล้ว',
  subBadge:'สูตรย่อย',yieldWord:'Yield',lossWarning:'ราคาขายต่ำกว่าต้นทุน',costPerUnitLabel:'ต้นทุนต่อหน่วย',lossPerUnit:'ขาดทุนต่อหน่วย',
  newUnitName:'ชื่อหน่วย',newUnitCode:'รหัส/สัญลักษณ์',newItemName:'ชื่อรายการ',newItemBaseUnit:'หน่วยฐาน',newItemPrice:'ราคาซื้อ/หน่วยฐาน',unitModalTitle:'เพิ่มหน่วยใหม่',itemModalTitle:'เพิ่มรายการใหม่',cancel:'ยกเลิก',add:'เพิ่ม',
  printTitle:'ใบต้นทุนสูตรอาหาร',company:'บริษัท',date:'วันที่',version:'เวอร์ชัน',seq:'ลำดับ',colItem:'รายการ',colQty:'ปริมาณ',colUnit:'หน่วย',colWaste:'สูญเสีย %',colUnitPrice:'ราคา/หน่วย',colLineCost:'ต้นทุน',printSubYield:'Yield สูตรย่อย',printMethod:'วิธี',printBase:'ฐาน',methodTotal:'ยอดรวม',methodPercent:'เปอร์เซ็นต์',methodDetailed:'แยกรายการ',jumpTo:'ไปยังหัวข้อ',sectionsLabel:'หัวข้อในหน้านี้',blockedCount:'ยังบันทึกไม่ได้ {n} จุด',goFix:'ไปแก้',saving:'กำลังบันทึก…',colConversion:'การแปลงหน่วย',colAction:'จัดการ',colProduct:'สินค้า',statusActive:'ใช้งาน',statusArchived:'เก็บถาวร',newRecipe:'สร้างสูตรใหม่',readyToSave:'ตรวจครบแล้ว บันทึกได้',identityConv:'หน่วยเดียวกัน ไม่ต้องแปลง',checkPass:'ผ่าน',checkWarn:'ควรตรวจ',reconcileOk:'ตรวจครบแล้ว พร้อมบันทึก',reconcileBad:'มี {n} จุดที่ควรตรวจ'},
 en:{title:'Recipe Builder 2.0',eyebrow:'FOOD COSTING',info:'Recipe information',infoDesc:'Menu, name and code of the recipe',yield:'Yield',yieldDesc:'Quantity and unit this recipe produces',ingredients:'Ingredients',ingredientsDesc:'Main raw materials used in production',sub:'Sub-recipes',subDesc:'Sauces / semi-finished parts already costed per unit',packaging:'Packaging',packagingDesc:'Boxes, bags or containers used',overhead:'Production overhead',overheadDesc:'Extra labour / water / power / gas',price:'Price / profit',priceDesc:'Set the selling price and see the profit',
  save:'Save',duplicate:'Duplicate',print:'Print',archive:'Archive',restore:'Restore',remove:'Delete recipe',name:'Recipe name',code:'Recipe code',menu:'Menu',newMenu:'New menu',existingMenu:'Existing menu',description:'Description',totalYield:'Total yield',portionSize:'Portion size',portionName:'Portion name',portionCount:'Portions',costPortion:'Cost per',
  addIngredient:'Add ingredient',addSub:'Add sub-recipe',addPackaging:'Add packaging',search:'Search...',quantity:'Quantity used',unit:'Unit',waste:'Waste %',usedCost:'Cost used',total:'Total',percentage:'Percentage',detailed:'Detailed',totalExpense:'Total expense',calcBase:'Calculation base',addExpense:'Add expense line',
  summary:'Live cost summary',groupDirect:'Direct costs',groupProduction:'Production cost',groupTotal:'Total',groupYield:'Yield',groupPricing:'Pricing',ingredientCost:'Ingredient cost',subCost:'Sub-recipe cost',packagingCost:'Packaging cost',overheadCost:'Production overhead',totalCost:'Total cost',costYield:'Cost per',sellingPrice:'Selling price',profit:'Profit',margin:'Margin',markup:'Markup',
  zeroYield:'Yield must be greater than 0',circular:'Circular sub-recipes are not allowed.',inUse:'This recipe has usage history and cannot be permanently deleted.',archiveInstead:'Archive instead',confirmArchive:'Archive this recipe?',confirmDelete:'Type the recipe name to confirm permanent deletion',reason:'Reason for new version',saved:'Recipe saved',copied:'Recipe duplicated',archived:'Recipe archived',restored:'Recipe restored',deleted:'Recipe permanently deleted',empty:'No items yet',collapse:'Collapse/expand summary',
  addUnit:'Add new unit',addMenuItem:'Add new menu',addItemNew:'Add new ingredient',addPackagingNew:'Add new packaging',selectItem:'Select ingredient',selectPackaging:'Select packaging',selectSub:'Select sub-recipe',selectMenu:'Select menu',selectUnit:'Select unit',
  unitHelper:'Unit helper',equationUsed:'Equation used',enteredQty:'Entered quantity',convertedQty:'Converted',showConversion:'Show conversions',hideConversion:'Hide conversions',purchasePriceLabel:'Purchase price',usedInRecipe:'Used in recipe',pricePerUnitLabel:'Price per',noConversion:'No conversion configured for this unit',incompatibleUnit:'This unit cannot be used for this sub-recipe until a conversion is configured',setupConversion:'Set up conversion',unitCreated:'Unit added',unitReused:'This unit already exists — selected the existing one',subNoYieldUnit:'This sub-recipe has no yield unit yet',editSubRecipe:'Edit sub-recipe',yieldModeLabel:'Yield mode',reconcileTitle:'Check the recipe before saving',itemsWord:'items',pcsWord:'pcs',portionWord:'portion',autoPackaging:'Match the portion count',autoPackagingHint:'Packaging quantity will be set to',portionSizeHint:'Enter in the same unit as the yield:',sellingUnitName:'Selling unit',sellingUnitPh:'e.g. cup',suspiciousQty:'“{name}” is {qty} {from}, which looks unusually small — did you mean {qty} {to}?',useSuggested:'Use {to}',yieldUnitLabel:'Yield unit',pickYieldMode:'Choose a yield mode first (actual yield or 1 batch)',needYieldUnit:'A yield unit is required',fixSubFirst:'Set how this sub-recipe measures its yield before saving',batchSummary:'This recipe is costed per production batch',modeActual:'Actual yield',modeBatch:'Per batch',modeActualHint:'Yield is known, e.g. 1500 ML / 5 KG / 40 cups',modeBatchHint:'Yield unknown — counted as 1 batch (whole recipe cost)',batchUnit:'Batch',costPerBatch:'Cost per batch',batchHint:'Use a batch count, e.g. 0.5 = half the recipe',unknownYield:'This sub-recipe has an unknown yield',unknownYieldLong:'This sub-recipe has an unknown yield — choose how to use it',useAsBatch:'Use as 1 batch',setActualYield:'Set actual yield',batchNotConvertible:'This recipe has an unknown yield, so it cannot be converted to another unit yet',batchApplied:'Sub-recipe set to batch mode',batchFailed:'Could not switch to batch mode',batchReason:'Set yield mode to batch',noCompatibleUnit:'No conversion available for this recipe',needConversion:'needs a conversion first',unitHelperSub:'Use the sub-recipe yield unit, or a unit convertible from',baseUnitTag:'item unit',unitExistsNoConversion:'This unit exists, but there is no conversion between it and the sub-recipe yield unit',itemCreated:'Item added',
  subBadge:'Sub-recipe',yieldWord:'Yield',lossWarning:'Selling price is below cost',costPerUnitLabel:'Cost per unit',lossPerUnit:'Loss per unit',
  newUnitName:'Unit name',newUnitCode:'Code / symbol',newItemName:'Item name',newItemBaseUnit:'Base unit',newItemPrice:'Purchase price / base unit',unitModalTitle:'Add new unit',itemModalTitle:'Add new item',cancel:'Cancel',add:'Add',
  printTitle:'Recipe Cost Sheet',company:'Company',date:'Date',version:'Version',seq:'No.',colItem:'Item',colQty:'Qty',colUnit:'Unit',colWaste:'Waste %',colUnitPrice:'Unit price',colLineCost:'Cost',printSubYield:'Sub-recipe yield',printMethod:'Method',printBase:'Base',methodTotal:'Total',methodPercent:'Percentage',methodDetailed:'Detailed',jumpTo:'Jump to section',sectionsLabel:'Sections',blockedCount:'{n} issues block saving',goFix:'Fix',saving:'Saving…',colConversion:'Conversion',colAction:'Actions',colProduct:'Product',statusActive:'Active',statusArchived:'Archived',newRecipe:'New recipe',readyToSave:'All checks passed',identityConv:'Same unit, no conversion needed',checkPass:'OK',checkWarn:'Check',reconcileOk:'All checks passed',reconcileBad:'{n} items to review'},
 'zh-CN':{title:'配方构建器 2.0',eyebrow:'食品成本',info:'配方信息',infoDesc:'菜单、名称和编码',yield:'产量',yieldDesc:'此配方产出的数量和单位',ingredients:'原料',ingredientsDesc:'生产使用的主要原料',sub:'子配方',subDesc:'已按单位计价的酱料/半成品',packaging:'包装',packagingDesc:'使用的盒、袋或容器',overhead:'生产费用',overheadDesc:'额外的人工/水/电/气',price:'价格 / 利润',priceDesc:'设定售价并查看利润',
  save:'保存',duplicate:'复制',print:'打印',archive:'归档',restore:'恢复',remove:'删除配方',name:'配方名称',code:'配方编码',menu:'菜单',newMenu:'新菜单',existingMenu:'现有菜单',description:'说明',totalYield:'总产量',portionSize:'每份大小',portionName:'份名',portionCount:'份数',costPortion:'每份成本',
  addIngredient:'添加原料',addSub:'添加子配方',addPackaging:'添加包装',search:'搜索...',quantity:'使用量',unit:'单位',waste:'损耗 %',usedCost:'使用成本',total:'总额',percentage:'百分比',detailed:'明细',totalExpense:'费用总额',calcBase:'计算基数',addExpense:'添加费用',
  summary:'实时成本摘要',groupDirect:'直接成本',groupProduction:'生产成本',groupTotal:'合计',groupYield:'产量',groupPricing:'价格与利润',ingredientCost:'原料成本',subCost:'子配方成本',packagingCost:'包装成本',overheadCost:'生产费用',totalCost:'总成本',costYield:'每单位成本',sellingPrice:'售价',profit:'利润',margin:'毛利率',markup:'加价率',
  zeroYield:'产量必须大于 0',circular:'不允许循环子配方。',inUse:'此配方已有使用记录，无法永久删除。',archiveInstead:'改为归档',confirmArchive:'确定归档此配方？',confirmDelete:'输入配方名称以确认永久删除',reason:'新版本原因',saved:'配方已保存',copied:'配方已复制',archived:'配方已归档',restored:'配方已恢复',deleted:'配方已永久删除',empty:'暂无项目',collapse:'折叠/展开摘要',
  addUnit:'添加新单位',addMenuItem:'添加新菜单',addItemNew:'添加新原料',addPackagingNew:'添加新包装',selectItem:'选择原料',selectPackaging:'选择包装',selectSub:'选择子配方',selectMenu:'选择菜单',selectUnit:'选择单位',
  unitHelper:'单位助手',equationUsed:'使用的换算式',enteredQty:'输入数量',convertedQty:'换算后',showConversion:'显示换算',hideConversion:'隐藏换算',purchasePriceLabel:'采购价',usedInRecipe:'配方用量',pricePerUnitLabel:'单价 / ',noConversion:'此单位尚未配置换算',incompatibleUnit:'配置换算前，此单位无法用于该子配方',setupConversion:'设置换算',unitCreated:'已添加单位',unitReused:'该单位已存在，已为你选择现有单位',subNoYieldUnit:'该子配方尚未设置产量单位',editSubRecipe:'编辑子配方',yieldModeLabel:'产量模式',reconcileTitle:'保存前检查配方',itemsWord:'项',pcsWord:'个',portionWord:'份',autoPackaging:'按份数计算',autoPackagingHint:'包装数量将设为',portionSizeHint:'请使用与产量相同的单位：',sellingUnitName:'销售单位',sellingUnitPh:'例如：杯',suspiciousQty:'“{name}” 为 {qty} {from}，看起来偏小 — 是否指 {qty} {to}？',useSuggested:'使用 {to}',yieldUnitLabel:'产量单位',pickYieldMode:'请先选择产量模式（实际产量或 1 批次）',needYieldUnit:'需要产量单位',fixSubFirst:'保存前请先设置该子配方的产量计算方式',batchSummary:'此配方按每批次计算成本',modeActual:'实际产量',modeBatch:'按批次',modeActualHint:'已知产量，例如 1500 ML / 5 KG / 40 杯',modeBatchHint:'产量未知 — 按 1 批次计（整份配方成本）',batchUnit:'批次',costPerBatch:'每批次成本',batchHint:'按批次数量使用，例如 0.5 = 半份',unknownYield:'该子配方产量未知',unknownYieldLong:'该子配方产量未知 — 请选择使用方式',useAsBatch:'按 1 批次使用',setActualYield:'设置实际产量',batchNotConvertible:'该配方产量未知，暂时无法换算为其他单位',batchApplied:'子配方已设为批次模式',batchFailed:'切换批次模式失败',batchReason:'将产量模式设为批次',noCompatibleUnit:'没有可用于此配方的换算',needConversion:'需要先设置换算',unitHelperSub:'使用子配方的产量单位，或可从其换算的单位：',baseUnitTag:'项目单位',unitExistsNoConversion:'该单位已存在，但与子配方产量单位之间没有换算',itemCreated:'已添加项目',
  subBadge:'子配方',yieldWord:'产量',lossWarning:'售价低于成本',costPerUnitLabel:'单位成本',lossPerUnit:'每单位亏损',
  newUnitName:'单位名称',newUnitCode:'编码 / 符号',newItemName:'项目名称',newItemBaseUnit:'基础单位',newItemPrice:'采购价 / 基础单位',unitModalTitle:'添加新单位',itemModalTitle:'添加新项目',cancel:'取消',add:'添加',
  printTitle:'配方成本表',company:'公司',date:'日期',version:'版本',seq:'序号',colItem:'项目',colQty:'数量',colUnit:'单位',colWaste:'损耗 %',colUnitPrice:'单价',colLineCost:'成本',printSubYield:'子配方产量',printMethod:'方式',printBase:'基数',methodTotal:'总额',methodPercent:'百分比',methodDetailed:'明细',jumpTo:'跳转到',sectionsLabel:'章节',blockedCount:'{n} 处问题无法保存',goFix:'去修正',saving:'保存中…',colConversion:'单位换算',colAction:'操作',colProduct:'商品',statusActive:'启用',statusArchived:'已归档',newRecipe:'新建配方',readyToSave:'检查通过，可保存',identityConv:'同一单位，无需换算',checkPass:'通过',checkWarn:'需检查',reconcileOk:'检查通过',reconcileBad:'{n} 项需检查'},
} as const;

let key=0;
const row=():RecipeComponentInput&{key:string}=>({key:`r${++key}`,componentType:'ITEM',itemId:null,childRecipeId:null,quantity:0,unitId:null,wastePercent:0,note:null});
type Row=ReturnType<typeof row>;
type Labels=(typeof copy)[Locale];
type UnitTarget={kind:'yield'}|{kind:'ingredientUnit'|'subUnit';rowKey:string};
type ItemTarget={type:'ITEM'|'PACKAGING';rowKey:string;name:string};

export default function RecipeBuilderPage(){
 const {id,menuId}=useParams();const nav=useNavigate();const qc=useQueryClient();const {locale}=useI18n();const s=copy[locale as Locale];const {toast}=useToast();const {user}=useAuth();
 const canCreateMaster=Boolean(user?.roles.includes('SUPER_ADMIN')||['INGREDIENT_CREATE','INGREDIENT_EDIT','PACKAGING_CREATE','PACKAGING_EDIT','RECIPE_CREATE','RECIPE_EDIT'].some((p)=>user?.permissions.includes(p)));
 const canCreateMenu=Boolean(user?.roles.includes('SUPER_ADMIN')||['MENU_CREATE','MENU_EDIT'].some((p)=>user?.permissions.includes(p)));

 const menusQ=useQuery({queryKey:['menus'],queryFn:catalogApi.menus});
 const unitsQ=useQuery({queryKey:['units'],queryFn:catalogApi.units});
 const conversionsQ=useQuery({queryKey:['unit-conversions'],queryFn:catalogApi.conversions});
 const itemsQ=useQuery({queryKey:['items','selectable'],queryFn:()=>catalogApi.selectableItems()});
 const recipeQ=useQuery({queryKey:['recipe',id],queryFn:()=>catalogApi.recipe(id!),enabled:Boolean(id)});
 const childrenQ=useQuery({queryKey:['recipes','selectable-subrecipes',id],queryFn:()=>catalogApi.selectableSubRecipes('',id)});
 const items=useMemo(()=>itemsQ.data??[],[itemsQ.data]);
 const itemsUpdatedAt=itemsQ.dataUpdatedAt;const conversionsUpdatedAt=conversionsQ.dataUpdatedAt;
 const units=useMemo(()=>unitsQ.data??[],[unitsQ.data]);
 const conversions=useMemo(()=>conversionsQ.data??[],[conversionsQ.data]);
 const children=useMemo(()=>childrenQ.data??[],[childrenQ.data]);
 const itemMap=useMemo(()=>new Map(items.map(x=>[x.id,x])),[items]);
 const childMap=useMemo(()=>new Map(children.map(x=>[x.id,x])),[children]);

 const [productId,setProductId]=useState(menuId??''),[newMenu,setNewMenu]=useState(!menuId),[newMenuName,setNewMenuName]=useState(''),[newMenuUnit,setNewMenuUnit]=useState('');
 const [name,setName]=useState(''),[code,setCode]=useState(''),[description,setDescription]=useState(''),[yieldQty,setYieldQty]=useState(1),[yieldMode,setYieldMode]=useState<YieldMode|null>('ACTUAL'),[yieldUnitId,setYieldUnitId]=useState(''),[portionQty,setPortionQty]=useState<number|null>(null),[portionUnit,setPortionUnit]=useState('');
 const [rows,setRows]=useState<Row[]>([]),[overhead,setOverhead]=useState<RecipeOverhead>({mode:'TOTAL',total:0}),[reason,setReason]=useState('');
 const [priceMode,setPriceMode]=useState<'selling'|'margin'|'markup'>('margin'),[priceValue,setPriceValue]=useState(40);
 const [serverCost,setServerCost]=useState<RecipeDraftCost|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [dialog,setDialog]=useState<'archive'|'delete'|null>(null),[deleteText,setDeleteText]=useState(''),[summaryOpen,setSummaryOpen]=useState(true),[autoPackaging,setAutoPackaging]=useState(false);
 // quick-create modals — เก็บ target แยกจากฟอร์มหลัก เพื่อไม่รีเซ็ตสถานะสูตร (PART 32)
 const [unitTarget,setUnitTarget]=useState<UnitTarget|null>(null),[newUnit,setNewUnit]=useState({name:'',code:''}),[savingUnit,setSavingUnit]=useState(false);
 const [itemTarget,setItemTarget]=useState<ItemTarget|null>(null),[newItem,setNewItem]=useState({name:'',baseUnitId:'',price:0}),[savingItem,setSavingItem]=useState(false);
 const init=useRef('');

 useEffect(()=>{if(!newMenuUnit&&units[0])setNewMenuUnit(units[0].id);},[units,newMenuUnit]);
 // โหลดสูตรเดิม — รอ conversions/children พร้อมก่อน เพื่อแปลงปริมาณสูตรย่อยกลับเป็นหน่วยที่ผู้ใช้เลือกไว้ได้ถูกต้อง
 useEffect(()=>{
  const detail=recipeQ.data;if(!detail||init.current===detail.id||conversionsQ.data===undefined||childrenQ.data===undefined)return;init.current=detail.id;
  const v=detail.versions.find(x=>x.isActive)??detail.versions[0];
  setProductId(detail.product.id);setNewMenu(false);setName(detail.name);setCode(detail.code);setDescription(detail.description??'');
  if(v){
   const normalized=normalizeRecipeVersion(v as unknown as Partial<RecipeVersionInput>&Record<string,unknown>);
   setYieldQty(normalized.standardYieldQty);// ใช้ค่าที่บันทึกไว้จริง · สูตรเก่าที่ยังไม่เคยเลือก: มีหน่วยผลผลิต = ผลผลิตจริง (พฤติกรรมเดิม) ไม่มีหน่วย = ให้ผู้ใช้เลือกเอง ห้ามเดาเป็นรอบการผลิต
   setYieldMode(normalized.yieldMode??(normalized.yieldUnitId?'ACTUAL':null));setYieldUnitId(normalized.yieldUnitId??'');setPortionQty(normalized.portionQty??null);setPortionUnit(normalized.portionUnit??'');
   setOverhead(normalized.overhead??{mode:'TOTAL',total:0});
   // เก็บปริมาณตามหน่วยที่ผู้ใช้เลือกไว้ตรง ๆ (backend แปลงเองตอนคิดต้นทุน) จึงแสดงกลับได้ทันที
   setRows(normalized.components.map(x=>({...x,key:`r${++key}`})));
   setServerCost(v.cost);
  }
 },[recipeQ.data,conversionsQ.data,childrenQ.data,childMap]);

 // ส่งปริมาณตามหน่วยที่ผู้ใช้เลือก + unitId ตรง ๆ — backend เป็นผู้แปลงหน่วยและคิดต้นทุน (source of truth)
 const buildComponents=useMemo(()=>rows.map(({key:_,...x})=>x),[rows]);
 const unresolvedSubRecipes=useMemo(()=>rows.filter(x=>x.componentType==='SUB_RECIPE'&&x.childRecipeId).filter(x=>subRecipeCanonicalQty(x.quantity,x.unitId,childMap.get(x.childRecipeId??''),conversions)==null),[rows,childMap,conversions]);
 const version:RecipeVersionInput=useMemo(()=>({standardYieldQty:yieldMode==='BATCH'?1:yieldQty,yieldMode,yieldUnitId:yieldMode==='BATCH'?null:(yieldUnitId||null),yieldPercent:100,standardWaste:0,portionQty,portionUnit:portionUnit||null,overhead,note:description||null,components:buildComponents}),[yieldQty,yieldMode,yieldUnitId,portionQty,portionUnit,overhead,description,buildComponents]);

 const local=useMemo(()=>computeRecipeV2Preview(version,itemMap,childMap,conversions),[version,itemMap,childMap,conversions]);
 const cost=serverCost??local;
 const unit=units.find(x=>x.id===yieldUnitId)?.code??'';
 const portionCount=useMemo(()=>yieldMode==='BATCH'?null:portionCountOf(yieldQty,portionQty),[yieldMode,yieldQty,portionQty]);
 const packagingRows=useMemo(()=>rows.filter(x=>x.componentType==='PACKAGING'&&x.itemId),[rows]);
 const packagingTotalQty=useMemo(()=>packagingRows.reduce((sum,x)=>sum+x.quantity,0),[packagingRows]);
 const packagingUnitCost=useMemo(()=>itemMap.get(packagingRows[0]?.itemId??'')?.lastCost??0,[itemMap,packagingRows]);
 // ผูกจำนวนบรรจุภัณฑ์กับจำนวนที่ได้ (1 ใบ/หน่วยขาย) — ปิดตัวเลือกนี้เพื่อกรอกเอง
 useEffect(()=>{
  if(!autoPackaging)return;
  const want=packagingQtyForPortions(portionCount);
  if(want==null)return;
  for(const row of packagingRows) if(row.quantity!==want) patchRow(row.key,{quantity:want});
 },[autoPackaging,portionCount,packagingRows]);
 // ปริมาณที่อาจคีย์ผิดหน่วย (เช่น 0.30 G ที่น่าจะเป็น 0.30 KG) — เตือนเท่านั้น ไม่แก้ให้เอง
 const suspiciousRows=useMemo(()=>rows.filter(x=>x.componentType!=='SUB_RECIPE'&&x.itemId).flatMap(x=>{
  const item=itemMap.get(x.itemId??'');const hit=suspiciousQuantity(item,x.quantity,x.unitId,conversions);
  if(!hit)return [];
  const fromCode=units.find(u=>u.id===x.unitId)?.code??'';const toCode=units.find(u=>u.id===hit.suggestUnitId)?.code??'';
  return [{key:x.key,name:item?.name??'',quantity:x.quantity,fromCode,toCode,suggestUnitId:hit.suggestUnitId}];
 }),[rows,itemMap,conversions,units]);
 const costBasis=cost.costPerPortion??cost.costPerYieldUnit;
 const selling=priceMode==='selling'?priceValue:priceMode==='margin'?priceFromMargin(costBasis,priceValue):priceFromMarkup(costBasis,priceValue);
 const pricing=analyzePrice(costBasis,selling);
 const activeVersion=recipeQ.data?.versions.find(x=>x.isActive)??recipeQ.data?.versions[0];
 const legacyOverhead=Boolean(activeVersion&&!activeVersion.overhead&&[activeVersion.laborCost,activeVersion.electricCost,activeVersion.waterCost,activeVersion.gasCost,activeVersion.overheadCost,activeVersion.otherCost].some(Number));

 // พรีวิวสด backend (debounce) — ต้องตรงกับพรีวิวหน้าเว็บ
 useEffect(()=>{if(yieldQty<=0||rows.length===0||unresolvedSubRecipes.length>0){setServerCost(null);return;}const timer=setTimeout(()=>catalogApi.calculateRecipe(version,id).then(setServerCost).catch(e=>{setServerCost(null);if(e instanceof ApiClientError&&e.code==='CIRCULAR_SUBRECIPE')setError(s.circular);}),450);return()=>clearTimeout(timer);// itemsUpdatedAt: ราคาซื้อ/หน่วยของวัตถุดิบเปลี่ยน (เช่นแก้ราคา 47/L) ต้องคิดต้นทุนใหม่ทันที ไม่ค้างค่าเดิม
 },[version,id,yieldQty,rows.length,unresolvedSubRecipes.length,s.circular,itemsUpdatedAt,conversionsUpdatedAt]);

 // เคลียร์ error เดิมทันทีเมื่อสูตรย่อยถูกแก้ครบแล้ว — ผู้ใช้ไม่ต้อง reload
 useEffect(()=>{if(unresolvedSubRecipes.length===0)setError(prev=>(prev.startsWith(s.fixSubFirst)||prev===s.pickYieldMode||prev===s.needYieldUnit)?'':prev);},[unresolvedSubRecipes.length,s.fixSubFirst,s.pickYieldMode,s.needYieldUnit]);
 // ข้อมูลตั้งต้นของการตรวจก่อนบันทึก ใช้ร่วมกันระหว่าง save() กับแผงสรุป
 const blockerInput=useMemo(()=>({
  yieldMode,yieldUnitId,yieldQty,rowCount:rows.length,
  unresolvedSubRecipeNames:unresolvedSubRecipes.map(x=>childMap.get(x.childRecipeId??'')?.name??'-'),
  messages:{pickYieldMode:s.pickYieldMode,needYieldUnit:s.needYieldUnit,zeroYield:s.zeroYield,empty:s.empty,fixSubFirst:s.fixSubFirst},
 }),[yieldMode,yieldUnitId,yieldQty,rows.length,unresolvedSubRecipes,childMap,s]);

 // เพิ่มแถวแล้วพาไปที่ช่องเลือกสินค้าของแถวใหม่ทันที จะได้พิมพ์ต่อได้เลยไม่ต้องเลื่อนหา
 const add=(type:Row['componentType'])=>setRows(x=>{
  const next={...row(),componentType:type};
  requestAnimationFrame(()=>{
   const el=document.querySelector<HTMLElement>(`[data-row-key="${next.key}"] .row-picker input, [data-row-key="${next.key}"] .row-picker button`);
   el?.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
   el?.focus();
  });
  return [...x,next];
 });
 const patchRow=(k:string,p:Partial<Row>)=>setRows(x=>x.map(r=>r.key===k?{...r,...p}:r));
 const removeRow=(k:string)=>setRows(x=>x.filter(r=>r.key!==k));

 // ----- unit quick-create (shared) — เก็บสถานะสูตรไว้ครบ -----
 function openUnit(target:UnitTarget,query:string){setNewUnit({name:query,code:''});setUnitTarget(target);}
 /**
 * เลือกหน่วยให้ target ปัจจุบัน — แยกสาเหตุที่ทำไม่ได้ออกจากกัน เพื่อไม่บอกผู้ใช้ผิดสาเหตุ
 *  'ok'          สำเร็จ
 *  'no-yield'    สูตรย่อยยังไม่ได้กำหนดหน่วยผลผลิต (ต้องไปแก้สูตรย่อย ไม่ใช่ตั้งอัตราแปลง)
 *  'no-conversion' มีหน่วยผลผลิตแล้ว แต่ยังไม่มีอัตราแปลงระหว่างสองหน่วยนี้
 */
 type UnitPickResult='ok'|'no-yield'|'no-conversion';
 function selectUnitForTarget(selected:Unit):UnitPickResult{
  if(unitTarget?.kind==='yield')setYieldUnitId(selected.id);
  else if(unitTarget?.kind==='ingredientUnit')patchRow(unitTarget.rowKey,{unitId:selected.id});
  else if(unitTarget?.kind==='subUnit'){
   const targetRow=rows.find(x=>x.key===unitTarget.rowKey);const child=childMap.get(targetRow?.childRecipeId??'');
   if(!child?.yieldUnitId)return 'no-yield';
   if(unitFactor(selected.id,child.yieldUnitId,conversions)==null)return 'no-conversion';
   patchRow(unitTarget.rowKey,{unitId:selected.id});
  }
  return 'ok';
 }
 /** แจ้งผลการเลือกหน่วยด้วยข้อความที่ตรงกับสาเหตุจริง */
 function reportUnitPick(result:UnitPickResult,okMessage:string){
  if(result==='ok'){toast(okMessage);return;}
  if(result==='no-yield'){
   const targetRow=unitTarget?.kind==='subUnit'?rows.find(x=>x.key===unitTarget.rowKey):undefined;
   const childId=targetRow?.childRecipeId;
   toast({title:s.subNoYieldUnit,variant:'warning',actionLabel:s.editSubRecipe,onAction:()=>{if(childId)nav(`/recipes/${childId}`);},duration:9000});
   return;
  }
  toast({title:s.unitExistsNoConversion,variant:'warning',actionLabel:s.setupConversion,onAction:()=>nav('/units/conversions'),duration:9000});
 }
 function finishExistingUnit(selected:Unit){
  const result=selectUnitForTarget(selected);
  if(result==='ok'){setUnitTarget(null);setNewUnit({name:'',code:''});}
  reportUnitPick(result,s.unitReused);
 }
 async function saveUnit(){
  if(!newUnit.name.trim()||!newUnit.code.trim()){toast('กรอกชื่อหน่วยและตัวย่อ','error');return;}
  setSavingUnit(true);
  try{
   // มีหน่วยนี้อยู่แล้ว (trim + ไม่สนตัวพิมพ์) → ใช้ของเดิม ไม่ต้องสร้างซ้ำ
   const existingNow=findExistingUnit(units,newUnit.code,newUnit.name);
   if(existingNow){finishExistingUnit(existingNow);return;}
   const created=await catalogApi.createUnit({code:newUnit.code.trim(),name:newUnit.name.trim()});
   await qc.invalidateQueries({queryKey:['units']});
   const result=selectUnitForTarget(created);
   if(result==='ok'){setUnitTarget(null);setNewUnit({name:'',code:''});}
   reportUnitPick(result,s.unitCreated);
  }catch(e){
   if(e instanceof ApiClientError&&(e.status===409||e.code==='CONFLICT')){
    const refreshed=await unitsQ.refetch();const existing=findExistingUnit(refreshed.data??[],newUnit.code,newUnit.name);
    if(existing){finishExistingUnit(existing);return;}
   }
   toast(e instanceof Error?e.message:String(e),'error');
  }
  finally{setSavingUnit(false);}
 }
 // ----- item quick-create (ingredient / packaging) -----
 function openItem(target:ItemTarget){setNewItem({name:target.name,baseUnitId:units[0]?.id??'',price:0});setItemTarget(target);}
 async function saveItem(){
  if(!itemTarget)return;if(!newItem.name.trim()||!newItem.baseUnitId){toast('กรอกชื่อและหน่วยฐาน','error');return;}
  setSavingItem(true);
  try{
   const prefix=itemTarget.type==='PACKAGING'?'PKG':'RM';
   const created=await catalogApi.createItem({code:`${prefix}-${Date.now().toString().slice(-6)}`,name:newItem.name.trim(),type:itemTarget.type==='PACKAGING'?'PACKAGING':'RAW_MATERIAL',baseUnitId:newItem.baseUnitId,purchaseToBaseFactor:1,...(newItem.price>0?{purchasePrice:newItem.price,purchaseQuantity:1}:{})});
   await qc.invalidateQueries({queryKey:['items','selectable']});
   patchRow(itemTarget.rowKey,{itemId:created.id,unitId:created.baseUnitId});
   toast(s.itemCreated);setItemTarget(null);
  }catch(e){toast(e instanceof Error?e.message:String(e),'error');}
  finally{setSavingItem(false);}
 }

 /**
  * "ใช้เป็น 1 Batch" — บันทึกสูตรย่อยเป็นโหมด BATCH (yield = 1 Batch, ไม่มีหน่วย)
  * ใช้ API เวอร์ชันเดิม ไม่แตะต้นทุนที่บันทึกไว้ และไม่สร้าง Unit Master ใหม่
  */
 async function useAsBatch(childId:string){
  setBusy(true);setError('');
  try{
   const detail=await catalogApi.recipe(childId);
   const v=detail.versions.find(x=>x.isActive)??detail.versions[0];
   if(!v){setError(s.batchFailed);return;}
   const normalized=normalizeRecipeVersion(v as unknown as Partial<RecipeVersionInput>&Record<string,unknown>);
   await catalogApi.addRecipeVersion(childId,{...normalized,yieldMode:'BATCH',standardYieldQty:1,yieldUnitId:null,reason:s.batchReason});
   await qc.invalidateQueries({queryKey:['recipes','selectable-subrecipes']});
   await childrenQ.refetch();
   toast(s.batchApplied);
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 }

 async function save(e:FormEvent){e.preventDefault();
  // กฎเดิมทุกข้อ ลำดับเดิม — ต่างแค่ย้ายไปอยู่ที่เดียวกับที่แผงสรุปใช้
  const blocked=firstBlockerMessage(blockerInput);
  if(blocked){setError(blocked);return;}
  setBusy(true);setError('');
  try{
   if(id){
    await catalogApi.addRecipeVersion(id,{...version,reason});toast(s.saved);
    // สูตรนี้อาจถูกใช้เป็นสูตรย่อยที่อื่น — ล้าง cache ทุกที่ที่อ้างถึง เพื่อให้ banner/ต้นทุนอัปเดตทันทีโดยไม่ต้อง reload
    await Promise.all([
     qc.invalidateQueries({queryKey:['recipe',id]}),
     qc.invalidateQueries({queryKey:['recipes','selectable-subrecipes']}),
     qc.invalidateQueries({queryKey:['recipes']}),
    ]);
   }
   else{const menu=newMenu?{newMenu:{name:newMenuName,code:code||undefined,sellingUnitId:newMenuUnit}}:{productId};const made=await catalogApi.createRecipe({...menu,name:name||undefined,code:code||undefined,description:description||null,version});toast(s.saved);nav(`/recipes/${made.id}`);}
  }catch(e){setError(e instanceof ApiClientError&&e.code==='CIRCULAR_SUBRECIPE'?s.circular:e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 }
 async function lifecycle(action:'archive'|'restore'|'delete'|'duplicate'){if(!id)return;setBusy(true);
  try{
   if(action==='archive'){await catalogApi.archiveRecipe(id);toast(s.archived);await recipeQ.refetch();}
   if(action==='restore'){await catalogApi.restoreRecipe(id);toast(s.restored);await recipeQ.refetch();}
   if(action==='delete'){await catalogApi.deleteRecipe(id);toast(s.deleted);nav('/recipes');}
   if(action==='duplicate'){const made=await catalogApi.duplicateRecipe(id);toast(s.copied);nav(`/recipes/${made.id}`);}
  }catch(e){if(e instanceof ApiClientError&&e.code==='RECIPE_IN_USE')toast({title:s.inUse,variant:'warning',actionLabel:s.archiveInstead,onAction:()=>void lifecycle('archive'),duration:9000});else setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 }
 const print=()=>window.print();

 const menuName=menusQ.data?.find(x=>x.id===productId)?.name??name;
 // สิ่งที่ทำให้กดบันทึกไม่ผ่าน — ใช้ฟังก์ชันเดียวกับที่ save() เรียก จึงไม่มีทางหลุดจากกันได้
 const blockers=useMemo(()=>recipeSaveBlockers(blockerInput),[blockerInput]);

 return <PageContainer size="wide" className="rb2">
  <form onSubmit={save} className="rb2-form">
  <PageHeader
   breadcrumb={s.eyebrow}
   title={id?(name||s.title):s.newRecipe}
   description={s.infoDesc}
   badge={id&&recipeQ.data?<span className={`badge ${recipeQ.data.isActive?'success':'muted'}`}>{recipeQ.data.isActive?s.statusActive:s.statusArchived}</span>:undefined}
   meta={id&&activeVersion?<><span>{s.version} {activeVersion.versionNo}</span>{menuName&&<span>{menuName}</span>}</>:undefined}
   actions={<>
    {id&&<>
     <button type="button" className="btn" onClick={()=>void lifecycle('duplicate')}><Copy/>{s.duplicate}</button>
     <button type="button" className="btn" onClick={print}><FileText/>{s.print}</button>
     {recipeQ.data?.isActive?<button type="button" className="btn" onClick={()=>setDialog('archive')}><Archive/>{s.archive}</button>:<button type="button" className="btn" onClick={()=>void lifecycle('restore')}><RotateCcw/>{s.restore}</button>}
     <button type="button" className="btn danger-btn" onClick={()=>setDialog('delete')}><Trash2/>{s.remove}</button>
    </>}
    <button className="btn primary" disabled={busy}>{busy?<Loader2 className="spin"/>:<Save/>}{busy?s.saving:s.save}</button>
   </>}
  />

  <SectionNav labels={s}/>
  {error&&<div className="rb2-alert" role="alert">{error}<button type="button" onClick={()=>setError('')}><X/></button></div>}
  {legacyOverhead&&<div className="rb2-compat" role="status">สูตรนี้ใช้รูปแบบค่าใช้จ่ายเดิม — รายการเดิมถูกแสดงอย่างปลอดภัย และจะเปลี่ยนเป็นโหมดใหม่เมื่อคุณบันทึก</div>}

  <div className="rb2-grid"><main>
   <Section id="info" badge="A" icon={<Info/>} title={s.info} desc={s.infoDesc}>
    <div className="rb2-fields">
     {!id&&<label className="wide">{s.menu}
      <div className="rb2-tabs"><button type="button" className={newMenu?'active':''} onClick={()=>setNewMenu(true)}>{s.newMenu}</button><button type="button" className={!newMenu?'active':''} onClick={()=>setNewMenu(false)}>{s.existingMenu}</button></div>
      {newMenu?<input value={newMenuName} onChange={e=>setNewMenuName(e.target.value)} required/>:
       <CreatableCombobox ariaLabel={s.menu} value={productId} onChange={setProductId} placeholder={s.selectMenu} searchPlaceholder={s.search}
        options={(menusQ.data??[]).map(x=>({value:x.id,label:x.name,sublabel:x.code}))}
        createLabel={canCreateMenu?s.addMenuItem:undefined} onCreate={canCreateMenu?(q=>{setNewMenu(true);setNewMenuName(q);}):undefined}/>}
     </label>}
     <label>{s.name}<input value={name} onChange={e=>setName(e.target.value)}/></label>
     <label>{s.code}<input value={code} onChange={e=>setCode(e.target.value)}/></label>
     <label className="wide">{s.description}<textarea value={description} onChange={e=>setDescription(e.target.value)}/></label>
     {id&&<label className="wide">{s.reason}<input value={reason} onChange={e=>setReason(e.target.value)}/></label>}
    </div>
   </Section>

   <Section id="yield" badge="B" icon={<Layers/>} title={s.yield} desc={s.yieldDesc}>
    <p className="yield-mode-label" id="rb-yieldmode-label">{s.yieldModeLabel}</p>
    <div className="rb2-tabs yield-mode-tabs" role="radiogroup" aria-labelledby="rb-yieldmode-label">
     <button type="button" role="radio" aria-checked={yieldMode==='ACTUAL'} className={yieldMode==='ACTUAL'?'active':''} onClick={()=>setYieldMode('ACTUAL')}>{s.modeActual}</button>
     <button type="button" role="radio" aria-checked={yieldMode==='BATCH'} className={yieldMode==='BATCH'?'active':''} onClick={()=>{setYieldMode('BATCH');setYieldQty(1);setYieldUnitId('');}}>{s.modeBatch}</button>
    </div>
    <p className="field-hint">{yieldMode==='BATCH'?s.modeBatchHint:yieldMode==='ACTUAL'?s.modeActualHint:s.pickYieldMode}</p>
    {yieldMode==='BATCH'
     ? <div className="batch-yield-summary"><strong>{s.batchSummary}</strong><span>{s.costPerBatch}: ฿{fmtMoney(cost.totalCost)}</span></div>
     : yieldMode===null
     ? null
     : <div className="rb2-yield">
     <label>{s.totalYield}<span>
      <input aria-label={s.totalYield} type="number" min="0.000001" step="any" value={yieldQty} onChange={e=>setYieldQty(+e.target.value)}/>
      <div className="unit-combo"><CreatableCombobox ariaLabel={s.yieldUnitLabel} value={yieldUnitId} onChange={setYieldUnitId} placeholder={s.selectUnit} searchPlaceholder={s.search}
       options={units.map(x=>({value:x.id,label:x.code,sublabel:x.name}))}
       createLabel={canCreateMaster?s.addUnit:undefined} onCreate={canCreateMaster?(q=>openUnit({kind:'yield'},q)):undefined}/></div>
     </span></label>
     <label>{s.portionSize}<span>
      <input aria-label={s.portionSize} type="number" min="0.000001" step="any" value={portionQty??''} onChange={e=>setPortionQty(e.target.value?+e.target.value:null)}/>
      <b className="unit-static">{unit}</b>
     </span><small className="field-hint">{s.portionSizeHint} {unit}</small></label>
     <label>{s.sellingUnitName}<input aria-label={s.sellingUnitName} value={portionUnit} onChange={e=>setPortionUnit(e.target.value)} placeholder={s.sellingUnitPh}/></label>
    </div>}
    {yieldMode==='ACTUAL'&&portionCount!=null&&<p className="yield-formula">{fmtQty(yieldQty)} {unit} ÷ {fmtQty(portionQty??0)} {unit} = <strong>{fmtQty(portionCount)} {portionUnit||s.portionWord}</strong></p>}
    {yieldMode!=='BATCH'&&yieldQty<=0&&<p className="field-error" role="alert"><AlertTriangle aria-hidden width={14}/>{s.zeroYield}</p>}
    {cost.portionCount!=null&&<div className="portion-result"><strong>{s.portionCount}: {fmtQty(cost.portionCount)} {portionUnit||'portion'}</strong><span>{s.costPortion} {portionUnit||'portion'}: ฿{fmtMoney(cost.costPerPortion??0)}</span></div>}
   </Section>

   <ComponentSection id="ingredients" kind="ITEM" badge="C" icon={<Utensils/>} title={s.ingredients} desc={s.ingredientsDesc} button={s.addIngredient} subtotal={cost.ingredientCost}
    rows={rows} items={items.filter(x=>x.type!=='PACKAGING')} children={children} units={units} conversions={conversions} labels={s}
    canCreateMaster={canCreateMaster} onAdd={add} onPatch={patchRow} onRemove={removeRow} onCreateUnit={openUnit} onCreateItem={openItem} onSetupConversion={()=>nav('/units/conversions')} onUseAsBatch={useAsBatch}/>
   {packagingRows.length>0&&portionCount!=null&&<div className="pkg-auto">
    <label className="pkg-auto-toggle">
     <input type="checkbox" checked={autoPackaging} onChange={e=>setAutoPackaging(e.target.checked)}/>
     <span><strong>{s.autoPackaging}</strong><small>{s.autoPackagingHint} {fmtQty(portionCount)} {portionUnit||s.portionWord}</small></span>
    </label>
    {autoPackaging&&<p className="pkg-auto-preview">
     <span className="num">{fmtQty(portionCount)} {portionUnit||s.portionWord}</span>
     <span aria-hidden>→</span>
     <span className="num">{fmtQty(portionCount)} × ฿{fmtCost(packagingUnitCost)}</span>
     <span aria-hidden>=</span>
     <strong className="num">฿{fmtMoney(cost.packagingCost)}</strong>
    </p>}
   </div>}

   <ComponentSection id="sub" kind="SUB_RECIPE" badge="D" icon={<Beaker/>} title={s.sub} desc={s.subDesc} button={s.addSub} subtotal={cost.subRecipeCost}
    rows={rows} items={[]} children={children} units={units} conversions={conversions} labels={s}
    canCreateMaster={canCreateMaster} onAdd={add} onPatch={patchRow} onRemove={removeRow} onCreateUnit={openUnit} onCreateItem={openItem} onSetupConversion={()=>nav('/units/conversions')} onUseAsBatch={useAsBatch}/>

   <ComponentSection id="packaging" kind="PACKAGING" badge="E" icon={<Package/>} title={s.packaging} desc={s.packagingDesc} button={s.addPackaging} subtotal={cost.packagingCost}
    rows={rows} items={items.filter(x=>x.type==='PACKAGING')} children={children} units={units} conversions={conversions} labels={s}
    canCreateMaster={canCreateMaster} onAdd={add} onPatch={patchRow} onRemove={removeRow} onCreateUnit={openUnit} onCreateItem={openItem} onSetupConversion={()=>nav('/units/conversions')} onUseAsBatch={useAsBatch}/>

   <Section id="overhead" badge="F" icon={<Boxes/>} title={s.overhead} desc={s.overheadDesc} subtotal={cost.overheadCost}>
    <div className="rb2-tabs overhead-tabs" role="radiogroup" aria-label={s.overhead}>{(['TOTAL','PERCENTAGE','DETAILED'] as const).map((m,i)=><button type="button" role="radio" aria-checked={overhead.mode===m} key={m} className={overhead.mode===m?'active':''} onClick={()=>setOverhead({mode:m,...(m==='TOTAL'?{total:0}:m==='PERCENTAGE'?{percent:0,base:'DIRECT'}:{details:[]})})}>{[s.total,s.percentage,s.detailed][i]}</button>)}</div>
    {overhead.mode==='TOTAL'&&<label>{s.totalExpense}<span className="money-field"><input type="number" min="0" step="0.01" placeholder="0.00" value={overhead.total??0} onChange={e=>setOverhead({...overhead,total:+e.target.value})}/><b>฿</b></span></label>}
    {overhead.mode==='PERCENTAGE'&&<div className="rb2-fields">
     <label>{s.percentage}<span className="money-field"><input type="number" min="0" step="0.01" placeholder="0.00" value={overhead.percent??0} onChange={e=>setOverhead({...overhead,percent:+e.target.value})}/><b>%</b></span></label>
     <label>{s.calcBase}<select value={overhead.base??'DIRECT'} onChange={e=>setOverhead({...overhead,base:e.target.value as RecipeOverhead['base']})}><option value="INGREDIENT">{s.ingredientCost}</option><option value="DIRECT">Direct</option><option value="TOTAL">Total direct</option></select></label>
     <div className="formula">฿{fmtMoney(overhead.base==='INGREDIENT'?local.ingredientCost:local.ingredientCost+local.subRecipeCost+local.packagingCost)} × {fmtPercent(overhead.percent??0)}% = <strong>฿{fmtMoney(local.overheadCost)}</strong></div>
    </div>}
    {overhead.mode==='DETAILED'&&<div className="expense-lines">
     {(overhead.details??[]).map((x,i)=><div key={i}><input aria-label={s.addExpense} value={x.label} onChange={e=>setOverhead({...overhead,details:overhead.details?.map((r,j)=>j===i?{...r,label:e.target.value}:r)})}/><span className="money-field"><input aria-label={s.totalExpense} type="number" min="0" step="0.01" placeholder="0.00" value={x.amount} onChange={e=>setOverhead({...overhead,details:overhead.details?.map((r,j)=>j===i?{...r,amount:+e.target.value}:r)})}/><b>฿</b></span><button type="button" className="icon-btn" onClick={()=>setOverhead({...overhead,details:overhead.details?.filter((_,j)=>j!==i)})}><X/></button></div>)}
     <button type="button" className="btn add-component" onClick={()=>setOverhead({...overhead,details:[...(overhead.details??[]),{label:'',amount:0}]})}><Plus/>{s.addExpense}</button>
     <strong className="expense-total">{s.total}: ฿{fmtMoney(overheadAmount(overhead,local.ingredientCost,local.subRecipeCost,local.packagingCost))}</strong>
    </div>}
   </Section>

   <Section id="price" badge="G" icon={<TrendingUp/>} title={s.price} desc={s.priceDesc}>
    <div className="rb2-tabs" role="radiogroup" aria-label={s.price}>{(['selling','margin','markup'] as const).map((m,i)=><button type="button" role="radio" aria-checked={priceMode===m} className={priceMode===m?'active':''} key={m} onClick={()=>setPriceMode(m)}>{[s.sellingPrice,s.margin,s.markup][i]}</button>)}</div>
    <label className="price-input"><input type="number" min="0" step="any" value={priceValue} onChange={e=>setPriceValue(+e.target.value)}/> <b>{priceMode==='selling'?'฿':'%'}</b></label>
    {pricing.isLoss&&<div className="loss-warning" role="alert"><AlertTriangle/><div><strong>{s.lossWarning}</strong><span>{s.costPerUnitLabel}: ฿{fmtMoney(costBasis)} · {s.sellingPrice}: ฿{fmtMoney(pricing.sellingPrice)} · {s.lossPerUnit}: ฿{fmtMoney(costBasis-pricing.sellingPrice)}</span></div></div>}
   </Section>
  </main>

  <StickySummary className={`rb2-summary ${summaryOpen?'open':''}`}>
   <button type="button" className="summary-toggle" onClick={()=>setSummaryOpen(x=>!x)} aria-label={s.collapse} aria-expanded={summaryOpen}><ChevronDown/></button>
   <div>
    <h2><Coins/>{s.summary}</h2>
    <p className="cost-group">{s.groupDirect}</p>
    <CostRow label={s.ingredientCost} value={cost.ingredientCost}/>
    <CostRow label={s.subCost} value={cost.subRecipeCost}/>
    <CostRow label={s.packagingCost} value={cost.packagingCost}/>
    <p className="cost-group">{s.groupProduction}</p>
    <CostRow label={s.overheadCost} value={cost.overheadCost}/>
    <hr/>
    <CostRow label={s.totalCost} value={cost.totalCost} strong/>
    <p className="cost-group">{s.groupYield}</p>
    <CostRow label={s.totalYield} value={cost.effectiveYield} money={false} suffix={unit}/>
    <CostRow label={`${s.costYield} ${unit}`} value={cost.costPerYieldUnit} decimals/>
    {cost.portionCount!=null&&<><CostRow label={s.portionCount} value={cost.portionCount} money={false} suffix={portionUnit}/><CostRow label={`${s.costPortion} ${portionUnit}`} value={cost.costPerPortion??0} decimals/></>}
    <p className="cost-group">{s.groupPricing}</p>
    <CostRow label={s.sellingPrice} value={pricing.sellingPrice}/>
    <CostRow label={s.profit} value={pricing.profit} tone={pricing.isLoss?'loss':'ok'}/>
    {pricing.isLoss?<div className="cost-row loss"><span>{s.margin}</span><b>{s.lossWarning}</b></div>:<><CostRow label={s.margin} value={pricing.marginPercent} money={false} suffix="%"/><CostRow label={s.markup} value={pricing.markupPercent} money={false} suffix="%"/></>}
    {/* บันทึกอยู่ในสรุปด้วย เพราะปุ่มบนหัวหน้าอยู่ไกลจากจุดที่คนคีย์สูตรทำงานจริง */}
    <div className="summary-save">
     {blockers.length>0
      ? <div className="save-blockers" role="status">
         <p className="sb-head"><AlertTriangle aria-hidden/>{s.blockedCount.replace('{n}',String(blockers.length))}</p>
         <ul>{blockers.map(b=><li key={b.id}><span>{b.message}</span>
          <button type="button" className="btn" onClick={()=>scrollToSection(b.target)}>{s.goFix}</button></li>)}</ul>
        </div>
      : <p className="save-ready" role="status"><Check aria-hidden/>{s.readyToSave}</p>}
     <button className="btn primary summary-save-btn" disabled={busy}>{busy?<Loader2 className="spin"/>:<Save/>}{busy?s.saving:s.save}</button>
    </div>
   </div>
  </StickySummary></div>

  {/* การ์ดตรวจสอบ — โครงเดียวกับ "ตรวจสอบต้นทุน" ในหน้าคำนวณต้นทุน */}
  <section className="reconcile s2-card" id="rb-reconcile" aria-label={s.reconcileTitle}>
   <header className="s2-card-head">
    <div>
     <h2>{s.reconcileTitle}</h2>
     <p>{suspiciousRows.length>0?s.reconcileBad.replace('{n}',String(suspiciousRows.length)):s.reconcileOk}</p>
    </div>
   </header>
   <ul>
    <ReconcileRow okText={s.checkPass} warnText={s.checkWarn} ok={yieldMode==='BATCH'||yieldQty>0} label={s.totalYield} value={yieldMode==='BATCH'?`1 ${s.batchUnit}`:`${fmtQty(yieldQty)} ${unit}`}/>
    {yieldMode!=='BATCH'&&<ReconcileRow okText={s.checkPass} warnText={s.checkWarn} ok={(portionQty??0)>0} label={s.portionSize} value={portionQty?`${fmtQty(portionQty)} ${unit}`:'—'}/>}
    {portionCount!=null&&<ReconcileRow okText={s.checkPass} warnText={s.checkWarn} ok label={s.portionCount} value={`${fmtQty(portionCount)} ${portionUnit||s.portionWord}`}/>}
    <ReconcileRow okText={s.checkPass} warnText={s.checkWarn} ok={rows.some(x=>x.componentType==='ITEM'&&x.itemId)} label={s.ingredients} value={`${rows.filter(x=>x.componentType==='ITEM'&&x.itemId).length} ${s.itemsWord} · ฿${fmtMoney(cost.ingredientCost)}`}/>
    {rows.some(x=>x.componentType==='SUB_RECIPE')&&<ReconcileRow okText={s.checkPass} warnText={s.checkWarn} ok={unresolvedSubRecipes.length===0} label={s.sub} value={`฿${fmtMoney(cost.subRecipeCost)}`}/>}
    {packagingRows.length>0&&<ReconcileRow okText={s.checkPass} warnText={s.checkWarn} ok label={s.packaging} value={`${fmtQty(packagingTotalQty)} ${s.pcsWord} · ฿${fmtMoney(cost.packagingCost)}`}/>}
    <ReconcileRow okText={s.checkPass} warnText={s.checkWarn} ok label={s.overheadCost} value={`฿${fmtMoney(cost.overheadCost)}`}/>
    <ReconcileRow okText={s.checkPass} warnText={s.checkWarn} ok label={s.totalCost} value={`฿${fmtMoney(cost.totalCost)}`} strong/>
    {cost.costPerPortion!=null&&<ReconcileRow okText={s.checkPass} warnText={s.checkWarn} ok label={`${s.costPortion} ${portionUnit||s.portionWord}`} value={`฿${fmtMoney(cost.costPerPortion)}`} strong/>}
   </ul>
   {suspiciousRows.length>0&&<div className="reconcile-warn" role="alert">
    {suspiciousRows.map(w=><p key={w.key}>{s.suspiciousQty.replace('{name}',w.name).replace('{qty}',fmtQty(w.quantity)).replace('{from}',w.fromCode).replace('{to}',w.toCode)}
     <button type="button" className="btn" onClick={()=>patchRow(w.key,{unitId:w.suggestUnitId})}>{s.useSuggested.replace('{to}',w.toCode)}</button></p>)}
   </div>}
  </section>

  <RecipePrint labels={s} companyName={user?.activeCompany?.nameTh??''} recipeName={name} code={code} menuName={menuName}
   versionNo={activeVersion?.versionNo??1} yieldQty={cost.effectiveYield} yieldUnit={unit} portionQty={portionQty} portionUnit={portionUnit}
   rows={rows} items={items} children={children} units={units} conversions={conversions} overhead={overhead} cost={cost} pricing={pricing}/>

  <ConfirmDialog open={dialog==='archive'} title={s.archive} description={s.confirmArchive} confirmLabel={s.archive} onClose={()=>setDialog(null)} onConfirm={()=>void lifecycle('archive')}/>
  <ConfirmDialog open={dialog==='delete'} title={s.remove} tone="danger" description={<label>{s.confirmDelete}<input autoFocus value={deleteText} onChange={e=>setDeleteText(e.target.value)} placeholder={name}/></label>} confirmLabel={s.remove} onClose={()=>setDialog(null)} onConfirm={deleteText===name?()=>void lifecycle('delete'):undefined}/>

  {unitTarget&&<div className="modal-backdrop" role="presentation" onClick={()=>setUnitTarget(null)}><section className="unit-modal" role="dialog" aria-modal="true" aria-labelledby="rb2-add-unit" onClick={e=>e.stopPropagation()}>
   <div className="add-unit-head"><div><p className="eyebrow">UNIT MASTER</p><h2 id="rb2-add-unit">{s.unitModalTitle}</h2></div><button type="button" className="icon-btn" onClick={()=>setUnitTarget(null)} aria-label={s.cancel}><X/></button></div>
   <div className="existing-unit-browser"><strong>หน่วยที่มีอยู่แล้ว</strong>{units.filter(u=>{const q=normalizeUnitText(newUnit.code||newUnit.name);return !q||normalizeUnitText(u.code).includes(q)||normalizeUnitText(u.name).includes(q);}).slice(0,6).map(u=><button type="button" key={u.id} onClick={()=>finishExistingUnit(u)}><span><b>{u.code}</b> — {u.name}</span><small>ใช้หน่วยนี้</small></button>)}</div>
   <label>{s.newUnitName}<input autoFocus value={newUnit.name} onChange={e=>setNewUnit(u=>({...u,name:e.target.value}))} placeholder="เช่น มิลลิลิตร"/></label>
   <label>{s.newUnitCode}<input value={newUnit.code} onChange={e=>setNewUnit(u=>({...u,code:e.target.value}))} placeholder="เช่น ml"/></label>
   <div className="modal-actions"><button type="button" className="btn" onClick={()=>setUnitTarget(null)}>{s.cancel}</button><button type="button" className="btn primary" onClick={()=>void saveUnit()} disabled={savingUnit}>{savingUnit?<Loader2 className="spin"/>:<Plus/>}{s.add}</button></div>
  </section></div>}

  {itemTarget&&<div className="modal-backdrop" role="presentation" onClick={()=>setItemTarget(null)}><section className="unit-modal" role="dialog" aria-modal="true" aria-labelledby="rb2-add-item" onClick={e=>e.stopPropagation()}>
   <div className="add-unit-head"><div><p className="eyebrow">{itemTarget.type==='PACKAGING'?'PACKAGING':'INGREDIENT'}</p><h2 id="rb2-add-item">{s.itemModalTitle}</h2></div><button type="button" className="icon-btn" onClick={()=>setItemTarget(null)} aria-label={s.cancel}><X/></button></div>
   <label>{s.newItemName}<input autoFocus value={newItem.name} onChange={e=>setNewItem(u=>({...u,name:e.target.value}))}/></label>
   <label>{s.newItemBaseUnit}<select value={newItem.baseUnitId} onChange={e=>setNewItem(u=>({...u,baseUnitId:e.target.value}))}>{units.map(x=><option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}</select></label>
   <label>{s.newItemPrice}<input type="number" min="0" step="any" value={newItem.price} onChange={e=>setNewItem(u=>({...u,price:+e.target.value}))}/></label>
   <div className="modal-actions"><button type="button" className="btn" onClick={()=>setItemTarget(null)}>{s.cancel}</button><button type="button" className="btn primary" onClick={()=>void saveItem()} disabled={savingItem}>{savingItem?<Loader2 className="spin"/>:<Plus/>}{s.add}</button></div>
  </section></div>}
  </form>
 </PageContainer>;
}

/** แถบหัวข้อ — เดสก์ท็อปเป็นชิปเรียงติดด้านบน มือถือเป็น select "ไปยังหัวข้อ"
 *  ไม่ใช่ wizard: กดข้ามไปหัวข้อไหนก็ได้ ทุกหัวข้อยังแก้ได้อิสระตลอดเวลา */
function SectionNav({labels:L}:{labels:Labels}){
 const [active,setActive]=useState<SectionId>('info');
 useEffect(()=>{
  const els=SECTION_IDS.map(x=>document.getElementById(`rb-${x}`)).filter(Boolean) as HTMLElement[];
  if(!els.length||!('IntersectionObserver' in window))return;
  const io=new IntersectionObserver(entries=>{
   const seen=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
   if(seen)setActive(seen.target.id.replace('rb-','') as SectionId);
  },{rootMargin:'-30% 0px -60% 0px',threshold:[0,.25,.5,1]});
  els.forEach(e=>io.observe(e));
  return ()=>io.disconnect();
 },[]);
 const titleOf=(x:SectionId)=>({info:L.info,yield:L.yield,ingredients:L.ingredients,sub:L.sub,packaging:L.packaging,overhead:L.overhead,price:L.price})[x];
 return <nav className="rb-sectionnav" aria-label={L.sectionsLabel}>
  <ul className="rb-sectionnav-chips">
   {SECTION_IDS.map(x=><li key={x}>
    <button type="button" className={active===x?'active':''} aria-current={active===x?'true':undefined} onClick={()=>scrollToSection(x)}>{titleOf(x)}</button>
   </li>)}
  </ul>
  <label className="rb-sectionnav-select">
   <span>{L.jumpTo}</span>
   <select value={active} onChange={e=>scrollToSection(e.target.value as SectionId)}>
    {SECTION_IDS.map(x=><option key={x} value={x}>{titleOf(x)}</option>)}
   </select>
  </label>
 </nav>;
}

/** แถวรายการตรวจ — ใช้ไอคอน + ข้อความสถานะ ไม่สื่อด้วยสีอย่างเดียว */
function ReconcileRow({ok,label,value,strong,okText,warnText}:{ok:boolean;label:string;value:string;strong?:boolean;okText:string;warnText:string}){
 return <li className={`${ok?'ok':'bad'}${strong?' strong':''}`}>
  <span className="rc-icon" aria-hidden>{ok?<Check/>:<AlertTriangle/>}</span>
  <b>{label}</b>
  <em>{value}</em>
  <span className="rc-state">{ok?okText:warnText}</span>
 </li>;
}

function Section({id,badge,icon,title,desc,subtotal,action,children}:{id?:SectionId;badge:string;icon:ReactNode;title:string;desc?:string;subtotal?:number;action?:ReactNode;children:ReactNode}){
 // tabIndex -1 เพื่อให้ scrollToSection โฟกัสได้ ผู้ใช้คีย์บอร์ดจึงรู้ว่าย้ายมาถึงหัวข้อไหน
 return <section className="rb2-section" id={id?`rb-${id}`:undefined} tabIndex={id?-1:undefined} aria-labelledby={id?`rb-${id}-title`:undefined}>
  <header className="section-head">
   <span className="section-badge" aria-hidden>{badge}</span>
   <span className="section-icon" aria-hidden>{icon}</span>
   <div className="section-titles"><h2 id={id?`rb-${id}-title`:undefined}>{title}</h2>{desc&&<p>{desc}</p>}</div>
   {subtotal!=null&&<span className="section-subtotal">฿{fmtMoney(subtotal)}</span>}
   {action}
  </header>
  {children}
 </section>;
}

function CostRow({label,value,strong,suffix='฿',money:asMoney=true,decimals=false,tone}:{label:string;value:number;strong?:boolean;suffix?:string;money?:boolean;decimals?:boolean;tone?:'ok'|'loss'}){
 const text=asMoney?`฿${fmtMoney(value)}`:`${decimals?fmtCost(value):fmtQty(value)} ${suffix}`;
 return <div className={`cost-row ${strong?'strong':''} ${tone==='loss'?'loss':''}`}><span>{label}</span><b>{text}</b></div>;
}

// ----- ingredient / sub-recipe / packaging section (card rows) -----
function ComponentSection({id,kind,badge,icon,title,desc,button,subtotal,rows,items,children,units,conversions,labels,canCreateMaster,onAdd,onPatch,onRemove,onCreateUnit,onCreateItem,onSetupConversion,onUseAsBatch}:{
 id?:SectionId;kind:Row['componentType'];badge:string;icon:ReactNode;title:string;desc:string;button:string;subtotal:number;
 rows:Row[];items:Item[];children:SelectableSubRecipe[];units:Unit[];conversions:UnitConversion[];labels:Labels;canCreateMaster:boolean;
 onAdd:(t:Row['componentType'])=>void;onPatch:(k:string,p:Partial<Row>)=>void;onRemove:(k:string)=>void;
 onCreateUnit:(t:UnitTarget,q:string)=>void;onCreateItem:(t:ItemTarget)=>void;onSetupConversion:()=>void;onUseAsBatch:(childId:string)=>void;
}){
 const L=labels;const visible=rows.filter(x=>x.componentType===kind);
 const action=<button type="button" className="btn add-component" onClick={()=>onAdd(kind)}><Plus/>{button}</button>;
 return <Section id={id} badge={badge} icon={icon} title={title} desc={desc} subtotal={subtotal} action={action}>
  <div className="component-list">
   {/* หัวคอลัมน์ครั้งเดียวต่อ section — เดิมทุกแถวพก label ของตัวเองจึงอ่านเหมือนฟอร์มซ้ำ ๆ ไม่ใช่ตารางต้นทุน */}
   {visible.length>0&&<div className="component-cols" aria-hidden>
    <span>{kind==='SUB_RECIPE'?L.sub:L.colProduct}</span>
    <span>{L.quantity}</span>
    <span>{L.unit}</span>
    <span>{L.waste}</span>
    <span>{L.colConversion}</span>
    {/* ช่องสุดท้ายรวมต้นทุนกับปุ่มจัดการ เพราะในแถวจริงทั้งสองอยู่ใน .row-end ก้อนเดียว */}
    <span className="col-cost">{L.usedCost}</span>
   </div>}
   {visible.length===0&&<p className="empty">{L.empty}</p>}
   {visible.map(r=>kind==='SUB_RECIPE'
    ? <SubRecipeRow key={r.key} r={r} children={children} units={units} conversions={conversions} labels={L} canCreateMaster={canCreateMaster} onPatch={onPatch} onRemove={onRemove} onCreateUnit={onCreateUnit} onSetupConversion={onSetupConversion} onUseAsBatch={onUseAsBatch}/>
    : <ItemRow key={r.key} r={r} kind={kind} items={items} units={units} conversions={conversions} labels={L} canCreateMaster={canCreateMaster} onPatch={onPatch} onRemove={onRemove} onCreateUnit={onCreateUnit} onCreateItem={onCreateItem}/>
   )}
  </div>
 </Section>;
}

function ItemRow({r,kind,items,units,conversions,labels,canCreateMaster,onPatch,onRemove,onCreateUnit,onCreateItem}:{
 r:Row;kind:'ITEM'|'PACKAGING';items:Item[];units:Unit[];conversions:UnitConversion[];labels:Labels;canCreateMaster:boolean;
 onPatch:(k:string,p:Partial<Row>)=>void;onRemove:(k:string)=>void;onCreateUnit:(t:UnitTarget,q:string)=>void;onCreateItem:(t:ItemTarget)=>void;
}){
 const L=labels;const item=items.find(x=>x.id===r.itemId);const [showHelper,setShowHelper]=useState(false);
 const unitCodeOf=(id:string|null|undefined)=>units.find(u=>u.id===id)?.code??'';
 const conv=rowConversion(item,r.quantity,r.unitId,conversions,unitCodeOf);
 const missing=Boolean(conv&&conv.converted==null);
 const lineCost=componentCost(r,new Map(items.map(x=>[x.id,x])),new Map(),conversions);
 // เฉพาะหน่วยที่ใช้กับวัตถุดิบนี้ได้จริง (ฐาน → หน่วยซื้อ → หน่วยที่แปลงถึงฐานได้) — ไม่แสดงหน่วยที่ไม่เกี่ยวข้อง
 const allowed=useMemo(()=>allowedUnitsForItem(item,units,conversions),[item,units,conversions]);
 const unitOptions=allowed.map(u=>{
  const isBase=u.id===item?.baseUnitId;
  const perOne=isBase?1:itemBaseQty(item,1,u.id,conversions);
  return {value:u.id,label:u.code,sublabel:isBase?`${u.name} · ${L.baseUnitTag}`:perOne!=null?`${u.name} · 1 ${u.code} = ${fmtQty(perOne)} ${item?.baseUnit?.code??''}`:u.name};
 });
 // แถวที่โหลดมาแล้วหน่วยใช้ไม่ได้ (เช่นค้างจาก item เดิม) → กลับไปใช้หน่วยฐานของ item นี้ทันที
 useEffect(()=>{
  if(!item)return;
  if(!r.unitId||!isUnitUsableForItem(item,r.unitId,conversions)){
   const fallback=defaultUnitForItem(item);
   if(fallback&&fallback!==r.unitId)onPatch(r.key,{unitId:fallback});
  }
 },[item,r.unitId,r.key,conversions,onPatch]);
 return <article className="component-row" data-row-key={r.key}>
  <div className="row-main">
   <span className="row-icon" aria-hidden>{kind==='PACKAGING'?<Package/>:<Utensils/>}</span>
   <div className="row-picker">
    <CreatableCombobox ariaLabel={kind==='PACKAGING'?L.selectPackaging:L.selectItem} value={r.itemId??''} onChange={v=>onPatch(r.key,{itemId:v,unitId:defaultUnitForItem(items.find(x=>x.id===v))})}
     placeholder={kind==='PACKAGING'?L.selectPackaging:L.selectItem} searchPlaceholder={L.search}
     options={items.map(x=>({value:x.id,label:x.name,sublabel:`${x.code} · ฿${fmtCost(x.lastCost)}/${x.baseUnit?.code??''}`}))}
     createLabel={canCreateMaster?(kind==='PACKAGING'?L.addPackagingNew:L.addItemNew):undefined}
     onCreate={canCreateMaster?(q=>onCreateItem({type:kind,rowKey:r.key,name:q})):undefined}/>
    {item&&<small className="row-sub">{item.code} · ฿{fmtCost(item.lastCost)}/{item.baseUnit?.code}</small>}
   </div>
  </div>
  <div className="row-inputs">
   <label>{L.quantity}<input type="number" min="0" step="any" value={r.quantity} onChange={e=>onPatch(r.key,{quantity:+e.target.value})}/></label>
   <label className="unit-field">{L.unit}<div className="unit-combo"><CreatableCombobox ariaLabel={L.unit} value={r.unitId??''} onChange={v=>onPatch(r.key,{unitId:v})} placeholder={L.selectUnit} searchPlaceholder={L.search}
    options={unitOptions} createLabel={canCreateMaster?L.addUnit:undefined} onCreate={canCreateMaster?(q=>onCreateUnit({kind:'ingredientUnit',rowKey:r.key},q)):undefined}/></div></label>
   <label>{L.waste}<input type="number" min="0" max="100" step="0.01" value={r.wastePercent} onChange={e=>onPatch(r.key,{wastePercent:+e.target.value})}/></label>
  </div>
  {/* การแปลงหน่วยและราคาต่อหน่วยแสดงตรง ๆ ในแถว ไม่ต้องกดเปิดดู
      ถ้าหน่วยเดียวกันอยู่แล้วก็ไม่ต้องเตือนอะไร แค่บอกว่าไม่ต้องแปลง */}
  <div className="row-conv">
   {item
    ? missing
      ? <span className="conv-missing"><AlertTriangle aria-hidden/>{L.noConversion}</span>
      : <>
         <span className="conv-eq">{conv?.equation??L.identityConv}</span>
         <span className="conv-price">฿{fmtCost(pricePerUnit(item,r.unitId,conversions)??0)}/{unitCodeOf(r.unitId)||item.baseUnit?.code}</span>
        </>
    : <span className="conv-eq muted">—</span>}
  </div>
  <div className="row-end">
   {item&&<button type="button" className="conv-toggle" onClick={()=>setShowHelper(v=>!v)} aria-expanded={showHelper}>{showHelper?L.hideConversion:L.showConversion}</button>}
   <div className="line-price"><small>{L.usedCost}</small><strong>฿{fmtMoney(lineCost)}</strong></div>
   <button type="button" className="icon-btn" onClick={()=>onRemove(r.key)} aria-label={L.remove}><Trash2/></button>
  </div>
    {item&&showHelper&&<div className="unit-helper-panel price-panel">
   <div><p className="uh-title">{L.purchasePriceLabel}</p><span>฿{fmtCost(pricePerUnit(item,item.purchaseUnitId??item.baseUnitId,conversions)??0)} / {item.purchaseUnit?.code??item.baseUnit?.code}</span></div>
   <div><p className="uh-title">{L.usedInRecipe}</p><span>{fmtQty(r.quantity)} {unitCodeOf(r.unitId)||item.baseUnit?.code}</span></div>
   <div><p className="uh-title">{L.equationUsed}</p><span>{conv?.equation??`1 ${item.baseUnit?.code??''} = 1 ${item.baseUnit?.code??''}`}</span></div>
   <div><p className="uh-title">{L.pricePerUnitLabel} {unitCodeOf(r.unitId)||item.baseUnit?.code}</p><span>฿{fmtCost(pricePerUnit(item,r.unitId,conversions)??0)}</span></div>
   <div><p className="uh-title">{L.usedCost}</p><span>฿{fmtMoney(lineCost)}</span></div>
  </div>}
  {missing&&<div className="rb-callout warn" role="alert">
   <AlertTriangle aria-hidden/>
   <div><strong>{L.noConversion}</strong></div>
   <Link to="/units/conversions" className="btn"><Settings2 width={14}/>{L.setupConversion}</Link>
  </div>}
 </article>;
}

function SubRecipeRow({r,children,units,conversions,labels,canCreateMaster,onPatch,onRemove,onCreateUnit,onSetupConversion,onUseAsBatch}:{
 r:Row;children:SelectableSubRecipe[];units:Unit[];conversions:UnitConversion[];labels:Labels;canCreateMaster:boolean;
 onPatch:(k:string,p:Partial<Row>)=>void;onRemove:(k:string)=>void;onCreateUnit:(t:UnitTarget,q:string)=>void;onSetupConversion:()=>void;onUseAsBatch:(childId:string)=>void;
}){
 const L=labels;const child=children.find(x=>x.id===r.childRecipeId);
 // BATCH = คิดเป็นจำนวนสูตร · unknown = ยังไม่เลือกโหมด (ต้องให้ผู้ใช้ตัดสินใจก่อน ไม่เดาหน่วย)
 const childMode=effectiveYieldMode(child);
 const isBatch=childMode==='BATCH';
 const unknownYield=Boolean(child&&childMode===null);
 const compatible=child?compatibleUnitIds(child.yieldUnitId,conversions):new Set<string>();
 const unitOptions=units.filter(u=>compatible.has(u.id)).map(u=>{const factor=child?.yieldUnitId?unitFactor(u.id,child.yieldUnitId,conversions):null;return{value:u.id,label:u.name,sublabel:`${u.code}${factor==null?'':` · 1 ${u.code} = ${fmtQty(factor)} ${child?.yieldUnit??''}`}`};});
 const canonical=subRecipeCanonicalQty(r.quantity,r.unitId,child,conversions);
 const incompatible=child!=null&&r.unitId!=null&&canonical==null;
 const lineCost=child&&canonical!=null?money(child.unitCost*canonical*(1+r.wastePercent/100)):0;
 return <article className="component-row sub-row" data-row-key={r.key}>
  <div className="row-main">
   <span className="row-icon sub-icon" aria-hidden><Beaker/></span>
   <div className="row-picker">
    <span className="sub-badge">{L.subBadge}</span>
    <CreatableCombobox ariaLabel={L.selectSub} value={r.childRecipeId??''} onChange={v=>{const c=children.find(x=>x.id===v);onPatch(r.key,{childRecipeId:v,unitId:c?.yieldUnitId??null});}}
     placeholder={L.selectSub} searchPlaceholder={L.search}
     options={children.map(x=>({value:x.id,label:x.name,sublabel:x.yieldUnitId?`${L.yieldWord} ${fmtQty(x.yieldQty)} ${x.yieldUnit??''} · ฿${fmtCost(x.unitCost)}/${x.yieldUnit??''}`:'สูตรย่อยนี้ยังไม่ได้กำหนดหน่วยผลผลิต'}))}/>
    {child&&child.yieldUnitId&&<small className="row-sub"><b>ผลผลิต:</b> {fmtQty(child.yieldQty)} {child.yieldUnit}<br/><b>ต้นทุนต่อหน่วย:</b> ฿{fmtCost(child.unitCost)} / {child.yieldUnit}</small>}
   </div>
  </div>
  <div className="row-inputs">
   <label>{L.quantity}<input type="number" min="0" step="any" value={r.quantity} onChange={e=>onPatch(r.key,{quantity:+e.target.value})}/></label>
   <label className="unit-field">{L.unit}
    {isBatch
     ? <div className="batch-unit" aria-label={L.unit}><span className="batch-chip">{L.batchUnit}</span></div>
     : <div className="unit-combo"><CreatableCombobox ariaLabel={L.unit} value={r.unitId??''} onChange={v=>onPatch(r.key,{unitId:v})}
        placeholder={unknownYield?L.unknownYield:L.selectUnit} searchPlaceholder={L.search}
        disabled={unknownYield}
        emptyText={unknownYield?L.unknownYield:L.noCompatibleUnit}
        options={unitOptions}
        // หน่วยที่มีอยู่แล้วแต่ยังแปลงไม่ได้ → เสนอ "ตั้งค่าอัตราแปลง" ไม่ใช่ให้สร้างหน่วยซ้ำ
        resolveExisting={q=>{const hit=findExistingUnit(units,q,q);if(!hit||compatible.has(hit.id))return null;return{label:`${hit.code} — ${hit.name}`,hint:L.needConversion,onUse:()=>onSetupConversion()};}}
        reuseLabel={L.setupConversion}
        createLabel={canCreateMaster&&!unknownYield?L.addUnit:undefined}
        onCreate={canCreateMaster&&!unknownYield?(q=>onCreateUnit({kind:'subUnit',rowKey:r.key},q)):undefined}/></div>}
    <small className="field-hint">{isBatch?L.batchHint:unknownYield?L.unknownYield:`${L.unitHelperSub} ${child?.yieldUnit??''}`}</small>
   </label>
   <label>{L.waste}<input type="number" min="0" max="100" step="0.01" value={r.wastePercent} onChange={e=>onPatch(r.key,{wastePercent:+e.target.value})}/></label>
  </div>
  {/* สถานะผลผลิตของสูตรย่อย: จริง / 1 รอบการผลิต / ยังไม่กำหนด — ไม่แปลงข้าม Batch ให้เด็ดขาด */}
  <div className="row-conv">
   {child
    ? unknownYield
      ? <span className="conv-missing"><AlertTriangle aria-hidden/>{L.unknownYield}</span>
      : isBatch
        ? <span className="conv-eq">{L.batchUnit} · ฿{fmtCost(child.unitCost)}</span>
        : <span className="conv-eq">{fmtQty(child.yieldQty)} {child.yieldUnit} · ฿{fmtCost(child.unitCost)}/{child.yieldUnit}</span>
    : <span className="conv-eq muted">—</span>}
  </div>
  <div className="row-end">
   <div className="line-price"><small>{L.usedCost}</small><strong>฿{fmtMoney(lineCost)}</strong></div>
   <button type="button" className="icon-btn" onClick={()=>onRemove(r.key)} aria-label={L.remove}><Trash2/></button>
  </div>
  {incompatible&&<div className="rb-callout warn" role="alert">
   <AlertTriangle aria-hidden/>
   <div><strong>{L.incompatibleUnit}</strong></div>
   <Link to="/units/conversions" className="btn"><Settings2 width={14}/>{L.setupConversion}</Link>
  </div>}
  {unknownYield&&child&&<div className="rb-callout warn yield-choice" role="alert">
   <AlertTriangle aria-hidden/>
   <div><strong>{L.unknownYieldLong}</strong></div>
   <div className="yield-choice-actions">
    <button type="button" className="btn" onClick={()=>onUseAsBatch(child.id)}>{L.useAsBatch}</button>
    <Link to={`/recipes/${child.id}`} className="btn primary">{L.setActualYield}</Link>
   </div>
  </div>}
  {isBatch&&r.unitId&&<div className="rb-callout warn" role="alert">
   <AlertTriangle aria-hidden/>
   <div><strong>{L.batchNotConvertible}</strong></div>
   <Link to={`/recipes/${child!.id}`} className="btn"><Settings2 width={14}/>{L.setActualYield}</Link>
  </div>}
 </article>;
}

// ----- print-only detailed cost sheet (PART 20-28) -----
function RecipePrint({labels:L,companyName,recipeName,code,menuName,versionNo,yieldQty,yieldUnit,portionQty,portionUnit,rows,items,children,units,conversions,overhead,cost,pricing}:{
 labels:Labels;companyName:string;recipeName:string;code:string;menuName:string;versionNo:number;yieldQty:number;yieldUnit:string;portionQty:number|null;portionUnit:string;
 rows:Row[];items:Item[];children:SelectableSubRecipe[];units:Unit[];conversions:UnitConversion[];overhead:RecipeOverhead;cost:RecipeDraftCost;pricing:{sellingPrice:number;profit:number;marginPercent:number;markupPercent:number;isLoss:boolean};
}){
 const itemMap=new Map(items.map(x=>[x.id,x]));
 const unitCode=(unitId:string|null|undefined,fallback:string|null)=>units.find(u=>u.id===unitId)?.code??fallback??'';
 const ingredientRows=rows.filter(x=>x.componentType==='ITEM');
 const packagingRows=rows.filter(x=>x.componentType==='PACKAGING');
 const subRows=rows.filter(x=>x.componentType==='SUB_RECIPE');
 const itemLine=(r:Row)=>{const it=itemMap.get(r.itemId??'');return{name:it?.name??'—',qty:r.quantity,unit:it?.baseUnit?.code??'',waste:r.wastePercent,price:it?.lastCost??0,cost:componentCost(r,itemMap,new Map(),conversions)};};
 const methodLabel=overhead.mode==='TOTAL'?L.methodTotal:overhead.mode==='PERCENTAGE'?L.methodPercent:L.methodDetailed;
 return <div className="rb2-print" aria-hidden>
  <div className="print-head">
   <div><h1>{L.printTitle}</h1><p>{recipeName||menuName} {code&&<span>· {code}</span>}</p></div>
   <table className="print-meta"><tbody>
    <tr><th>{L.company}</th><td>{companyName||'—'}</td><th>{L.menu}</th><td>{menuName||'—'}</td></tr>
    <tr><th>{L.version}</th><td>v{versionNo}</td><th>{L.date}</th><td>{new Date().toLocaleDateString('th-TH')}</td></tr>
    <tr><th>{L.totalYield}</th><td>{fmtQty(yieldQty)} {yieldUnit}</td><th>{L.portionSize}</th><td>{portionQty?`${fmtQty(portionQty)} ${portionUnit||''}`:'—'}</td></tr>
   </tbody></table>
  </div>

  {ingredientRows.length>0&&<><h2>{L.ingredients}</h2><table className="print-table"><thead><tr><th>{L.seq}</th><th className="l">{L.colItem}</th><th>{L.colQty}</th><th>{L.colUnit}</th><th>{L.colWaste}</th><th>{L.colUnitPrice}</th><th>{L.colLineCost}</th></tr></thead><tbody>
   {ingredientRows.map((r,i)=>{const v=itemLine(r);return <tr key={r.key}><td>{i+1}</td><td className="l">{v.name}</td><td>{fmtQty(v.qty)}</td><td>{v.unit}</td><td>{fmtPercent(v.waste)}%</td><td>฿{fmtCost(v.price)}</td><td>฿{fmtMoney(v.cost)}</td></tr>;})}
  </tbody><tfoot><tr><td colSpan={6} className="l">{L.ingredientCost}</td><td>฿{fmtMoney(cost.ingredientCost)}</td></tr></tfoot></table></>}

  {subRows.length>0&&<><h2>{L.sub}</h2><table className="print-table"><thead><tr><th>{L.seq}</th><th className="l">{L.colItem}</th><th>{L.printSubYield}</th><th>{L.colQty}</th><th>{L.colUnit}</th><th>{L.colUnitPrice}</th><th>{L.colLineCost}</th></tr></thead><tbody>
   {subRows.map((r,i)=>{const c=children.find(x=>x.id===r.childRecipeId);const canon=subRecipeCanonicalQty(r.quantity,r.unitId,c,conversions);const lc=c&&canon!=null?money(c.unitCost*canon*(1+r.wastePercent/100)):0;const uCode=unitCode(r.unitId,c?.yieldUnit??null);return <tr key={r.key}><td>{i+1}</td><td className="l">{c?.name??'—'}</td><td>{c?`${fmtQty(c.yieldQty)} ${c.yieldUnit??''}`:'—'}</td><td>{fmtQty(r.quantity)}</td><td>{uCode}</td><td>฿{fmtCost(c?.unitCost??0)}</td><td>฿{fmtMoney(lc)}</td></tr>;})}
  </tbody><tfoot><tr><td colSpan={6} className="l">{L.subCost}</td><td>฿{fmtMoney(cost.subRecipeCost)}</td></tr></tfoot></table></>}

  {packagingRows.length>0&&<><h2>{L.packaging}</h2><table className="print-table"><thead><tr><th>{L.seq}</th><th className="l">{L.colItem}</th><th>{L.colQty}</th><th>{L.colUnit}</th><th>{L.colUnitPrice}</th><th>{L.colLineCost}</th></tr></thead><tbody>
   {packagingRows.map((r,i)=>{const v=itemLine(r);return <tr key={r.key}><td>{i+1}</td><td className="l">{v.name}</td><td>{fmtQty(v.qty)}</td><td>{v.unit}</td><td>฿{fmtCost(v.price)}</td><td>฿{fmtMoney(v.cost)}</td></tr>;})}
  </tbody><tfoot><tr><td colSpan={5} className="l">{L.packagingCost}</td><td>฿{fmtMoney(cost.packagingCost)}</td></tr></tfoot></table></>}

  <h2>{L.overhead}</h2>
  <div className="print-overhead">
   <p><strong>{L.printMethod}:</strong> {methodLabel}</p>
   {overhead.mode==='TOTAL'&&<p>{L.totalExpense}: ฿{fmtMoney(overhead.total??0)}</p>}
   {overhead.mode==='PERCENTAGE'&&<p>{L.printBase}: {overhead.base==='INGREDIENT'?L.ingredientCost:'Direct'} · ฿{fmtMoney(overhead.base==='INGREDIENT'?cost.ingredientCost:cost.ingredientCost+cost.subRecipeCost+cost.packagingCost)} × {fmtPercent(overhead.percent??0)}% = ฿{fmtMoney(cost.overheadCost)}</p>}
   {overhead.mode==='DETAILED'&&<table className="print-table"><tbody>{(overhead.details??[]).map((d,i)=><tr key={i}><td className="l">{d.label||'—'}</td><td>฿{fmtMoney(d.amount)}</td></tr>)}<tr><td className="l"><strong>{L.overheadCost}</strong></td><td><strong>฿{fmtMoney(cost.overheadCost)}</strong></td></tr></tbody></table>}
  </div>

  <h2>{L.summary}</h2>
  <table className="print-summary"><tbody>
   <tr><td>{L.ingredientCost}</td><td>฿{fmtMoney(cost.ingredientCost)}</td></tr>
   <tr><td>{L.subCost}</td><td>฿{fmtMoney(cost.subRecipeCost)}</td></tr>
   <tr><td>{L.packagingCost}</td><td>฿{fmtMoney(cost.packagingCost)}</td></tr>
   <tr><td>{L.overheadCost}</td><td>฿{fmtMoney(cost.overheadCost)}</td></tr>
   <tr className="grand"><td>{L.totalCost}</td><td>฿{fmtMoney(cost.totalCost)}</td></tr>
   <tr><td>{L.costYield} {yieldUnit}</td><td>฿{fmtCost(cost.costPerYieldUnit)}</td></tr>
   {cost.costPerPortion!=null&&<tr><td>{L.costPortion} {portionUnit||'portion'}</td><td>฿{fmtMoney(cost.costPerPortion)}</td></tr>}
   <tr><td>{L.sellingPrice}</td><td>฿{fmtMoney(pricing.sellingPrice)}</td></tr>
   <tr className={pricing.isLoss?'loss':''}><td>{L.profit}</td><td>฿{fmtMoney(pricing.profit)}{pricing.isLoss?` · ${L.lossWarning}`:''}</td></tr>
   <tr><td>{L.margin} / {L.markup}</td><td>{fmtPercent(pricing.marginPercent)}% / {fmtPercent(pricing.markupPercent)}%</td></tr>
  </tbody></table>
 </div>;
}
