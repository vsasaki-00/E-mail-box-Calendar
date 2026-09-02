'use client';

import { useActionState, useState, useTransition } from 'react';
import { confirmarEntrada, descartarEntrada, type ResultadoEntrada } from './actions';

/**
 * Uma proposta vinda do WhatsApp, editável antes de virar lançamento.
 *
 * Tudo editável de propósito: o parser lê uma frase digitada com pressa, e
 * a chance de acertar valor E descrição E categoria é baixa. A proposta
 * economiza digitação; a decisão é sua.
 */

export interface PropostaItem {
  id: string;
  valor: string;
  direcao: string;
  descricao: string;
  dataIso: string;
  categoria: string | null;
  negocio: string | null;
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

export function PropostaForm({
  item,
  contas,
  categorias,
  negocios,
}: {
  item: PropostaItem;
  contas: { id: string; label: string }[];
  categorias: readonly string[];
  negocios: readonly string[];
}) {
  const [estado, acao, enviando] = useActionState<ResultadoEntrada | null, FormData>(
    async (anterior, form) => {
      const r = await confirmarEntrada(item.id, anterior, form);
      if (r.ok) window.location.reload();
      return r;
    },
    null,
  );
  const [descartando, iniciarDescarte] = useTransition();

  if (contas.length === 0) {
    return (
      <p className="sub" style={{ fontSize: 12, color: 'var(--crit)' }}>
        Nenhuma conta cadastrada — <a href="/financeiro/extrato">importe um extrato</a> antes de lançar.
      </p>
    );
  }

  return (
    <form action={acao} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
      <select name="direcao" defaultValue={item.direcao} style={campo}>
        <option value="SAIDA">saiu</option>
        <option value="ENTRADA">entrou</option>
      </select>
      <label style={{ fontSize: 12, color: 'var(--muted)' }}>
        R${' '}
        <input name="valor" defaultValue={item.valor} required inputMode="decimal" style={{ ...campo, width: 100 }} />
      </label>
      <input name="descricao" defaultValue={item.descricao} placeholder="descrição" style={{ ...campo, minWidth: 200 }} />
      <input type="date" name="data" defaultValue={item.dataIso} required style={campo} />
      <select name="conta" defaultValue={contas[0]?.id} style={campo}>
        {contas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <select name="categoria" defaultValue={item.categoria ?? ''} style={campo}>
        <option value="">(sem categoria)</option>
        {categorias.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select name="negocio" defaultValue={item.negocio ?? ''} style={campo}>
        <option value="">(negócio da conta)</option>
        {negocios.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>

      <button
        type="submit"
        disabled={enviando}
        style={{ ...campo, cursor: enviando ? 'progress' : 'pointer', border: '1px solid var(--ok)', color: 'var(--ok)' }}
      >
        {enviando ? 'lançando…' : 'lançar'}
      </button>
      <button
        type="button"
        disabled={descartando}
        onClick={() => iniciarDescarte(async () => { await descartarEntrada(item.id); window.location.reload(); })}
        style={{ ...campo, cursor: 'pointer', background: 'transparent', color: 'var(--muted)' }}
      >
        {descartando ? '…' : 'não é lançamento'}
      </button>
      {estado?.erro && <span style={{ fontSize: 11, color: 'var(--crit)' }}>{estado.erro}</span>}
    </form>
  );
}

export function BotaoDescartar({ mensagemId }: { mensagemId: string }) {
  const [pendente, iniciar] = useTransition();
  return (
    <button
      type="button"
      disabled={pendente}
      onClick={() => iniciar(async () => { await descartarEntrada(mensagemId); window.location.reload(); })}
      style={{ ...campo, cursor: 'pointer', background: 'transparent', color: 'var(--muted)' }}
    >
      {pendente ? '…' : 'descartar'}
    </button>
  );
}
