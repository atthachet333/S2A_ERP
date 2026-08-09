import { describe, expect, it } from 'vitest';
import { computeRecipePreview } from '@/lib/recipe-preview';
import type { Item } from '@/lib/catalog';

function item(overrides: Partial<Item> = {}): Item {
  return { id:'pork',code:'RM-001',barcode:null,name:'หมูบด',type:'RAW_MATERIAL',categoryId:null,category:null,baseUnitId:'g',baseUnit:{id:'g',code:'g',name:'กรัม'},purchaseUnitId:'kg',purchaseUnit:{id:'kg',code:'kg',name:'กิโลกรัม'},purchaseToBaseFactor:1000,avgCost:.15,lastCost:.15,reorderPoint:0,minQty:0,isLotTracked:false,isExpiryTracked:false,imageUrl:null,isActive:true,createdAt:'',updatedAt:'',...overrides };
}
const expenses={laborCost:0,electricCost:0,waterCost:0,gasCost:0,overheadCost:0,otherCost:0};

describe('Food Costing live preview',()=>{
 it('คำนวณหมูบด 500 g ที่ 0.15 บาท/g เป็น 75 บาท',()=>{const result=computeRecipePreview([{itemId:'pork',quantity:500,unit:'base',wastePercent:0}],new Map([['pork',item()]]),expenses,1,100);expect(result.material).toBe(75);expect(result.unit).toBe(75);});
 it('ใช้ conversion เฉพาะ item เมื่อกรอกหน่วยซื้อ',()=>{const result=computeRecipePreview([{itemId:'pork',quantity:.5,unit:'purchase',wastePercent:0}],new Map([['pork',item()]]),expenses,1,100);expect(result.material).toBe(75);});
 it('แยก packaging ออกจาก material',()=>{const packaging=item({id:'box',type:'PACKAGING',lastCost:3,purchaseToBaseFactor:1,purchaseUnitId:null,purchaseUnit:null});const result=computeRecipePreview([{itemId:'box',quantity:2,unit:'base',wastePercent:0}],new Map([['box',packaging]]),expenses,1,100);expect(result.packaging).toBe(6);expect(result.material).toBe(0);});
 it('รวม packaging conversion ใน total และ cost per unit',()=>{const packaging=item({id:'box',type:'PACKAGING',lastCost:3.5,purchaseToBaseFactor:100,purchaseUnitId:'pack',purchaseUnit:{id:'pack',code:'pack',name:'แพ็ก'}});const result=computeRecipePreview([{itemId:'pork',quantity:500,unit:'base',wastePercent:0},{itemId:'box',quantity:.1,unit:'purchase',wastePercent:0}],new Map([['pork',item()],['box',packaging]]),expenses,10,100);expect(result.material).toBe(75);expect(result.packaging).toBe(35);expect(result.total).toBe(110);expect(result.unit).toBe(11);});
 it('รวมค่าแรงและ utility และหาร effective yield',()=>{const result=computeRecipePreview([],new Map(),{...expenses,laborCost:50,electricCost:10,waterCost:5,gasCost:5},10,50);expect(result.total).toBe(70);expect(result.unit).toBe(14);});
});
