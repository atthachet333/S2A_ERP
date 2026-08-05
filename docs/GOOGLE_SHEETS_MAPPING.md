# GOOGLE SHEETS MAPPING — S2A ERP

> ⚠️ Google Sheets ใช้เป็น **ข้อมูลอ้างอิงอ่านอย่างเดียว** เพื่อศึกษากระบวนการ/สูตร/รายงานเดิม
> **ห้าม** เขียน / แก้ / ลบ / เปลี่ยนชื่อ sheet / เปลี่ยนสูตร / ใช้เป็นฐานข้อมูลหลัก

## แหล่งอ้างอิง
- ตัวอย่างการทำงาน: `1QX47KmT8au1ZkirKUf4dCsB_ehykR8tTgodLBlBwzk4`
- ข้อมูลเพิ่มเติม: `1cKPD-zpeGZYRNbpZ7dGl2NoMkTcdHX7P8vvuuH9EhcY`

(ใส่ Sheet ID ใน `GOOGLE_REFERENCE_SHEET_ID` เฉพาะเมื่อจะเปิดใช้ read-only)

## การเปิด/ปิด
```
GOOGLE_SHEETS_READ_ENABLED=false   # ค่าเริ่มต้น = ปิด (ปลอดภัย)
```
- เมื่อ `false` → service คืนค่า `db: "disabled"`/ข้าม โดยไม่เรียก Google API
- เมื่อ `true` → ใช้ scope **read-only** เท่านั้น: `https://www.googleapis.com/auth/spreadsheets.readonly`

## แผนการ Map (จะเติมรายละเอียดเมื่อศึกษา sheet จริง)
| แนวคิดในระบบ (PostgreSQL) | คาดว่าอยู่ใน Sheet | หมายเหตุ |
|---------------------------|--------------------|----------|
| Item (วัตถุดิบ/บรรจุภัณฑ์) | ชีทรายการวัตถุดิบ | code, ชื่อ, หน่วย, ราคา |
| Recipe / BOM | ชีทสูตร | ส่วนผสม + ปริมาณ |
| Cost | ชีทต้นทุน | โครงสร้างต้นทุน + สูตรคำนวณ |
| Selling Price | ชีทราคาขาย | markup/margin |
| รายงานสต๊อก | ชีทรายงาน | รูปแบบรายงานเดิม |

## นโยบายการใช้งาน (Read-only Mode)
1. ก่อนเขียนโค้ดเชื่อม ต้องทำ read-only mode และมี env เปิด/ปิดแยก
2. ไม่มี endpoint หรือฟังก์ชันที่เขียนกลับ sheet
3. ข้อมูลที่อ่านมา ใช้เพื่อ import ตั้งต้น/เทียบเท่านั้น — ระบบจริงเก็บใน PostgreSQL
