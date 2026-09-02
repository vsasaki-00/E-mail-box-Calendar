'use client';

import { useActionState, useState } from 'react';
import { atualizarConta, type ResultadoConta } from './actions';

/**
 * Edicao inline de uma conta. Escondida atras de "editar" para a lista
 * continuar escaneavel; ao salvar, a pagina recarrega para refletir.
 */

export interface ContaEditavel {
  id: string;
  label: string;
  institution: string | null;
  kind: string;
  business: string | null;
}

const campo = {
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 12,
  fontFamily: 'inherit',
} as const;

const TIPOS: [string, string][] = [
  ['CHECKING', 'conta corrente'],
  ['SAVINGS', 'poupança'],
  ['CREDIT_CARD', 'cartão de crédito'],
  ['CASH', 'dinheiro'],
  ['INVESTMENT', 'investimento'],
  ['OTHER', 'outra'],
];

export function EditarConta({ conta, negocios }: { conta: ContaEditavel; negocios: readonly string[] }) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, enviando] = useActionState<ResultadoConta | null, FormData>(
    async (anterior, form) => {
      const r = await atualizarConta(conta.id, anterior, form);
      if (r.ok) window.location.reload();
      return r;
    },
    null,
  );

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        style={{ ...campo, cursor: 'pointer', background: 'transparent', color: 'var(--muted)' }}
        title="Nome, banco, tipo e negócio desta conta"
      >
        editar
      </button>
    );
  }

  return (
    <form action={acao} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
      <input name="label" defaultValue={conta.label} placeholder="Nome (ex.: Nubank PJ Unitedcom)" required style={{ ...campo, minWidth: 220 }} />
      <input name="institution" defaultValue={conta.institution ?? ''} placeholder="Banco (ex.: Nubank)" style={{ ...campo, width: 140 }} />
      <select name="kind" defaultValue={conta.kind} style={campo}>
        {TIPOS.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
      <select name="business" defaultValue={conta.business ?? ''} style={campo}>
        <option value="">negócio: (nenhum)</option>
        {negocios.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <button type="submit" disabled={enviando} style={{ ...campo, cursor: enviando ? 'progress' : 'pointer', background: 'var(--surface)' }}>
        {enviando ? 'salvando…' : 'salvar'}
      </button>
      <button type="button" onClick={() => setAberto(false)} style={{ ...campo, cursor: 'pointer', background: 'transparent', color: 'var(--muted)' }}>
        cancelar
      </button>
      {estado?.erro && <span style={{ fontSize: 11, color: 'var(--crit)' }}>{estado.erro}</span>}
    </form>
  );
}
