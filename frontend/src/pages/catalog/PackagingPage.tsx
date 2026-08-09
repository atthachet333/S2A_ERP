import { Package } from 'lucide-react';
import ItemListWorkspace from './ItemListWorkspace';

export default function PackagingPage() {
  return (
    <ItemListWorkspace variant={{
      kind: 'packaging', type: 'PACKAGING',
      eyebrow: 'จัดการเมนูและต้นทุน', title: 'บรรจุภัณฑ์',
      subtitle: 'กล่องข้าว ถุง ช้อนส้อม ฝา ถ้วยน้ำจิ้ม และวัสดุที่ใช้ใส่อาหาร พร้อมต้นทุนต่อชิ้น',
      icon: Package, newPath: '/packaging/new', itemPath: (id) => `/packaging/${id}`,
      addLabel: 'เพิ่มบรรจุภัณฑ์', totalLabel: 'บรรจุภัณฑ์ทั้งหมด',
      emptyTitle: 'ยังไม่มีบรรจุภัณฑ์', emptyDesc: 'เริ่มต้นด้วยการเพิ่มบรรจุภัณฑ์รายการแรก เช่น กล่องข้าว ถุงหิ้ว หรือช้อนส้อม',
      searchPlaceholder: 'ค้นหารหัส ชื่อ หรือบาร์โค้ดบรรจุภัณฑ์', costLabel: 'ต้นทุน/ชิ้น',
    }} />
  );
}
