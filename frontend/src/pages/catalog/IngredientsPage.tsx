import { Sprout } from 'lucide-react';
import ItemListWorkspace from './ItemListWorkspace';

export default function IngredientsPage() {
  return (
    <ItemListWorkspace variant={{
      kind: 'ingredient', type: 'RAW_MATERIAL',
      eyebrow: 'จัดการเมนูและต้นทุน', title: 'วัตถุดิบ',
      subtitle: 'ทะเบียนวัตถุดิบทั้งหมด พร้อมราคาซื้อ หน่วย และต้นทุนต่อหน่วยฐานสำหรับใช้ในสูตร',
      icon: Sprout, newPath: '/ingredients/new', itemPath: (id) => `/ingredients/${id}`,
      addLabel: 'เพิ่มวัตถุดิบ', totalLabel: 'วัตถุดิบทั้งหมด',
      emptyTitle: 'ยังไม่มีวัตถุดิบ', emptyDesc: 'เริ่มต้นด้วยการเพิ่มวัตถุดิบรายการแรก เช่น ข้าวสาร เนื้อไก่ หรือน้ำมัน',
      searchPlaceholder: 'ค้นหารหัส ชื่อ หรือบาร์โค้ดวัตถุดิบ', costLabel: 'ต้นทุน/หน่วยฐาน',
    }} />
  );
}
