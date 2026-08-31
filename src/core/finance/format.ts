/** Formatacao compartilhada entre servidor e cliente. Ver fase 5B. */

/**
 * Valor em centavos para real. `null` vira travessao, nunca "R$ 0,00":
 * "nao identificado" e "zero" sao coisas diferentes num painel de contas.
 */
export function formatarValor(cents: number | null): string {
  if (cents === null) return '—';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
