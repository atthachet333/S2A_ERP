import type { Locale } from './i18n';

type Pair = [title: string, description: string];
type Heading = [eyebrow: string, title: string, subtitle: string];
export type HomeContent = {
  live: string; auto: string; heroStats: string[];
  featureHead: Heading; features: Pair[];
  processHead: Heading; steps: Pair[];
  whyHead: Heading; why: Pair[]; cost: string[];
  kpiHead: Heading; kpiLabels: Pair[]; kpiBar: Pair; rankings: Pair; disclaimer: string;
  profitHead: Heading; waterfall: Pair[]; legend: string[];
  cta: [string, string, string, string]; footer: string[];
};

const th: HomeContent = {
  live:'ระบบคิดต้นทุน & สูตรเมนูอาหาร', auto:'คำนวณอัตโนมัติ', heroStats:['โมดูลหลักครบวงจร','ขั้นตอน วัตถุดิบ → กำไร','ต้นทุนต่อเมนูจริง'],
  featureHead:['ฟีเจอร์ของระบบ','ทุกอย่างที่ร้านอาหารต้องใช้ ในระบบเดียว','ตั้งแต่วัตถุดิบและบรรจุภัณฑ์ ไปจนถึงต้นทุน ราคาขาย และการวิเคราะห์ยอดขาย'],
  features:[['จัดการวัตถุดิบ','บันทึกราคาซื้อ หน่วยซื้อ และหน่วยใช้ในสูตร ระบบแปลงเป็นต้นทุนต่อหน่วยฐานให้อัตโนมัติ'],['จัดการบรรจุภัณฑ์','คิดต้นทุนกล่อง ถุง ช้อนส้อม ฝา และถ้วยน้ำจิ้มต่อชิ้นจากจำนวนต่อแพ็ค'],['สร้างสูตรอาหาร','ประกอบเมนูจากวัตถุดิบและบรรจุภัณฑ์ พร้อมปริมาณและหน่วย'],['คำนวณต้นทุนต่อเมนู','รวมวัตถุดิบ บรรจุภัณฑ์ ค่าแรง และค่าใช้จ่ายเป็นต้นทุนจริงต่อหน่วย'],['ตั้งราคาขายและวิเคราะห์กำไร','ตั้งราคาแบบ Markup หรือ Margin และเปรียบเทียบราคาหลายระดับ'],['ดู KPI เมนูอาหาร','ดูเมนูต้นทุนสูง เมนูกำไรดี และสัดส่วนต้นทุนในที่เดียว'],['สรุปการขาย','จัดอันดับยอดขาย รายได้ และกำไรต่อเมนูเพื่อช่วยตัดสินใจ']],
  processHead:['การทำงานของระบบ','เริ่มใช้งานได้ใน 7 ขั้นตอน','เริ่มจากข้อมูลพื้นฐาน ไปจนถึงกำไรและ KPI ของแต่ละเมนู'],
  steps:[['เพิ่มวัตถุดิบ','ใส่ราคาและหน่วยที่ซื้อ'],['เพิ่มบรรจุภัณฑ์','กล่อง ถุง ช้อน และฝา'],['กำหนดหน่วย','แปลงเป็นหน่วยใช้ในสูตร'],['สร้างสูตร','ประกอบเป็นเมนู'],['รวมต้นทุนจริง','คำนวณต่อจานหรือต่อกล่อง'],['ตั้งราคาขาย','ใช้ Markup หรือ Margin'],['ดูกำไร & KPI','ติดตามยอดขายและ Margin']],
  whyHead:['ทำไมต้องใช้ระบบนี้','เปลี่ยนการเดาต้นทุน ให้เป็นตัวเลขที่เชื่อถือได้','ช่วยให้เจ้าของร้านและทีมครัวตัดสินใจเรื่องราคาและกำไรได้อย่างมั่นใจ'],
  why:[['ลดการคำนวณผิด','ระบบคำนวณต้นทุนและกำไรใหม่อัตโนมัติเมื่อราคาเปลี่ยน'],['เห็นต้นทุนจริงต่อเมนู','รวมต้นทุนวัตถุดิบ บรรจุภัณฑ์ และค่าแรงอย่างครบถ้วน'],['เห็นต้นทุนบรรจุภัณฑ์ชัดเจน','แยกต้นทุนกล่อง ถุง และช้อนส้อมที่มักถูกมองข้าม'],['ตั้งราคาขายได้แม่นยำ','ใช้ต้นทุนจริงและเป้ากำไรเพื่อป้องกันการขายขาดทุน'],['วิเคราะห์เมนูขายดี/ขายไม่ดี','จัดอันดับเมนูที่ทำกำไรและเมนูที่ควรปรับปรุง'],['ใช้งานง่ายแม้ไม่เก่งระบบ','หน้าจอชัดเจนและออกแบบให้ทีมหน้างานเข้าใจได้ทันที']],
  cost:['โครงสร้างต้นทุน 1 เมนู','ตัวอย่างสัดส่วนต้นทุนของเมนูข้าวกล่อง — ระบบแยกให้เห็นทุกส่วน','ต้นทุนวัตถุดิบ','ต้นทุนบรรจุภัณฑ์','ค่าแรง / โสหุ้ย','กำไรต่อกล่อง เมื่อขาย ฿59 · Margin 41%'],
  kpiHead:['ภาพรวม KPI','แดชบอร์ดที่บอกทุกอย่างในหน้าเดียว','เห็นจำนวนเมนู วัตถุดิบ ต้นทุนเฉลี่ย เมนูขายดี และเมนูกำไรสูงสุดได้ทันที'], kpiLabels:[['วัตถุดิบทั้งหมด','รายการ'],['บรรจุภัณฑ์','รายการ'],['เมนูอาหาร','เมนู'],['กำไรเฉลี่ย/เมนู','Margin']], kpiBar:['ภาพรวมระบบ — S2A','ตัวอย่างหน้าจอ'], rankings:['เมนูขายดี 5 อันดับ','เมนู Margin สูงสุด'], disclaimer:'* ตัวเลขด้านบนเป็นตัวอย่างเพื่อสื่อการทำงาน เมื่อเข้าสู่ระบบจะแสดงข้อมูลจริงจากร้านของคุณ',
  profitHead:['ต้นทุนสู่กำไร','จากต้นทุนทุกบาท สู่ราคาขายที่ทำกำไร','ระบบรวมต้นทุนวัตถุดิบ บรรจุภัณฑ์ และค่าแรง แล้วคำนวณกำไรจากราคาขายให้เห็นชัด'], waterfall:[['วัตถุดิบ','฿22'],['บรรจุภัณฑ์','฿8'],['ค่าแรง / โสหุ้ย','฿5'],['ต้นทุนรวม','฿35'],['ราคาขาย ฿59','กำไร ฿24']], legend:['ต้นทุนวัตถุดิบ','ต้นทุนบรรจุภัณฑ์','ค่าแรง / Overhead','ต้นทุนรวม','ราคาขาย & กำไร'],
  cta:['พร้อมเริ่มใช้งาน','ระบบบริหารต้นทุนและสูตรอาหารที่ช่วยคุณตัดสินใจ','ชัดเจน ใช้งานง่าย และช่วยให้ทุกเมนูทำกำไรได้จริง — เข้าสู่ระบบเพื่อเริ่มจัดการต้นทุน สูตร และวัตถุดิบของคุณ','ดูฟีเจอร์ทั้งหมด'], footer:['ระบบคิดคำนวณต้นทุนและสูตรเมนูอาหาร สำหรับจัดการวัตถุดิบ บรรจุภัณฑ์ ราคาขาย และกำไร','ระบบ','เกี่ยวกับระบบ','ฟีเจอร์','การทำงาน','ภาพรวม KPI','เริ่มต้น','จัดการต้นทุนอาหาร','สร้างสูตรเมนู','วิเคราะห์กำไร','การตั้งค่าคุกกี้','ระบบคิดคำนวณต้นทุนและสูตรเมนูอาหาร'],
};

