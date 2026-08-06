import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface ActivityEntry {
  id: string;
  type: 'AUDIT' | 'LOGIN';
  action: string;
  entity: string | null;
  actor: string | null;
  success: boolean;
  ip: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * ประวัติการใช้งานจริงจาก backend (SUPER_ADMIN เท่านั้น)
 * @param enabled ควบคุมการยิง query ตามสิทธิ์ผู้ใช้
 */
export function useActivity(page = 1, pageSize = 20, enabled = true) {
  return useQuery({
    queryKey: ['activity', page, pageSize],
    queryFn: () => apiClient.get<Paginated<ActivityEntry>>(`/activity?page=${page}&pageSize=${pageSize}`),
    enabled,
  });
}
