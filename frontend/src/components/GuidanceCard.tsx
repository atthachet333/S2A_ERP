import { CircleHelp, Info } from 'lucide-react';
import type { ReactNode } from 'react';

export function GuidanceCard({title='วิธีกรอกข้อมูล / Quick Guide',children}:{title?:string;children:ReactNode}){
 return <aside className="guidance-card" aria-label={title}><Info aria-hidden/><div><strong>{title}</strong><div>{children}</div></div></aside>;
}
export function HelpTip({label,children}:{label:string;children:ReactNode}){
 return <span className="help-tip"><button type="button" aria-label={`คำอธิบาย ${label}`}><CircleHelp aria-hidden/></button><span role="tooltip">{children}</span></span>;
}
export function StatusChip({label,tone='muted'}:{label:string;tone?:string}){return <span className={`badge ${tone}`}>{label}</span>}
