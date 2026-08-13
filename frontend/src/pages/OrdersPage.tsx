import { useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, FileDown, PackageCheck, Plus, Send, TrendingUp, Users, Archive } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { formatCurrency, formatDate, useI18n } from '@/i18n/i18n';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth/AuthContext';
import CreatableCombobox from '@/components/ui/CreatableCombobox';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import CustomerQuickCreateModal, { type QuickCreatedCustomer } from '@/components/customers/CustomerQuickCreateModal';

type Customer = { id: string; code: string; name: string; contactName?: string; phone?: string; email?: string; address?: string; orderCount?: number; deliveredSales?: string; upcomingOrders?: number; lastOrder?: { orderNo:string; deliveryDate:string; status:string } };
type Order = { id: string; orderNo: string; status: string; deliveryDate: string; deliveryTime?: string; totalAmount: string; customer: Customer; items: { id: string; menuNameSnapshot: string; quantity: string }[] };
const openDocument=async(path:string)=>{const blob=await apiClient.blob(path);const url=URL.createObjectURL(blob);window.open(url,'_blank','noopener,noreferrer');window.setTimeout(()=>URL.revokeObjectURL(url),60000);};

export default function OrdersPage() {
  const { locale, messages } = useI18n(); const text=messages.business;
  const { toast } = useToast(); const { user } = useAuth();
  const canCreateCustomer = (user?.roles.includes('SUPER_ADMIN') ?? false) || (user?.permissions.includes('CUSTOMER_CREATE') ?? false);
  const [orders,setOrders]=useState<Order[]>([]); const [customers,setCustomers]=useState<Customer[]>([]); const [loading,setLoading]=useState(true); const [form,setForm]=useState(false); const [error,setError]=useState('');
  const [customerId,setCustomerId]=useState(''); const [customerModal,setCustomerModal]=useState<{ open: boolean; prefill: string }>({ open: false, prefill: '' });
  const load=async()=>{setLoading(true);try{const [orderData,customerData]=await Promise.all([apiClient.get<Order[]>('/business/orders'),apiClient.get<Customer[]>('/business/customers')]);setOrders(orderData);setCustomers(customerData);}catch(reason){setError(reason instanceof Error?reason.message:'โหลดข้อมูลไม่สำเร็จ');}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);setError('');if(!customerId){setError(text.selectCustomer);return;}try{await apiClient.post('/business/orders',{customerId,deliveryDate:data.get('deliveryDate'),deliveryTime:data.get('deliveryTime'),note:data.get('note'),idempotencyKey:crypto.randomUUID(),items:[{menuId:String(data.get('menuId')),menuNameSnapshot:String(data.get('menuName')),quantity:Number(data.get('quantity')),unit:String(data.get('unit')),unitPrice:Number(data.get('unitPrice'))}]});toast({title:text.orderCreated,variant:'success'});setForm(false);setCustomerId('');await load();}catch(reason){setError(reason instanceof Error?reason.message:'บันทึกไม่สำเร็จ');}};
  const send=async(id:string,status:string)=>{const next=status==='DRAFT'?'CONFIRMED':'SENT_TO_PREP';await apiClient.post(`/business/orders/${id}/transition`,{status:next});await load();};
  const onCustomerCreated=async(c:QuickCreatedCustomer)=>{setCustomerModal({open:false,prefill:''});await load();setCustomerId(c.id);};
  const today=new Date().toISOString().slice(0,10);const todayOrders=orders.filter((o)=>o.deliveryDate.slice(0,10)===today);const pending=orders.filter((o)=>!['DELIVERED','CANCELLED'].includes(o.status));const delivered=orders.filter((o)=>o.status==='DELIVERED');
  return <section className="business-page order-workspace"><header><div><span>ORDER & DELIVERY CONTROL</span><h1>{text.orders}</h1><p>{text.ordersDescription}</p></div><button onClick={()=>setForm(true)}><Plus/>{text.createOrder}</button></header><div className="order-kpis"><article><CalendarDays/><span>{text.deliveryToday}</span><strong>{todayOrders.length}</strong></article><article><PackageCheck/><span>{text.awaitingDelivery}</span><strong>{pending.length}</strong></article><article><TrendingUp/><span>{text.pendingRevenue}</span><strong>{formatCurrency(pending.reduce((s,o)=>s+Number(o.totalAmount),0),locale)}</strong></article><article><TrendingUp/><span>{text.actualSales}</span><strong>{formatCurrency(delivered.reduce((s,o)=>s+Number(o.totalAmount),0),locale)}</strong></article></div>{error&&<div className="auth-alert">{error}</div>}
    {form&&<form className="business-form" onSubmit={(event)=>void submit(event)}><h2>{text.newOrder}</h2>
      <label>{text.customer}
        <CreatableCombobox value={customerId} onChange={setCustomerId}
          options={customers.map((c)=>({value:c.id,label:c.name,sublabel:[c.code,c.phone].filter(Boolean).join(' · ')}))}
          placeholder={text.selectCustomer} searchPlaceholder={text.searchCustomer} emptyText={text.noCustomerFound}
          createLabel={canCreateCustomer?text.addNewCustomer:undefined}
          onCreate={canCreateCustomer?((query)=>setCustomerModal({open:true,prefill:query})):undefined}
          ariaLabel={text.customer} />
      </label>
      <label>{text.deliveryDate}<input name="deliveryDate" type="date" required/></label><label>{text.deliveryTime}<input name="deliveryTime" type="time"/></label><label>{text.menuCode}<input name="menuId" required/></label><label>{text.menuName}<input name="menuName" required/></label><label>{text.quantity}<input name="quantity" type="number" min="0.0001" step="0.0001" required/></label><label>{text.unit}<input name="unit" defaultValue="กล่อง" required/></label><label>{text.unitPrice}<input name="unitPrice" type="number" min="0" step="0.01" required/></label><label className="wide">{text.notes}<textarea name="note"/></label><div className="wide form-actions"><button type="button" className="secondary" onClick={()=>{setForm(false);setCustomerId('');}}>{messages.common.cancel}</button><button>{text.saveDraft}</button></div></form>}
    {loading?<div className="company-empty">{text.loadingOrders}</div>:orders.length===0?<div className="business-empty"><CalendarDays/><h2>{text.noOrders}</h2><p>{text.noOrdersDescription}</p></div>:<div className="business-table"><div className="business-row head"><span>{text.orderNumber}</span><span>{text.customer}</span><span>{text.deliveryDate}</span><span>{text.amount}</span><span>{text.status}</span><span>{text.actions}</span></div>{orders.map(order=><div className="business-row" key={order.id}><strong>{order.orderNo}</strong><span>{order.customer.name}</span><span>{formatDate(order.deliveryDate,locale)} {order.deliveryTime}</span><span>{formatCurrency(Number(order.totalAmount),locale)}</span><span className={`order-status ${order.status.toLowerCase()}`}>{messages.status[order.status as keyof typeof messages.status]??order.status}</span><span className="order-row-actions">{['DRAFT','CONFIRMED'].includes(order.status)&&<button className="row-action" onClick={()=>void send(order.id,order.status)}><Send/>{order.status==='DRAFT'?messages.common.confirm:text.sendToPrep}</button>}<button className="row-action" onClick={()=>void openDocument(`/business/documents/ORDER_SLIP/${order.id}.pdf`)}><FileDown/>PDF</button></span></div>)}</div>}
    {customerModal.open&&<CustomerQuickCreateModal prefillName={customerModal.prefill} onClose={()=>setCustomerModal({open:false,prefill:''})} onCreated={(c)=>void onCustomerCreated(c)} />}
  </section>;
}

