import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
import{displayBoolean,displayEnum,displayUnit,money}from'@/lib/presentation';
const page=readFileSync('src/pages/ProfitSimulatorPage.tsx','utf8'),app=readFileSync('src/App.tsx','utf8'),nav=readFileSync('src/components/layout/nav-config.ts','utf8'),css=readFileSync('src/styles/phase32-5.css','utf8');
describe('Phase 32/32.5 profit simulator UI safety',()=>{
 it('registers the route and keeps all three permissions',()=>{expect(app).toContain('/analytics/profit-simulator');expect(nav).toMatch(/profit-simulator[\s\S]*COSTING_VIEW[\s\S]*RECIPE_VIEW[\s\S]*PRICING_VIEW/)});
 it('labels simulation as non-operational',()=>{expect(page).toMatch(/โหมดจำลอง \/ SIMULATION/);expect(page).toMatch(/จะไม่ถูกบันทึกลงต้นทุนหรือราคาจริง/);expect(page).toMatch(/ไม่ใช่กำไรสุทธิ/)});
 it('offers guided inputs, baseline presets, and reset',()=>{expect(page).toContain('GuidanceCard');expect(page).toMatch(/เทียบค่าปัจจุบัน/);expect(page).toMatch(/รีเซ็ตค่าจำลอง/);expect(page).toMatch(/คืนค่า/)});
 it('keeps margin and markup distinct and explained',()=>{expect(page).toMatch(/Target Margin/);expect(page).toMatch(/Target Markup/);expect(page).toMatch(/สัดส่วนกำไรเทียบกับราคาขาย/);expect(page).toMatch(/สัดส่วนกำไรเทียบกับต้นทุน/)});
 it('keeps warnings and XLSX export wired to backend truth',()=>{expect(page).toContain('SIMULATED_PRICE_BELOW_SIMULATED_COST');expect(page).toContain('COST_DATA_INCOMPLETE');expect(page).toMatch(/downloadPost[\s\S]*profit-simulator\/export\.xlsx[\s\S]*payload/)});
 it('has responsive layout and token-based dark-safe colors',()=>{expect(css).toContain('@media(max-width:800px)');expect(css).toContain('@media(max-width:480px)');expect(css).toMatch(/var\(--surface\)/);expect(css).toMatch(/var\(--text\)/)});
});
describe('Thai-first presentation helpers',()=>{
 it('shows configured unit labels safely',()=>{expect(displayUnit('KG')).toBe('กิโลกรัม / KG');expect(displayUnit('BOWL')).toBe('ชาม / BOWL');expect(displayUnit({code:'CUSTOM01',name:'CUSTOM01'})).toBe('CUSTOM01')});
 it('maps technical enum values without changing stored codes',()=>{expect(displayEnum('ACTUAL').label).toContain('ผลผลิตตามหน่วยจริง');expect(displayEnum('BATCH').label).toContain('ผลผลิตแบบต่อชุด');expect(displayEnum('MISSING').label).toContain('ยังไม่มีข้อมูลต้นทุน')});
 it('never exposes raw booleans and explains missing money',()=>{expect(displayBoolean(true).label).not.toBe('true');expect(displayBoolean(false).label).not.toBe('false');expect(money(null)).toBe('ยังไม่มีข้อมูลต้นทุน')});
});
