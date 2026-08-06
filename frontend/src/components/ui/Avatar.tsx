import { cn, initials } from '@/lib/utils';

/** วงกลม/สี่เหลี่ยมแสดงอักษรย่อของผู้ใช้ */
export default function Avatar({ name, size = 'md' }: { name?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cn('avatar-initial', size === 'sm' && 'sm', size === 'lg' && 'lg')} aria-hidden>
      {initials(name)}
    </span>
  );
}
