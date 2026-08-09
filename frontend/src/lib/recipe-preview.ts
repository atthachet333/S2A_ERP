import type { Item } from './catalog';

export interface PreviewLine { itemId:string; quantity:number; unit:'base'|'purchase'; wastePercent:number }
export interface PreviewExpenses { laborCost:number; electricCost:number; waterCost:number; gasCost:number; overheadCost:number; otherCost:number }

/** Client preview only; the backend always recomputes before persistence. */
export function computeRecipePreview(lines:PreviewLine[],items:Map<string,Item>,expenses:PreviewExpenses,yieldQty:number,yieldPercent:number){
  let material=0,packaging=0;
  for(const line of lines){
    const item=items.get(line.itemId); if(!item)continue;
    const baseQty=line.quantity*(line.unit==='purchase'?item.purchaseToBaseFactor:1);
    const amount=baseQty*item.lastCost*(1+line.wastePercent/100);
    if(item.type==='PACKAGING')packaging+=amount; else material+=amount;
  }
  const utility=expenses.electricCost+expenses.waterCost+expenses.gasCost;
  const total=material+packaging+expenses.laborCost+utility+expenses.overheadCost+expenses.otherCost;
  const effective=yieldQty*yieldPercent/100;
  return {material,packaging,utility,total,unit:effective>0?total/effective:0};
}
