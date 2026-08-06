# UI/UX GUIDELINES — S2A ERP

## S2A visual identity

ใช้โลโก้จริง `/s2a-logo.png` โดย `object-fit: contain`, ฟอนต์ IBM Plex Sans Thai, สีขาว/น้ำเงิน/กรมและทองเป็น accent รองรับ desktop/mobile พร้อม show-hide password, remember username และ sidebar ตาม role

## หลักการ
ทันสมัย อ่านง่าย ใช้งานง่าย ไม่รก — เหมาะทั้งพนักงานหน้างานและผู้บริหาร
รองรับ Desktop และ Tablet (Responsive) ใช้ **ภาษาไทยเป็นหลัก**

## Layout
```
┌───────────────────────────────────────────────┐
│ Header: Search · Notification · User Menu       │
├──────────┬────────────────────────────────────┤
│ Sidebar  │ Breadcrumb                          │
│ (ซ้าย)   │ Content Area                        │
│          │                                     │
└──────────┴────────────────────────────────────┘
```

## เมนู Sidebar
1. ภาพรวม (Dashboard)
2. วัตถุดิบและสินค้า
3. สูตรและเมนู
4. คำนวณต้นทุน
5. ราคาขายและกำไร
6. รับสินค้าเข้าคลัง
7. การผลิต
8. คลังสินค้า
9. โอนคลัง
10. ตรวจนับและปรับสต๊อก
11. รายงาน
12. ผู้ใช้งาน
13. ประวัติการใช้งาน
14. ตั้งค่าระบบ

## ระบบสี (Design Tokens)
ใช้ CSS variables (shadcn/ui) รองรับ light/dark
สีสถานะให้ใช้สม่ำเสมอ:
| สถานะ | สี |
|-------|----|
| สำเร็จ / ปกติ | เขียว |
| เตือน / ใกล้หมด | เหลือง/ส้ม |
| อันตราย / หมดอายุ / ติดลบ | แดง |
| ข้อมูล / ร่าง | น้ำเงิน/เทา |

## ตาราง (TanStack Table)
ต้องมี: Search, Filter, Pagination, Sorting, Column Visibility, Export, Empty State, Loading Skeleton, Error State

## ฟอร์ม (React Hook Form + Zod)
ต้องมี: Validation ภาษาไทย, Required indicator, Confirmation Dialog, Toast, ป้องกัน submit ซ้ำ (disable + loading), เตือนเมื่อมีข้อมูลยังไม่บันทึก (dirty guard)

## ตัวเลข & หน่วย
- แสดงหน่วยชัดเจนเสมอ (เช่น "12.50 กก.")
- จัดชิดขวาสำหรับตัวเลข, ใส่ตัวคั่นหลักพัน
- เงินแสดง 2 ตำแหน่ง, ปริมาณตามความเหมาะสม

## Accessibility
- Contrast เพียงพอ, focus ring ชัด, ปุ่มมี label, รองรับ keyboard

---

# Enterprise Shell (อัปเดต 2026-08-06)

## Design Tokens (CSS variables ใน `frontend/src/index.css`)
- แบรนด์: `--navy #0b2345`, `--blue #1c639d`, `--gold #c7a24a` (+ soft variants)
- Surface: `--bg` เทาอมฟ้า, `--surface` ขาว, `--border`, `--surface-2`
- สถานะ: `--success/--warning/--danger/--info` + `-bg` (ใช้คู่สี + ข้อความ/จุดเสมอ ห้ามสื่อด้วยสีอย่างเดียว)
- Radius การ์ด `--radius-card 16px`, shadow เบา `--shadow-sm/-card/-pop`
- Layout: `--sidebar-w 264px`, `--sidebar-w-collapsed 76px`, `--header-h 64px`, `--content-max 1560px`
- พื้นหลัง app มี grid + radial glow จาง ๆ (`.app-shell::before`) ไม่รบกวนการอ่าน

## โครงสร้าง Component (reusable)
- `components/layout/`: `AppLayout` (shell + collapse/drawer state), `Sidebar`, `Header`, `nav-config.ts` (source of truth เมนู 14 รายการ/4 หมวด + metadata โมดูล)
- `components/ui/`: `Badge`, `Avatar`, `Skeleton`, `EmptyState`, `SystemStatus`, `Toast`, `ConfirmDialog`
- `components/ModulePlaceholder.tsx`: หน้า placeholder กลาง (props: title, description, icon, status, plannedFeatures)
- แยกไฟล์เล็ก ไม่รวมเป็นไฟล์ใหญ่; ใช้ token กลาง ไม่ hardcode สีซ้ำ

## Sidebar
หมวด: ภาพรวม · การจัดการสินค้า · คลังและการผลิต · ระบบและรายงาน — active state มีแถบทอง, ย่อ/ขยายได้ (จำใน localStorage) + tooltip เมื่อย่อ, scroll ได้, ล่างแสดง user/role/logout, กรองตาม `requiredRole` (SUPER_ADMIN สำหรับผู้ใช้งาน/ประวัติ/ตั้งค่า)

## Header
collapse toggle + drawer (mobile), page title + breadcrumb (จาก `nav-config`), search placeholder, **System Status จาก Health API จริง** (dot เขียว/แดง + ข้อความ, ห้าม hardcode), วันที่, ปุ่มแจ้งเตือน, user dropdown (โปรไฟล์/เปลี่ยนรหัสผ่าน/ออกจากระบบ). บน tablet ซ่อน search/วันที่

## Dashboard (6 ส่วน)
Welcome+Quick Actions → System Overview (health+user จริง) → ERP Module Status (**ระบุชัดว่าเป็นสถานะการพัฒนา ไม่ใช่ข้อมูลธุรกิจ**) → Quick Navigation (bento) → Recent Activity (audit จริง หรือ empty state) → Setup Progress (นับจาก `/api/dashboard/summary` จริง). ห้าม hardcode ว่าเสร็จทั้งหมด

## States & Micro-interactions
Loading = skeleton shimmer, Empty/Error = `EmptyState`, Toast ภาษาไทย, Confirmation dialog ก่อน action. Motion สุภาพ (fade-in, card lift, status pulse เฉพาะ System Status) และเคารพ `prefers-reduced-motion`

## Responsive
Desktop/Laptop เต็มพื้นที่ (max 1560px), Tablet ซ่อนองค์ประกอบรอง, Mobile = sidebar เป็น drawer + backdrop, ตาราง scroll แนวนอน
