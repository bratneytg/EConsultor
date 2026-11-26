import type { AdviceResponse, BillingInfo, Overview, Recurring, RecurringInput, Transaction, TransactionInput } from '@econsultor/shared';
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

export const useAccounts = (enabled = true) =>
  useQuery({ queryKey: ['accounts'], queryFn: () => api<{ accounts: { name: string; count: number }[] }>('/import/accounts').then((r) => r.accounts), enabled, staleTime: 60_000 });

export const useAdvice = () => useQuery({ queryKey: ['advice'], queryFn: () => api<AdviceResponse>('/advice') });
export const useDetailedAdvice = (enabled: boolean) => useQuery({ queryKey: ['advice', 'detailed'], queryFn: () => api<AdviceResponse>('/advice/detailed'), enabled });

export const useBilling = () => useQuery({ queryKey: ['billing'], queryFn: () => api<BillingInfo>('/billing'), staleTime: 30_000 });

export const useAppConfig = () =>
  useQuery({ queryKey: ['config'], queryFn: () => api<{ googleClientId: string | null; demo: boolean; ai: boolean; apkUrl: string | null }>('/config'), staleTime: Infinity });

export function useInvalidateData() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['overview'] }), qc.invalidateQueries({ queryKey: ['tx'] }), qc.invalidateQueries({ queryKey: ['advice'] }), qc.invalidateQueries({ queryKey: ['accounts'] }), qc.invalidateQueries({ queryKey: ['recurring'] })]);
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

export const useRecurring = () =>
  useQuery({ queryKey: ['recurring'], queryFn: () => api<{ items: Recurring[] }>('/recurring').then((r) => r.items) });

/** Crear o cambiar un gasto/ingreso periódico. Al guardarse puede anotar ya el cargo de este mes, así que se refrescan los datos. */
export function useSaveRecurring() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: Partial<RecurringInput> }) =>
      id ? api<Recurring>(`/recurring/${id}`, { method: 'PATCH', json: data }) : api<Recurring>('/recurring', { method: 'POST', json: data }),
    onSuccess: invalidate,
  });
}

export function useDeleteRecurring() {
  const invalidate = useInvalidateData();
  return useMutation({ mutationFn: (id: string) => api<void>(`/recurring/${id}`, { method: 'DELETE' }), onSuccess: invalidate });
}