const en: HomeContent = {
  ...th, live:'Food Costing & Recipe System', auto:'Automatic calculation', heroStats:['7 integrated core modules','5 steps from ingredients to profit','100% true menu cost'],
  featureHead:['System Features','Everything a food business needs, in one system','From ingredients and packaging to costing, pricing, and sales analysis.'],
  features:[['Ingredient Management','Record purchase prices and units; the system automatically calculates base-unit cost.'],['Packaging Management','Calculate per-piece costs for boxes, bags, cutlery, lids, and containers.'],['Recipe Builder','Build menus from ingredients and packaging with precise quantities and units.'],['Menu Costing','Combine ingredients, packaging, labor, and overhead into a true unit cost.'],['Pricing & Profit Analysis','Set prices using markup or margin and compare multiple price tiers.'],['Menu KPI','See high-cost and high-margin menus and their cost composition in one place.'],['Sales Summary','Rank menu sales, revenue, and profit to support better decisions.']],
  processHead:['How It Works','Get started in 7 steps','Move from master data to profit and KPI insights for every menu.'], steps:[['Add Ingredients','Enter purchase prices and units'],['Add Packaging','Boxes, bags, cutlery, and lids'],['Configure Units','Convert into recipe usage units'],['Build a Recipe','Assemble ingredients into a menu'],['Calculate True Cost','Calculate per plate or box'],['Set Selling Prices','Use markup or margin'],['Review Profit & KPI','Track sales and margin']],
  whyHead:['Why S2A','Turn cost estimates into reliable numbers','Give owners and kitchen teams confidence in every pricing and profit decision.'], why:[['Reduce Calculation Errors','Costs and profit recalculate automatically whenever prices change.'],['Know True Menu Cost','Include ingredients, packaging, and labor—not estimates.'],['Make Packaging Cost Visible','Separate boxes, bags, and cutlery that are often overlooked.'],['Price Accurately','Use actual cost and profit targets to avoid unintentional losses.'],['Analyze Menu Performance','Rank profitable menus and identify those that need improvement.'],['Easy for Every Team','Clear screens help operational teams understand what to do immediately.']],
  cost:['Cost Structure of One Menu','Illustrative boxed-meal cost composition, separated into every component.','Ingredient Cost','Packaging Cost','Labor / Overhead','THB 24 profit per box at THB 59 · 41% margin'],
  kpiHead:['KPI Overview','One dashboard tells the whole story','See menu and ingredient counts, average cost, top sellers, and highest-margin menus.'], kpiLabels:[['Total Ingredients','items'],['Packaging','items'],['Menus','menus'],['Average Profit / Menu','Margin']], kpiBar:['System Overview — S2A','Sample screen'], rankings:['Top 5 Selling Menus','Highest-Margin Menus'], disclaimer:'* Values shown are product examples. Your workspace displays actual business data after sign-in.',
  profitHead:['Cost to Profit','Turn every baht of cost into a profitable selling price','Combine ingredient, packaging, and labor costs, then clearly calculate profit from selling price.'], waterfall:[['Ingredients','THB 22'],['Packaging','THB 8'],['Labor / Overhead','THB 5'],['Total Cost','THB 35'],['Selling Price THB 59','Profit THB 24']], legend:['Ingredient Cost','Packaging Cost','Labor / Overhead','Total Cost','Selling Price & Profit'],
  cta:['Ready to Get Started?','Cost and recipe management that supports better decisions','Clear, practical, and designed to make every menu profitable. Sign in to manage your costs, recipes, and ingredients.','Explore All Features'], footer:['Food costing and recipe management for ingredients, packaging, selling prices, and profit.','System','About','Features','How It Works','KPI Overview','Get Started','Manage Food Cost','Build Menu Recipes','Analyze Profit','Cookie Settings','Food Costing & Recipe Intelligence'],
};

