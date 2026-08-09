import ItemFormWorkspace from './ItemFormWorkspace';

export default function PackagingFormPage() {
  return (
    <ItemFormWorkspace variant={{
      kind: 'packaging', type: 'PACKAGING',
      listPath: '/packaging', newPath: '/packaging/new',
      eyebrow: 'จัดการเมนูและต้นทุน · บรรจุภัณฑ์',
      nameLabel: 'ชื่อบรรจุภัณฑ์', namePlaceholder: 'เช่น กล่องข้าว 750ml, ถุงหิ้วขนาดกลาง',
      codePlaceholder: 'PK-001', categoryLabel: 'ประเภทบรรจุภัณฑ์',
      baseUnitHint: 'บรรจุภัณฑ์คิดต้นทุนต่อ “ชิ้น” — เลือกหน่วยฐานเป็นชิ้น แล้วระบุจำนวนชิ้นต่อแพ็ค/ถุง/ลังด้านล่าง',
      factorHint: 'ตัวอย่าง: 1 แพ็ค = 50 ชิ้น → กรอก 50 · 1 ลัง = 100 กล่อง → กรอก 100',
      purchaseQtyLabel: 'จำนวนแพ็ค/ถุง/ลัง ต่อการซื้อ',
      costPerBaseLabel: 'ต้นทุนต่อ 1 ชิ้น',
      presets: [
        { label: 'กล่องข้าว' }, { label: 'ถุงพลาสติก' }, { label: 'หนังยาง' }, { label: 'ช้อนส้อม' },
        { label: 'ฝาปิด' }, { label: 'ถ้วยน้ำจิ้ม' }, { label: 'กระดาษรอง' }, { label: 'แก้ว' },
        { label: 'หลอด' }, { label: 'ถุงหิ้ว' }, { label: 'สติกเกอร์' },
      ],
      showLotExpiry: false,
    }} />
  );
}
