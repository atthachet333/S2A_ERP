import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const TAG = `lot${Date.now().toString().slice(-7)}`;
const n = (value: unknown) => Number(value);

describe.sequential('Phase 29 lot, expiry and FEFO', () => {
  let app: FastifyInstance; let token=''; let companyId=''; let warehouseId=''; let secondWarehouseId=''; let supplierId=''; let itemId='';
  const auth=()=>({authorization:`Bearer ${token}`});

  beforeAll(async()=>{
    const role=await prisma.role.findUniqueOrThrow({where:{name:RoleName.SUPER_ADMIN}});
    const passwordHash=await bcrypt.hash('LotPass123!',10);
    const user=await prisma.user.create({data:{username:`tester_${TAG}`,email:`${TAG}@s2a.local`,passwordHash,fullName:'Lot Tester',isActive:true,mustChangePassword:false}});
    await prisma.userRole.create({data:{userId:user.id,roleId:role.id}});
    const company=await prisma.company.findUniqueOrThrow({where:{code:'S2A-PRIMARY'}}); companyId=company.id;
    await prisma.companyMembership.create({data:{userId:user.id,companyId,roleId:role.id,isDefault:true}});
    const unit=await prisma.unit.create({data:{code:`KG_${TAG}`,name:'กิโลกรัม Lot'}});
    const [warehouse,second,supplier,item]=await Promise.all([
      prisma.warehouse.create({data:{companyId,code:`LW1_${TAG}`,name:'Lot WH 1',type:'RAW_MATERIAL'}}),
      prisma.warehouse.create({data:{companyId,code:`LW2_${TAG}`,name:'Lot WH 2',type:'RAW_MATERIAL'}}),
      prisma.supplier.create({data:{companyId,code:`LS_${TAG}`,name:'Lot Supplier'}}),
      prisma.item.create({data:{companyId,code:`LI_${TAG}`,name:'Lot Ingredient',type:ItemType.RAW_MATERIAL,baseUnitId:unit.id,purchaseUnitId:unit.id,isLotTracked:true,isExpiryTracked:true,lastCost:10}}),
    ]);
    warehouseId=warehouse.id;secondWarehouseId=second.id;supplierId=supplier.id;itemId=item.id;
    app=await buildApp();await app.ready();
    const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:`tester_${TAG}`,password:'LotPass123!'}});token=login.json().data.accessToken;
  });
  afterAll(async()=>{if(app)await app.close();await prisma.$disconnect()});

  it('creates two receipt lots and rejects conflicting metadata',async()=>{
    for(const [lotNo,expiryDate,quantity] of [[`A_${TAG}`,'2026-09-01',5],[`B_${TAG}`,'2026-09-10',10]] as const){
      const res=await app.inject({method:'POST',url:'/api/business/receiving',headers:auth(),payload:{warehouseId,supplierId,confirm:true,items:[{itemId,quantity,unitPrice:10,lotNo,manufactureDate:'2026-08-20',expiryDate}]}});
      expect(res.statusCode).toBe(201);
    }
    expect(await prisma.inventoryLot.count({where:{companyId,itemId}})).toBe(2);
    const conflict=await app.inject({method:'POST',url:'/api/business/receiving',headers:auth(),payload:{warehouseId,supplierId,confirm:true,items:[{itemId,quantity:1,unitPrice:10,lotNo:`A_${TAG}`,manufactureDate:'2026-08-20',expiryDate:'2026-09-02'}]}});
    expect(conflict.statusCode).toBe(409);expect(conflict.json().error.code).toBe('LOT_METADATA_CONFLICT');
  });

  it('suggests deterministic FEFO and consumes multiple exact lots',async()=>{
    const lots=await prisma.inventoryLot.findMany({where:{companyId,itemId}});const lotOf=new Map(lots.map(l=>[l.lotNo,l.id]));
    const suggestion=await app.inject({method:'POST',url:'/api/business/inventory/lots/suggest',headers:auth(),payload:{warehouseId,itemId,quantity:8}});
    expect(suggestion.statusCode).toBe(200);expect(suggestion.json().data.allocations.map((x:{quantity:number})=>x.quantity)).toEqual([5,3]);
    const issue=await app.inject({method:'POST',url:'/api/business/stock-issues',headers:auth(),payload:{warehouseId,idempotencyKey:`issue-${TAG}`,confirm:true,items:[{itemId,requiredQty:8,issuedQty:8,baseQty:8,unit:`KG_${TAG}`,allocations:[{lotId:lotOf.get(`A_${TAG}`),quantity:5},{lotId:lotOf.get(`B_${TAG}`),quantity:3}]}]}});
    expect(issue.statusCode).toBe(201);
    const ledgers=await prisma.stockLedger.findMany({where:{refId:issue.json().data.id},orderBy:{lotId:'asc'}});expect(ledgers).toHaveLength(2);expect(ledgers.every(row=>row.lotId)).toBe(true);
    const balances=await prisma.stockBalance.findMany({where:{warehouseId,itemId,lotId:{not:null}}});expect(balances.reduce((sum,row)=>sum+n(row.onHand),0)).toBe(7);
  });

  it('preserves lot identity through transfer and reversal',async()=>{
    const lot=await prisma.inventoryLot.findUniqueOrThrow({where:{companyId_itemId_lotNo:{companyId,itemId,lotNo:`B_${TAG}`}}});
    const transfer=await app.inject({method:'POST',url:'/api/business/transfers',headers:auth(),payload:{fromWarehouseId:warehouseId,toWarehouseId:secondWarehouseId,confirm:true,items:[{itemId,quantity:2,lotId:lot.id}]}});
    expect(transfer.statusCode).toBe(201);
    const movements=await prisma.stockLedger.findMany({where:{refId:transfer.json().data.id}});expect(new Set(movements.map(row=>row.lotId))).toEqual(new Set([lot.id]));
    const reverse=await app.inject({method:'POST',url:`/api/business/transfers/${transfer.json().data.id}/reverse`,headers:auth(),payload:{reason:'test'}});expect(reverse.statusCode).toBe(200);
    const source=await prisma.stockBalance.findFirstOrThrow({where:{warehouseId,itemId,lotId:lot.id}});expect(n(source.onHand)).toBe(7);
  });

  it('scopes lot inventory and blocks expired lots from automatic suggestion',async()=>{
    const page=await app.inject({method:'GET',url:`/api/business/inventory/lots?itemId=${itemId}`,headers:auth()});expect(page.statusCode).toBe(200);expect(page.json().data.rows.every((row:{itemId:string})=>row.itemId===itemId)).toBe(true);
    const expired=await prisma.inventoryLot.create({data:{companyId,itemId,lotNo:`OLD_${TAG}`,receivedDate:new Date('2026-01-01'),expiryDate:new Date('2026-01-02'),sourceType:'ADJUSTMENT'}});
    await prisma.stockBalance.create({data:{warehouseId,itemId,lotId:expired.id,lotKey:expired.id,locationKey:'',onHand:4}});
    const suggestion=await app.inject({method:'POST',url:'/api/business/inventory/lots/suggest',headers:auth(),payload:{warehouseId,itemId,quantity:1}});expect(suggestion.statusCode).toBe(200);expect(suggestion.json().data.allocations[0].lotId).not.toBe(expired.id);
  });
});
