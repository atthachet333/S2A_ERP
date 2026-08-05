import { QueryClient } from '@tanstack/react-query';

/** TanStack Query client กลาง */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});
