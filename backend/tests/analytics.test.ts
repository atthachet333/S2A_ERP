import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { DocumentStatus, ItemType, PurchaseOrderStatus, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const TAG=`an${Date.now().toString().slice(-7)}`;
describe.sequential('supplier analytics and current inventory valuation',()=>{
  let app:FastifyInstance,token='',viewer='',companyId='',warehouseId='',supplierId='',itemId='',poId='';
  const auth=()=>({authorization:`Bearer ${token}`});
  beforeAll(async()=>{
    companyId=(await prisma.company.findUniqueOrThrow({where:{code:'S2A-PRIMARY'}})).id;
    const [adminRole,viewerRole]=await Promise.all([prisma.role.findUniqueOrThrow({where:{name:RoleName.SUPER_ADMIN}}),prisma.role.findUniqueOrThrow({where:{name:RoleName.VIEWER}})]);
    for(const [name,roleId] of [[`anadmin_${TAG}`,adminRole.id],[`anviewer_${TAG}`,viewerRole.id]] as const){const user=await prisma.user.create({data:{username:name,email:`${name}@s2a.local`,passwordHash:await bcrypt.hash('Analytics123!',10),fullName:name,mustChangePassword:false}});await prisma.userRole.create({data:{userId:user.id,roleId}});await prisma.companyMembership.create({data:{userId:user.id,companyId,roleId,isDefault:true}})}
    const unit=await prisma.unit.create({data:{code:`KG_${TAG}`,name:'กิโลกรัม'}});warehouseId=(await prisma.warehouse.create({data:{companyId,code:`WH_${TAG}`,name:'คลัง analytics'}})).id;supplierId=(await prisma.supplier.create({data:{companyId,code:`SP_${TAG}`,name:'ผู้ขาย analytics'}})).id;
    itemId=(await prisma.item.create({data:{companyId,code:`IT_${TAG}`,name:'วัตถุดิบ analytics',type:ItemType.RAW_MATERIAL,baseUnitId:unit.id,purchaseUnitId:unit.id,purchaseToBaseFactor:1,lastCost:15,avgCost:15}})).id;
    await prisma.itemPriceHistory.create({data:{companyId,itemId,price:15,source:'PURCHASE'}});await prisma.stockBalance.create({data:{itemId,warehouseId,onHand:10,reserved:2}});
    const po=await prisma.purchaseOrder.create({data:{companyId,poNo:`PO-${TAG}`,status:PurchaseOrderStatus.PARTIALLY_RECEIVED,orderDate:new Date('2026-08-01'),supplierId,warehouseId,items:{create:{itemId,itemCode:`IT_${TAG}`,itemName:'วัตถุดิบ analytics',purchaseUnitId:unit.id,purchaseUnitCode:`KG_${TAG}`,purchaseToBaseFactor:1,orderedQty:10,orderedBaseQty:10,unitPrice:10,lineSubtotal:100}}},include:{items:true}});poId=po.id;
    for(const [n,price,qty,date] of [[1,10,4,'2026-08-02'],[2,12,2,'2026-08-03']] as const)await prisma.goodsReceipt.create({data:{companyId,receiptNo:`GR-${TAG}-${n}`,supplierId,warehouseId,purchaseOrderId:po.id,status:DocumentStatus.CONFIRMED,receiptDate:new Date(date),items:{create:{itemId,purchaseOrderItemId:po.items[0].id,quantity:qty,purchaseUnitCode:`KG_${TAG}`,purchaseToBaseFactor:1,unitPrice:price,totalCost:price*qty}}}});
    app=await buildApp();await app.ready();const login=async(name:string)=>(await app.inject({method:'POST',url:'/api/auth/login',payload:{username:name,password:'Analytics123!'}})).json().data.accessToken as string;token=await login(`anadmin_${TAG}`);viewer=await login(`anviewer_${TAG}`);
  });
  afterAll(async()=>{await app.close();await prisma.$disconnect()});

  it('aggregates confirmed receipt facts, comparable prices, PO variance and partial quantity without invented scoring',async()=>{
    const list=await app.inject({method:'GET',url:'/api/business/supplier-analytics',headers:auth()});expect(list.statusCode).toBe(200);const row=list.json().data.find((x:{id:string})=>x.id===supplierId);expect(row.receiptCount).toBe(2);expect(row.totalReceivedValue).toBe(64);expect(row.distinctItemsPurchased).toBe(1);expect(row.partialPoCount).toBe(1);
    const detail=(await app.inject({method:'GET',url:`/api/business/supplier-analytics/${supplierId}`,headers:auth()})).json().data;expect(detail.itemHistory[0].lastActualPrice).toBe(12);expect(detail.itemHistory[0].previousPrice).toBe(10);expect(detail.itemHistory[0].priceChange.percent).toBe(20);expect(detail.summary.poVsActualVariancePercent).toBeCloseTo(6.6667,4);expect(detail.orders.find((x:{id:string})=>x.id===poId)).toMatchObject({ordered:10,received:6,remaining:4,overReceived:0});expect(JSON.stringify(detail)).not.toMatch(/best|reliability|recommended/i);
    const comparison=await app.inject({method:'GET',url:`/api/business/supplier-analytics/compare/${itemId}`,headers:auth()});expect(comparison.statusCode).toBe(200);expect(comparison.json().data.rows[0].comparableBasePrice).toBe(12);
    const xlsx=await app.inject({method:'GET',url:'/api/business/supplier-analytics/export.xlsx',headers:auth()});expect(xlsx.statusCode).toBe(200);expect(xlsx.rawPayload.subarray(0,2).toString()).toBe('PK');
  });

  it('keeps reversed receipts out and enforces purchasing permission and known-ID company scope',async()=>{
    await prisma.goodsReceipt.create({data:{companyId,receiptNo:`GR-${TAG}-REV`,supplierId,warehouseId,status:DocumentStatus.REVERSED,items:{create:{itemId,quantity:99,purchaseUnitCode:`KG_${TAG}`,purchaseToBaseFactor:1,unitPrice:999,totalCost:98901}}}});const detail=(await app.inject({method:'GET',url:`/api/business/supplier-analytics/${supplierId}`,headers:auth()})).json().data;expect(detail.summary.receiptCount).toBe(2);expect((await app.inject({method:'GET',url:'/api/business/supplier-analytics',headers:{authorization:`Bearer ${viewer}`}})).statusCode).toBe(403);
    const other=await prisma.company.create({data:{code:`CO_${TAG}`,nameTh:'บริษัทอื่น analytics'}});const foreign=await prisma.supplier.create({data:{companyId:other.id,code:`FS_${TAG}`,name:'ผู้ขายต่างบริษัท'}});expect((await app.inject({method:'GET',url:`/api/business/supplier-analytics/${foreign.id}`,headers:auth()})).statusCode).toBe(404);
  });

  it('values current balances with priced, production, explicit-zero, missing, negative and grouping semantics',async()=>{
    const unitId=(await prisma.item.findUniqueOrThrow({where:{id:itemId}})).baseUnitId;
    const create=async(code:string,lastCost:number,source:string|null,onHand:number,type:ItemType)=>{const item=await prisma.item.create({data:{companyId,code:`${code}_${TAG}`,name:code,type,baseUnitId:unitId,lastCost,avgCost:lastCost}});if(source)await prisma.itemPriceHistory.create({data:{companyId,itemId:item.id,price:lastCost,source}});await prisma.stockBalance.create({data:{itemId:item.id,warehouseId,onHand}});return item};
    await create('PROD',5,'PRODUCTION',3,ItemType.FINISHED_GOOD);await create('ZERO',0,'EXPLICIT_ZERO',7,ItemType.CONSUMABLE);await create('MISS',0,null,4,ItemType.PACKAGING);await create('NEG',2,'PURCHASE',-2,ItemType.RAW_MATERIAL);
    const res=await app.inject({method:'GET',url:`/api/business/inventory/valuation?warehouseId=${warehouseId}`,headers:auth()});expect(res.statusCode).toBe(200);const data=res.json().data;expect(data.summary.knownValue).toBe(161);expect(data.summary.unknownCostStockCount).toBe(1);expect(data.summary.negativeStockCount).toBe(1);expect(data.summary.completeness).toMatchObject({known:4,total:5,percent:80});expect(data.rows.find((r:{itemName:string})=>r.itemName==='PROD')).toMatchObject({costSource:'PRODUCTION',value:15});expect(data.rows.find((r:{itemName:string})=>r.itemName==='ZERO')).toMatchObject({costStatus:'ZERO',value:0});expect(data.rows.find((r:{itemName:string})=>r.itemName==='MISS')).toMatchObject({costStatus:'MISSING',unitCost:null,value:null});expect(data.byWarehouse[0].unknownCostItems).toBe(1);expect(data.byType.length).toBeGreaterThan(1);
    const missing=(await app.inject({method:'GET',url:`/api/business/inventory/valuation?warehouseId=${warehouseId}&costStatus=MISSING`,headers:auth()})).json().data;expect(missing.rows).toHaveLength(1);const xlsx=await app.inject({method:'GET',url:`/api/business/inventory/valuation/export.xlsx?warehouseId=${warehouseId}`,headers:auth()});expect(xlsx.statusCode).toBe(200);expect(xlsx.rawPayload.subarray(0,2).toString()).toBe('PK');
  });
});
