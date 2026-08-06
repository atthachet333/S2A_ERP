import { cn } from '@/lib/utils';

/** แถบ shimmer สำหรับสถานะกำลังโหลด */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={cn('skeleton', className)} style={style} aria-hidden />;
}

/** แถวโครงร่างสำหรับตาราง */
export function SkeletonRows({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c}><Skeleton className="block" style={{ height: 16, width: c === 0 ? '70%' : '55%' }} /></td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
