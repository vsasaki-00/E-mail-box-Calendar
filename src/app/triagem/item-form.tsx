'use client';

import { useActionState, useState } from 'react';
import { corrigirTriagem, type CorrigirResultado } from './actions';

/**
 * Uma linha da triagem, com correcao inline.
 *
 * Ver docs/07-agente-de-triagem.md — a correcao fica ESCONDIDA por tras de
 * "discordo" de proposito: a lista precisa ser escaneavel em segundos, e
 * abrir seis selects em cada item transformaria a triagem num formulario.
 */

export interface ItemTriagem {
  unifiedItemId: string;
  title: string;
  preview: string;
  occurredAt: string;
  category: string;
  priority: string;
  needsReply: boolean;
  confidence: number;
  reason: string | null;
  source: string;
  /** Em quantas caixas este mesmo item existe. */
  copyCount: number;
}

export const CATEGORIA_LABEL: Record<string, string> = {
  COBRANCA: 'cobrança',
  NEEDS_REPLY: 'precisa resposta',
  INFORMATIVE: 'informativo',
  PROMOTIONAL: 'promocional',
  SPAM: 'spam',
  DISPOSABLE: 'descartável',
};

export const PRIORIDADE_LABEL: Record<string, string> = {
  URGENT: 'urgente',
  HIGH: 'alta',
  NORMAL: 'normal',
  LOW: 'baixa',
};

function classePorCategoria(categoria: string): string {
  if (categoria === 'COBRANCA') return 'warn';
  if (categoria === 'NEEDS_REPLY') return 'crit';
  if (categoria === 'SPAM' || categoria === 'DISPOSABLE') return 'warn';
  return 'ok';
}

const seletor = {
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 12,
  fontFamily: 'inherit',
} as const;

const LIMITE_BAIXA_CONFIANCA = 0.6;

export function ItemTriagemLinha({ item }: { item: ItemTriagem }) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, enviando] = useActionState<CorrigirResultado | null, FormData>(
    corrigirTriagem.bind(null, item.unifiedItemId),
    null,
  );

  const baixaConfianca = item.confidence < LIMITE_BAIXA_CONFIANCA;
  const corrigido = item.source === 'USER';

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border)',
        padding: '12px 0',
        // Confianca baixa nunca some da lista: e o item que precisa de olho.
        borderLeft: baixaConfianca ? '3px solid var(--warn)' : '3px solid transparent',
        paddingLeft: 10,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`pill ${classePorCategoria(item.category)}`}>
              {CATEGORIA_LABEL[item.category] ?? item.category}
            </span>
            {item.priority !== 'NORMAL' && (
              <span className={`pill ${item.priority === 'URGENT' ? 'crit' : 'warn'}`}>
                {PRIORIDADE_LABEL[item.priority] ?? item.priority}
              </span>
            )}
            {corrigido && (
              <span className="pill ok" title="Você corrigiu — não será reclassificado">
                corrigido por você
              </span>
            )}
            {item.copyCount > 1 && (
              <span className="sub" style={{ fontSize: 11 }}>
                {item.copyCount} caixas
              </span>
            )}
          </div>

          <div style={{ marginTop: 6, fontWeight: 500, fontSize: 13 }}>{item.title}</div>
          <div className="sub" style={{ fontSize: 12 }}>
            {item.preview} · {item.occurredAt}
          </div>

          {item.reason && (
            // O motivo e o que permite discordar de forma informada, em vez
            // de so ver um rotulo.
            <div className="sub" style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic' }}>
              {item.reason}
              {!corrigido && ` · confiança ${Math.round(item.confidence * 100)}%`}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          style={{
            flex: 'none',
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text)',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          {aberto ? 'fechar' : 'discordo'}
        </button>
      </div>

      {aberto && (
        <form
          action={acao}
          style={{
            marginTop: 10,
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            alignItems: 'center',
            background: 'var(--bg)',
            padding: 10,
            borderRadius: 6,
          }}
        >
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>
            categoria{' '}
            <select name="category" defaultValue={item.category} style={seletor}>
              {Object.entries(CATEGORIA_LABEL).map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 12, color: 'var(--muted)' }}>
            prioridade{' '}
            <select name="priority" defaultValue={item.priority} style={seletor}>
              {Object.entries(PRIORIDADE_LABEL).map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 12, display: 'flex', gap: 5, alignItems: 'center' }}>
            <input type="checkbox" name="needsReply" defaultChecked={item.needsReply} />
            precisa de resposta
          </label>

          <button
            type="submit"
            disabled={enviando}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              cursor: enviando ? 'default' : 'pointer',
              fontSize: 12,
            }}
          >
            {enviando ? 'salvando…' : 'corrigir'}
          </button>

          {estado?.ok && (
            <span className="sub" style={{ color: 'var(--ok)', fontSize: 12 }}>
              corrigido
            </span>
          )}
          {estado?.erro && (
            <span className="sub" style={{ color: 'var(--crit)', fontSize: 12 }}>
              {estado.erro}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
