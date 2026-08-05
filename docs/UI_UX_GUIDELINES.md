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
