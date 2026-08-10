import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';

export type DocumentType = 'ORDER_SLIP' | 'KITCHEN_PREPARATION_SLIP' | 'STOCK_ISSUE_SLIP' | 'GOODS_RECEIPT_SLIP' | 'RECIPE_COST_SHEET' | 'SALES_REPORT';
export type DocumentLine = { name: string; detail?: string; quantity?: string | number; unit?: string; price?: string | number; total?: string | number };
export type BusinessDocument = { type: DocumentType; title: string; documentNo: string; date: Date; company: { nameTh: string; logoUrl?: string | null; address?: string | null; phone?: string | null; email?: string | null; taxId?: string | null; documentFooter?: string | null }; createdBy?: string; subject?: { label: string; value: string }[]; lines: DocumentLine[]; total?: string | number; note?: string | null };

const titles: Record<DocumentType,string> = { ORDER_SLIP:'ORDER SLIP',KITCHEN_PREPARATION_SLIP:'KITCHEN PREPARATION SLIP',STOCK_ISSUE_SLIP:'STOCK ISSUE SLIP',GOODS_RECEIPT_SLIP:'GOODS RECEIPT SLIP',RECIPE_COST_SHEET:'RECIPE COST SHEET',SALES_REPORT:'SALES REPORT' };
const thaiFont = ['C:/Windows/Fonts/LeelawUI.ttf','C:/Windows/Fonts/tahoma.ttf'].find(existsSync);
const thaiBold = ['C:/Windows/Fonts/LeelawUI.ttf','C:/Windows/Fonts/tahomabd.ttf'].find(existsSync);

export async function renderBusinessPdf(input: BusinessDocument): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 42, info: { Title: `${titles[input.type]} ${input.documentNo}`, Author: 'S2 Accounting Consultant' } });
  const chunks: Buffer[] = []; doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  if (thaiFont) doc.registerFont('Thai',thaiFont); if (thaiBold) doc.registerFont('ThaiBold',thaiBold);
  const regular = thaiFont ? 'Thai' : 'Helvetica'; const bold = thaiBold ? 'ThaiBold' : 'Helvetica-Bold';
  doc.rect(0,0,595,116).fill('#071D35'); doc.fillColor('#C6A15B').font(bold).fontSize(10).text('S2 ACCOUNTING CONSULTANT',42,30);
  doc.fillColor('#FFFFFF').font(bold).fontSize(19).text(input.company.nameTh,42,48); doc.fillColor('#BFD0DF').font(regular).fontSize(9).text(input.company.address??'',42,75,{width:330});
  doc.fillColor('#FFFFFF').font(bold).fontSize(15).text(titles[input.type],365,37,{width:188,align:'right'}); doc.fillColor('#D7E0E8').font(regular).fontSize(9).text(`No. ${input.documentNo}\nDate ${input.date.toLocaleDateString('th-TH')}\nCreated by ${input.createdBy??'—'}`,365,60,{width:188,align:'right'});
  let y=138; if(input.subject?.length){doc.roundedRect(42,y,511,58,6).fill('#F3F6F9');input.subject.forEach((entry,index)=>{const x=55+(index%3)*166;const row=Math.floor(index/3);doc.fillColor('#748499').font(regular).fontSize(8).text(entry.label,x,y+10+row*25,{width:150});doc.fillColor('#153A59').font(bold).fontSize(10).text(entry.value||'—',x,y+22+row*25,{width:150});});y+=75;}
  doc.fillColor('#FFFFFF').rect(42,y,511,26).fill('#0B3154'); doc.fillColor('#FFFFFF').font(bold).fontSize(9).text('รายการ',52,y+8,{width:250}).text('จำนวน',310,y+8,{width:70,align:'right'}).text('หน่วย',390,y+8,{width:55,align:'center'}).text('มูลค่า',455,y+8,{width:88,align:'right'}); y+=26;
  input.lines.forEach((line,index)=>{if(y>745){doc.addPage();y=50;}if(index%2===0)doc.rect(42,y,511,32).fill('#F7F9FB');doc.fillColor('#183A58').font(regular).fontSize(9).text(line.name,52,y+7,{width:250});if(line.detail)doc.fillColor('#8795A5').fontSize(7).text(line.detail,52,y+19,{width:250});doc.fillColor('#29465F').fontSize(9).text(String(line.quantity??'—'),310,y+10,{width:70,align:'right'}).text(line.unit??'—',390,y+10,{width:55,align:'center'}).font(bold).text(line.total===undefined?'—':Number(line.total).toLocaleString('th-TH',{minimumFractionDigits:2}),455,y+10,{width:88,align:'right'});y+=32;});
  if(input.total!==undefined){y+=8;doc.fillColor('#8C6928').font(bold).fontSize(10).text('TOTAL',365,y,{width:80,align:'right'});doc.fillColor('#0B3154').fontSize(15).text(Number(input.total).toLocaleString('th-TH',{minimumFractionDigits:2}),455,y-3,{width:88,align:'right'});y+=30;}
  if(input.note){doc.fillColor('#6C7D90').font(regular).fontSize(8).text(`หมายเหตุ: ${input.note}`,42,y,{width:511});}
  doc.fillColor('#97A3AF').font(regular).fontSize(7).text(input.company.documentFooter??'Generated securely by S2A ERP',42,790,{width:511,align:'center'});doc.end();return complete;
}
