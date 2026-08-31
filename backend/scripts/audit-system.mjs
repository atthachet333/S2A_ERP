import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const target=process.argv.find(x=>x.startsWith('--target='))?.split('=')[1];
const companyId=process.argv.find(x=>x.startsWith('--company='))?.split('=')[1];
if(!['test','production'].includes(target))throw new Error('Use --target=test or --target=production');
dotenv.config({path:fileURLToPath(new URL(target==='test'?'../.env.test':'../.env',import.meta.url)),override:true});
const url=target==='test'?process.env.TEST_DATABASE_URL:process.env.DATABASE_URL;
const expected=target==='test'?'s2a_erp_test':'s2a_erp_main';
if(!url||new URL(url).pathname.replace(/^\//,'')!==expected)throw new Error(`Refusing audit: expected ${expected}`);
const db=new PrismaClient({datasources:{db:{url}}});
const safeCompany=companyId?.replace(/[^a-zA-Z0-9_-]/g,'');
const companyItem=safeCompany?` AND i.companyId='${safeCompany}'`:'';
const checks=[
 ['duplicate_logical_balances',`SELECT itemId,warehouseId,locationKey,lotKey,COUNT(*) count FROM stock_balances GROUP BY itemId,warehouseId,locationKey,lotKey HAVING COUNT(*)>1`],
 ['invalid_balance_quantities',`SELECT b.id,b.itemId,b.warehouseId,b.onHand,b.reserved FROM stock_balances b JOIN items i ON i.id=b.itemId WHERE (b.onHand<0 OR b.reserved<0 OR b.reserved>b.onHand)${companyItem}`],
 ['ledger_balance_mismatch',`SELECT b.id,b.itemId,b.warehouseId,b.onHand,COALESCE(SUM(l.qtyIn-l.qtyOut),0) expected FROM stock_balances b JOIN items i ON i.id=b.itemId LEFT JOIN stock_ledgers l ON l.itemId=b.itemId AND l.warehouseId=b.warehouseId AND (l.locationId<=>b.locationId) AND (l.lotId<=>b.lotId) WHERE 1=1${companyItem} GROUP BY b.id,b.itemId,b.warehouseId,b.onHand HAVING ABS(b.onHand-expected)>0.0001`],
 ['cross_company_stock',`SELECT b.id FROM stock_balances b JOIN items i ON i.id=b.itemId JOIN warehouses w ON w.id=b.warehouseId WHERE i.companyId<>w.companyId${companyItem}`],
 ['lot_item_mismatch',`SELECT b.id,b.lotId,b.itemId,l.itemId lotItemId FROM stock_balances b JOIN inventory_lots l ON l.id=b.lotId JOIN items i ON i.id=b.itemId WHERE b.itemId<>l.itemId${companyItem}`],
 ['draft_documents_with_ledgers',`SELECT l.id,l.refType,l.refId FROM stock_ledgers l LEFT JOIN goods_receipts gr ON l.refType='GOODS_RECEIPT' AND gr.id=l.refId LEFT JOIN stock_issues si ON l.refType='STOCK_ISSUE' AND si.id=l.refId LEFT JOIN stock_transfers st ON l.refType='STOCK_TRANSFER' AND st.id=l.refId LEFT JOIN stock_adjustments sa ON l.refType='STOCK_ADJUSTMENT' AND sa.id=l.refId LEFT JOIN production_orders pr ON l.refType='PRODUCTION_RUN' AND pr.id=l.refId WHERE gr.status='DRAFT' OR si.status='DRAFT' OR st.status='DRAFT' OR sa.status='DRAFT' OR pr.status='DRAFT'`],
 ['duplicate_document_numbers',`SELECT companyId,kind,docNo,COUNT(*) count FROM (SELECT companyId,'GR' kind,receiptNo docNo FROM goods_receipts UNION ALL SELECT companyId,'RI',issueNo FROM stock_issues UNION ALL SELECT companyId,'TR',transferNo FROM stock_transfers UNION ALL SELECT companyId,'AJ',adjustmentNo FROM stock_adjustments UNION ALL SELECT companyId,'PR',orderNo FROM production_orders UNION ALL SELECT companyId,'PP',planNo FROM purchase_plans UNION ALL SELECT companyId,'PO',poNo FROM purchase_orders) d GROUP BY companyId,kind,docNo HAVING COUNT(*)>1`],
 ['receipt_po_company_mismatch',`SELECT gr.id,gr.purchaseOrderId FROM goods_receipts gr JOIN purchase_orders po ON po.id=gr.purchaseOrderId WHERE gr.companyId<>po.companyId`],
 ['invalid_recipe_yield',`SELECT rv.id,rv.recipeId,rv.yieldMode,rv.standardYieldQty,rv.yieldUnitId FROM recipe_versions rv JOIN recipes r ON r.id=rv.recipeId WHERE rv.standardYieldQty<=0 OR (rv.yieldMode='ACTUAL' AND rv.yieldUnitId IS NULL) OR (rv.yieldMode='BATCH' AND rv.yieldUnitId IS NOT NULL)${safeCompany?` AND r.companyId='${safeCompany}'`:''}`],
 ['duplicate_recipe_lines',`SELECT recipeVersionId,COALESCE(itemId,'NULL') itemId,COALESCE(childRecipeId,'NULL') childRecipeId,componentType,COUNT(*) count FROM recipe_ingredients GROUP BY recipeVersionId,itemId,childRecipeId,componentType HAVING COUNT(*)>1`],
 ['invalid_cost_history',`SELECT h.id,h.itemId,h.price,h.source FROM item_price_history h JOIN items i ON i.id=h.itemId WHERE h.price<0${companyItem}`],
];
let failures=0;
try{
 const selected=(await db.$queryRawUnsafe('SELECT DATABASE() db'))[0]?.db;
 if(selected!==expected)throw new Error(`Connected to ${selected}, expected ${expected}`);
 console.log(JSON.stringify({audit:'S2A_SYSTEM_INTEGRITY',target,database:selected,company:companyId??'ALL'}));
 for(const[name,sql]of checks){const rows=await db.$queryRawUnsafe(sql);const status=rows.length?'MISMATCH':'MATCH';if(rows.length)failures++;console.log(JSON.stringify({check:name,status,count:rows.length,sample:rows.slice(0,10)},(_,v)=>typeof v==='bigint'?Number(v):v));}
}finally{await db.$disconnect()}
if(failures){console.error(`Integrity audit failed: ${failures} check(s) reported mismatches`);process.exitCode=2}else console.log('Integrity audit passed');