export function CustomersPage(){
  const { messages } = useI18n(); const text = messages.business; const { toast } = useToast(); const { user } = useAuth();
  const canCreate = (user?.roles.includes('SUPER_ADMIN') ?? false) || (user?.permissions.includes('CUSTOMER_CREATE') ?? false);
  const canEdit = (user?.roles.includes('SUPER_ADMIN') ?? false) || (user?.permissions.includes('CUSTOMER_EDIT') ?? false);
  const [items,setItems]=useState<Customer[]>([]);const [error,setError]=useState('');
  const [modal,setModal]=useState(false); const [archiving,setArchiving]=useState<Customer|null>(null);
  const load=()=>apiClient.get<Customer[]>('/business/customers?hasOrders=1').then(setItems).catch((e:Error)=>setError(e.message));
  useEffect(()=>{void load();},[]);
  const archive=async(c:Customer)=>{try{await apiClient.post(`/business/customers/${c.id}/archive`);toast({title:text.customerArchived,variant:'success'});await load();}catch(e){toast({title:e instanceof Error?e.message:'error',variant:'error'});}};
  return <section className="business-page customer-workspace"><header><div><span>CUSTOMER INTELLIGENCE</span><h1>{text.customers}</h1><p>{text.customersDescription}</p><p style={{fontSize:12,color:'var(--text-subtle)',margin:'4px 0 0'}}>{text.orderedOnly}</p></div>{canCreate?<button onClick={()=>setModal(true)}><Plus/>{text.addCustomer}</button>:<Users/>}</header>{error&&<div className="auth-alert">{error}</div>}
    <div className="customer-grid rich">{items.map(c=><article key={c.id}><div className="customer-card-head"><b>{c.name.slice(0,2).toUpperCase()}</b><div><small>{c.code}</small><h3>{c.name}</h3></div>{canEdit&&<button className="icon-btn" title={text.archive} aria-label={text.archive} onClick={()=>setArchiving(c)}><Archive width={16} aria-hidden/></button>}</div><dl><div><dt>{text.contact}</dt><dd>{c.contactName||'—'}</dd></div><div><dt>{text.phone}</dt><dd>{c.phone||'—'}</dd></div><div><dt>{text.email}</dt><dd>{c.email||'—'}</dd></div><div><dt>{text.totalOrders}</dt><dd>{c.orderCount??0}</dd></div><div><dt>{text.upcomingOrders}</dt><dd>{c.upcomingOrders??0}</dd></div><div><dt>{text.actualSales}</dt><dd>฿{Number(c.deliveredSales??0).toLocaleString('th-TH')}</dd></div></dl>{c.lastOrder&&<footer>{text.latest} {c.lastOrder.orderNo} · {new Date(c.lastOrder.deliveryDate).toLocaleDateString('th-TH')}</footer>}</article>)}</div>
    {items.length===0&&!error&&<div className="business-empty"><Users/><h2>{text.noCustomers}</h2></div>}
    {modal&&<CustomerQuickCreateModal onClose={()=>setModal(false)} onCreated={()=>{setModal(false);void load();}} />}
    <ConfirmDialog open={Boolean(archiving)} title={text.archiveTitle} description={text.archiveDetail} tone="danger" confirmLabel={text.archive} cancelLabel={messages.common.cancel} onConfirm={()=>{if(archiving)void archive(archiving);}} onClose={()=>setArchiving(null)} />
  </section>;
}
