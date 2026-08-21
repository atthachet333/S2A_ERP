import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, Copy, FileText, FolderOpen, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogApi, type RecipeRow } from '@/lib/catalog';
import { ApiClientError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { PageContainer, PageHeader, FilterBar } from '@/components/layout/page';

type Scope='active'|'archived';
const money=(value:number|null|undefined)=>value==null?'—':`฿${value.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:4})}`;

export default function RecipeListPage(){
 const nav=useNavigate(),qc=useQueryClient(),{toast}=useToast();
 const [scope,setScope]=useState<Scope>('active'),[search,setSearch]=useState(''),[status,setStatus]=useState('all');
 const query=useQuery({queryKey:['recipes',scope],queryFn:()=>scope==='active'?catalogApi.recipes():catalogApi.archivedRecipes()});
 const rows=useMemo(()=>{const term=search.trim().toLocaleLowerCase();return (query.data??[]).filter(r=>(!term||`${r.code} ${r.name} ${r.product.name}`.toLocaleLowerCase().includes(term))&&(status==='all'||(status==='costed'?(r.totalCost??0)>0:(r.totalCost??0)<=0)));},[query.data,search,status]);
 const refresh=()=>qc.invalidateQueries({queryKey:['recipes']});
 async function act(action:'duplicate'|'archive'|'restore'|'delete',r:RecipeRow){try{if(action==='duplicate'){const copy=await catalogApi.duplicateRecipe(r.id);toast('ทำสำเนาสูตรสำเร็จ');nav(`/recipes/${copy.id}`);return}if(action==='archive'){await catalogApi.archiveRecipe(r.id);toast('เก็บสูตรถาวรแล้ว')}if(action==='restore'){await catalogApi.restoreRecipe(r.id);toast('กู้คืนสูตรแล้ว')}if(action==='delete'){await catalogApi.deleteRecipe(r.id);toast('ลบสูตรแล้ว')}await refresh()}catch(e){if(e instanceof ApiClientError&&e.code==='RECIPE_IN_USE')toast({title:'สูตรนี้มีประวัติการใช้งาน จึงไม่สามารถลบถาวรได้',variant:'warning',actionLabel:'เก็บถาวรแทน',onAction:()=>void act('archive',r)});else toast({title:e instanceof Error?e.message:'เกิดข้อผิดพลาด',variant:'error'})}}
 return <PageContainer className="recipe-list-v2">
  <PageHeader
   breadcrumb="RECIPE PORTFOLIO"
   title="สูตรเมนูอาหาร"
   description="จัดการ Yield ต้นทุน เวอร์ชัน และสถานะสูตรจากพื้นที่เดียว"
   actions={<Link className="btn primary" to="/recipes/new"><Plus/>สร้างสูตรใหม่</Link>}
  />
  <FilterBar actions={<div className="rb2-tabs"><button className={scope==='active'?'active':''} onClick={()=>setScope('active')}>ใช้งาน</button><button className={scope==='archived'?'active':''} onClick={()=>setScope('archived')}>เก็บถาวร</button></div>}>
   <input className="s2-search" aria-label="ค้นหาสูตร" placeholder="ค้นหารหัส ชื่อสูตร หรือเมนู" value={search} onChange={e=>setSearch(e.target.value)}/>
   <select aria-label="กรองสถานะต้นทุน" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">ทุกสถานะ</option><option value="costed">คำนวณแล้ว</option><option value="missing">รอต้นทุน</option></select>
  </FilterBar>
  {query.isError&&<div className="rb2-alert">{query.error.message}</div>}
  <div className="recipe-table"><div className="recipe-table-head"><span>รหัสสูตร</span><span>ชื่อสูตร / เมนู</span><span>Version</span><span>Yield</span><span>ต้นทุนรวม</span><span>ต้นทุนต่อหน่วย</span><span>ราคาขาย</span><span>Margin</span><span>สถานะ</span><span>การจัดการ</span></div>{rows.map(r=><article key={r.id} className="recipe-table-row"><span data-label="รหัสสูตร"><b>{r.code}</b></span><span data-label="ชื่อสูตร / เมนู"><Link to={`/recipes/${r.id}`}>{r.name}</Link><small>{r.product.name}</small></span><span data-label="Version">V{r.activeVersionNo??r.versionCount}</span><span data-label="Yield">{r.yield??'—'} {r.yieldUnit??''}</span><span data-label="ต้นทุนรวม">{money(r.totalCost)}</span><span data-label="ต้นทุนต่อหน่วย">{money(r.unitCost)}</span><span data-label="ราคาขาย">—</span><span data-label="Margin">—</span><span data-label="สถานะ"><i className={r.isActive?'active':'archived'}>{r.isActive?'ใช้งาน':'เก็บถาวร'}</i></span><span className="recipe-row-actions" data-label="การจัดการ"><Link title="เปิด" to={`/recipes/${r.id}`}><FolderOpen/></Link><Link title="แก้ไข" to={`/recipes/${r.id}`}><Pencil/></Link><button title="ทำสำเนา" onClick={()=>void act('duplicate',r)}><Copy/></button><Link title="พิมพ์" to={`/recipes/${r.id}?print=1`}><FileText/></Link>{r.isActive?<button title="เก็บถาวร" onClick={()=>void act('archive',r)}><Archive/></button>:<button title="กู้คืน" onClick={()=>void act('restore',r)}><RotateCcw/></button>}<button title="ลบ" onClick={()=>window.confirm(`ลบสูตร ${r.name}?`)&&void act('delete',r)}><Trash2/></button></span></article>)}</div>
  {!query.isLoading&&!rows.length&&<div className="recipe-list-empty">ไม่พบสูตรที่ตรงกับตัวกรอง</div>}
 </PageContainer>
}
