'use client';

import { useActionState } from 'react';
import { extrairCobrancas, type AcaoResultado } from './actions';

export function ExtrairForm({ temChave }: { temChave: boolean }) {
  const [estado, acao, rodando] = useActionState<AcaoResultado | null>(extrairCobrancas, null);

  return (
    <form action={acao} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        type="submit"
        disabled={rodando}
        style={{
          padding: '7px 14px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--text)',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        {rodando ? 'lendo as cobranças…' : 'Extrair cobranças'}
      </button>
      {!temChave && (
        <span className="sub" style={{ fontSize: 12 }}>
          Sem <code>ANTHROPIC_API_KEY</code>: roda só a leitura local de boleto e PIX.
        </span>
      )}
      {estado?.mensagem && (
        <span className="sub" style={{ color: 'var(--ok)' }}>{estado.mensagem}</span>
      )}
      {estado?.erro && <span className="sub" style={{ color: 'var(--crit)' }}>{estado.erro}</span>}
    </form>
  );
}
