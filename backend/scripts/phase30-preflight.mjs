import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const target=process.argv.find(arg=>arg.startsWith('--target='))?.split('=')[1];
if(!['test','production'].includes(target))throw new Error('Use --target=test or --target=production');
const envPath=fileURLToPath(new URL(target==='test'?'../.env.test':'../.env',import.meta.url));dotenv.config({path:envPath,override:true});
const url=target==='test'?process.env.TEST_DATABASE_URL:process.env.DATABASE_URL;const expected=target==='test'?'s2a_erp_test':'s2a_erp_main';if(!url)throw new Error('Database URL is required');
const configured=new URL(url).pathname.replace(/^\//,'');console.log(JSON.stringify({target,configuredDatabase:configured}));if(configured!==expected)throw new Error(`Expected ${expected}`);
const db=new PrismaClient({datasources:{db:{url}}});
try{const selected=await db.$queryRawUnsafe('SELECT DATABASE() db');console.log(JSON.stringify({selectedDatabase:selected[0]?.db}));if(selected[0]?.db!==expected)throw new Error(`Connected to wrong database`);
 const [counts]=await db.$queryRawUnsafe(`SELECT (SELECT COUNT(*) FROM stock_balances) stockBalances,(SELECT COUNT(*) FROM stock_ledgers) stockLedgers,(SELECT COUNT(*) FROM items) items,(SELECT COUNT(*) FROM inventory_lots) inventoryLots,(SELECT COUNT(*) FROM goods_receipts) receipts,(SELECT COUNT(*) FROM production_orders) productionOrders`);
 const [valuation]=await db.$queryRawUnsafe(`SELECT COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM item_price_history p WHERE p.itemId=i.id) THEN b.onHand*i.lastCost ELSE 0 END),0) knownValue, SUM(CASE WHEN NOT EXISTS(SELECT 1 FROM item_price_history p WHERE p.itemId=i.id) THEN 1 ELSE 0 END) unknownBalances FROM stock_balances b JOIN items i ON i.id=b.itemId`);
 console.log(JSON.stringify({counts,valuation},(_,v)=>typeof v==='bigint'?Number(v):v));
}finally{await db.$disconnect()}
