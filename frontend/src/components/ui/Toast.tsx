import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastVariant = 'success' | 'info' | 'warning' | 'error' | 'action';
export interface ToastOptions { title: string; description?: string; variant?: ToastVariant; actionLabel?: string; onAction?: () => void; duration?: number }
interface ToastItem extends ToastOptions { id:number;variant:ToastVariant }
interface ToastApi { toast: (message: string | ToastOptions, variant?: ToastVariant) => void }
const ToastContext=createContext<ToastApi|null>(null);
const icons={success:CheckCircle2,info:Info,warning:AlertTriangle,error:XCircle,action:BellRing};

export function ToastProvider({children}:{children:ReactNode}){const [items,setItems]=useState<ToastItem[]>([]);const nextId=useRef(1);const dismiss=useCallback((id:number)=>setItems(prev=>prev.filter(t=>t.id!==id)),[]);const toast=useCallback((input:string|ToastOptions,legacyVariant:ToastVariant='success')=>{const options:ToastOptions=typeof input==='string'?{title:input,variant:legacyVariant}:input;const id=nextId.current++;const item:ToastItem={id,...options,variant:options.variant??'success'};setItems(prev=>[...prev.slice(-3),item]);window.setTimeout(()=>dismiss(id),options.duration??4600);},[dismiss]);const api=useMemo(()=>({toast}),[toast]);return <ToastContext.Provider value={api}>{children}<div className="toast-stack" aria-live="polite" aria-relevant="additions">{items.map(t=>{const Icon=icons[t.variant];return <article key={t.id} className={`toast ${t.variant}`} role={t.variant==='error'?'alert':'status'}><Icon aria-hidden/><div><strong>{t.title}</strong>{t.description&&<p>{t.description}</p>}{t.actionLabel&&t.onAction&&<button onClick={t.onAction}>{t.actionLabel}</button>}</div><button className="toast-close" aria-label="ปิด" onClick={()=>dismiss(t.id)}><X/></button></article>})}</div></ToastContext.Provider>}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast():ToastApi{const ctx=useContext(ToastContext);if(!ctx)throw new Error('useToast must be used inside ToastProvider');return ctx;}
