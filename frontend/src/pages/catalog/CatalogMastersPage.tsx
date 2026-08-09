import { FormEvent, useEffect, useState } from 'react';
import { catalogApi, type Category, type Unit, type UnitConversion } from '@/lib/catalog';

export default function CatalogMastersPage({ section }: { section: 'units' | 'categories' }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [conversions, setConversions] = useState<UnitConversion[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const load = async () => {
    const [u, c, cv] = await Promise.all([catalogApi.units(), catalogApi.categories(), catalogApi.conversions()]);
    setUnits(u); setCategories(c); setConversions(cv);
  };
  useEffect(() => { void load().catch((e: Error) => setError(e.message)); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    try {
      if (section === 'units') await catalogApi.createUnit({ code, name });
      else await catalogApi.createCategory({ code, name });
      setCode(''); setName(''); await load();
    }
    catch (e) { setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ'); }
  };
  const rows = section === 'units' ? units : categories;
  return <section className="section">
    <div className="section-head"><div><h1>{section === 'units' ? 'หน่วยนับและการแปลงหน่วย' : 'หมวดหมู่วัตถุดิบ'}</h1><p>ข้อมูลจากฐานข้อมูลจริง</p></div></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <form className="card card-pad" onSubmit={submit} style={{display:'grid',gridTemplateColumns:'1fr 2fr auto',gap:12}}>
      <label>รหัส<input value={code} onChange={(e)=>setCode(e.target.value)} required /></label>
      <label>ชื่อ<input value={name} onChange={(e)=>setName(e.target.value)} required /></label>
      <button className="primary-button">เพิ่มข้อมูล</button>
    </form>
    <div className="card card-pad" style={{marginTop:16,overflowX:'auto'}}><table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>สถานะ</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.code}</td><td>{r.name}</td><td>{r.isActive?'ใช้งาน':'ปิดใช้งาน'}</td></tr>)}</tbody></table>{rows.length===0&&<p>ยังไม่มีข้อมูล</p>}</div>
    {section === 'units' && <div className="card card-pad" style={{marginTop:16}}><h2>การแปลงหน่วย</h2>{conversions.map(c=><p key={c.id}>1 {c.fromCode} = {c.factor} {c.toCode}</p>)}{conversions.length===0&&<p>ยังไม่มีการแปลงหน่วย</p>}</div>}
  </section>;
}
