'use client';

import { useState, useTransition } from 'react';
import { casarPar, decidirPar, procurarPares, type ResultadoAcao } from './actions';

/**
 * Botoes da conciliacao. Cada decisao e sua, uma por vez, com resultado
 * visivel — o desenho que o resto do app segue desde o "botao nao funciona".
 */

const botao = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'inherit',
} as const;

function useAcao() {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const rodar = (fn: () => Promise<ResultadoAcao>, aoOk?: (r: ResultadoAcao) => void) => {
    setErro(null);
    iniciar(async () => {
      const r = await fn();
      if (!r.ok) setErro(r.erro ?? 'Falha');
      else aoOk?.(r);
    });
  };
  return { pendente, erro, rodar };
}

export function BotaoProcurar() {
  const { pendente, erro, rodar } = useAcao();
  const [texto, setTexto] = useState<string | null>(null);
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        disabled={pendente}
        onClick={() => rodar(procurarPares, (r) => { setTexto(r.texto ?? null); setTimeout(() => window.location.reload(), 900); })}
        style={{ ...botao, border: '1px solid var(--meridiano)', background: 'var(--meridiano)', color: '#fffdf9', padding: '8px 14px', fontSize: 13, opacity: pendente ? 0.6 : 1 }}
      >
        {pendente ? 'Procurando…' : 'Procurar pares'}
      </button>
      {texto && <span className="sub" style={{ fontSize: 12 }}>{texto}</span>}
      {erro && <span style={{ fontSize: 12, color: 'var(--crit)' }}>{erro}</span>}
    </span>
  );
}

export function BotoesDecisao({ lancamentoId, status }: { lancamentoId: string; status: string }) {
  const { pendente, erro, rodar } = useAcao();
  const depois = () => window.location.reload();

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {status === 'SUGGESTED' && (
        <>
          <button type="button" disabled={pendente} onClick={() => rodar(() => decidirPar(lancamentoId, 'confirmar'), depois)} style={{ ...botao, border: '1px solid var(--ok)', color: 'var(--ok)' }}>
            confirmo
          </button>
          <button type="button" disabled={pendente} onClick={() => rodar(() => decidirPar(lancamentoId, 'rejeitar'), depois)} style={{ ...botao, color: 'var(--muted)' }}>
            não é
          </button>
        </>
      )}
      {(status === 'CONFIRMED' || status === 'REJECTED') && (
        <button type="button" disabled={pendente} onClick={() => rodar(() => decidirPar(lancamentoId, 'desfazer'), depois)} style={{ ...botao, color: 'var(--muted)' }}>
          desfazer
        </button>
      )}
      {erro && <span style={{ fontSize: 11, color: 'var(--crit)' }}>{erro}</span>}
    </span>
  );
}

export interface CobrancaOpcao {
  id: string;
  rotulo: string;
}

/** Para saida sem sugestao: voce escolhe a cobranca. */
export function CasarManual({ lancamentoId, cobrancas }: { lancamentoId: string; cobrancas: CobrancaOpcao[] }) {
  const { pendente, erro, rodar } = useAcao();
  const [escolhida, setEscolhida] = useState('');
  if (cobrancas.length === 0) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={escolhida} onChange={(e) => setEscolhida(e.target.value)} style={{ ...botao, cursor: 'default', maxWidth: 320 }}>
        <option value="">é o pagamento de…</option>
        {cobrancas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.rotulo}
          </option>
        ))}
      </select>
      {escolhida && (
        <button type="button" disabled={pendente} onClick={() => rodar(() => casarPar(lancamentoId, escolhida), () => window.location.reload())} style={{ ...botao, border: '1px solid var(--ok)', color: 'var(--ok)' }}>
          casar
        </button>
      )}
      {erro && <span style={{ fontSize: 11, color: 'var(--crit)' }}>{erro}</span>}
    </span>
  );
}