const zh: HomeContent = {
  ...th, live:'食品成本与配方系统', auto:'自动计算', heroStats:['7 个完整核心模块','从原料到利润的 5 个步骤','100% 真实菜品成本'],
  featureHead:['系统功能','餐饮企业所需功能，尽在一个系统','从原料与包装到成本、售价及销售分析。'], features:[['原料管理','记录采购价与单位，系统自动计算基础单位成本。'],['包装管理','按每包数量计算餐盒、袋子、餐具、盖子等单件成本。'],['创建配方','按准确数量和单位组合原料与包装，建立菜品配方。'],['菜品成本计算','汇总原料、包装、人工及间接费用，得到真实单位成本。'],['售价与利润分析','使用加价率或利润率定价，并比较多个价格等级。'],['菜品 KPI','集中查看高成本、高利润菜品及成本构成。'],['销售汇总','按销量、收入及利润进行菜品排名，辅助经营决策。']],
  processHead:['工作流程','7 步即可开始使用','从基础资料逐步获得每道菜品的利润与 KPI 洞察。'], steps:[['添加原料','输入采购价格和单位'],['添加包装','餐盒、袋子、餐具和盖子'],['设置单位','转换为配方使用单位'],['创建配方','组合成菜品'],['计算真实成本','计算每份或每盒成本'],['设置售价','使用加价率或利润率'],['查看利润与 KPI','跟踪销售额和利润率']],
  whyHead:['为什么选择本系统','将成本估算转化为可信数据','帮助经营者与厨房团队更有把握地制定价格和利润目标。'], why:[['减少计算错误','价格变化时自动重新计算成本与利润。'],['掌握真实菜品成本','完整计入原料、包装及人工成本。'],['清晰了解包装成本','单独显示经常被忽略的餐盒、袋子与餐具成本。'],['精准制定售价','根据实际成本与目标利润，避免无意亏损。'],['分析菜品表现','识别高利润菜品及需要改善的菜品。'],['团队轻松上手','界面清晰，让一线人员立即了解操作内容。']],
  cost:['一道菜品的成本结构','盒饭成本构成示例，系统清楚拆分每个部分。','原料成本','包装成本','人工 / 间接费用','售价 THB 59 时每盒利润 THB 24 · 利润率 41%'],
  kpiHead:['KPI 概览','一个仪表板掌握全部信息','快速查看菜品与原料数量、平均成本、畅销菜品及最高利润率菜品。'], kpiLabels:[['原料总数','项'],['包装','项'],['菜品','道'],['平均每道菜利润','利润率']], kpiBar:['系统概览 — S2A','示例界面'], rankings:['畅销菜品前 5 名','最高利润率菜品'], disclaimer:'* 以上数值仅为产品示例。登录后将显示您企业的实际数据。',
  profitHead:['从成本到利润','让每一泰铢成本转化为可盈利的售价','汇总原料、包装与人工成本，并根据售价清晰计算利润。'], waterfall:[['原料','THB 22'],['包装','THB 8'],['人工 / 间接费用','THB 5'],['总成本','THB 35'],['售价 THB 59','利润 THB 24']], legend:['原料成本','包装成本','人工 / 间接费用','总成本','售价与利润'],
  cta:['准备开始使用？','帮助您决策的成本与配方管理系统','清晰、实用，让每道菜品真正盈利。登录后即可管理成本、配方与原料。','查看全部功能'], footer:['用于管理原料、包装、售价与利润的食品成本及配方系统。','系统','系统介绍','功能','工作流程','KPI 概览','开始使用','管理食品成本','创建菜品配方','分析利润','Cookie 设置','食品成本与配方管理系统'],
};

export const homeContent: Record<Locale, HomeContent> = { th, en, 'zh-CN': zh };
export const resolveHomeContent = (locale: Locale): HomeContent => homeContent[locale] ?? homeContent.th;
