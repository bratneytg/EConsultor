import type { AdviceResponse, Overview, Transaction, TransactionInput } from '@econsultor/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const useOverview = (month: string) =>
  useQuery({ queryKey: ['overview', month], queryFn: () => api<Overview>(`/analytics/overview?month=${month}`), placeholderData: keepPreviousData });

export const useMonthTransactions = (month: string) =>
  useQuery({
    queryKey: ['tx', month],
    queryFn: () => api<{ items: Transaction[] }>(`/transactions?from=${month}-01&to=${month}-31&limit=2000`).then((r) => r.items),
    placeholderData: keepPreviousData,
  });

export const useAdvice = () => useQuery({ queryKey: ['advice'], queryFn: () => api<AdviceResponse>('/advice') });

export const useAppConfig = () =>
  useQuery({ queryKey: ['config'], queryFn: () => api<{ googleClientId: string | null; demo: boolean; ai: boolean; apkUrl: string | null }>('/config'), staleTime: Infinity });

export function useInvalidateData() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['overview'] }), qc.invalidateQueries({ queryKey: ['tx'] }), qc.invalidateQueries({ queryKey: ['advice'] })]);
}

export function useSaveTransaction() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: Omit<TransactionInput, 'currency'> }) =>
      id ? api<Transaction>(`/transactions/${id}`, { method: 'PATCH', json: data }) : api<Transaction>('/transactions', { method: 'POST', json: data }),
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateData();
  return useMutation({ mutationFn: (id: string) => api<void>(`/transactions/${id}`, { method: 'DELETE' }), onSuccess: invalidate });
}
