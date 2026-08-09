import ItemFormWorkspace from './ItemFormWorkspace';

export default function IngredientFormPage() {
  return (
    <ItemFormWorkspace variant={{
      kind: 'ingredient', type: 'RAW_MATERIAL',
      listPath: '/ingredients', newPath: '/ingredients/new',
      eyebrow: 'จัดการเมนูและต้นทุน · วัตถุดิบ',
      nameLabel: 'ชื่อวัตถุดิบ', namePlaceholder: 'เช่น ข้าวหอมมะลิ, เนื้อไก่, น้ำมันพืช',
      codePlaceholder: 'RM-001', categoryLabel: 'หมวดหมู่วัตถุดิบ',
      baseUnitHint: 'หน่วยที่ใช้ตอนใส่ในสูตร เช่น กรัม มิลลิลิตร หรือชิ้น — ระบบจะแปลงจากหน่วยซื้อให้อัตโนมัติ',
      factorHint: 'ตัวอย่าง: 1 กระสอบ = 25 กก. → กรอก 25 · 1 กก. = 1000 กรัม → กรอก 1000',
      purchaseQtyLabel: 'ปริมาณต่อการซื้อ',
      costPerBaseLabel: 'ต้นทุนต่อ 1 หน่วยฐาน',
      showLotExpiry: true,
    }} />
  );
}
