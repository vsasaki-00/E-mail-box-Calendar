'use client';

import { useActionState, useState } from 'react';
import { cancelar, confirmarEExecutar, desfazer, type AcaoResultado } from './actions';

/**
 * Uma ação na fila ou no log. Ver docs/08-escrita-e-acoes.md
 *
 * A fila e o log são a mesma lista de propósito: um log separado da fila
 * diverge dela, e aí você tem dois registros discordando sobre o que o app
 * fez na sua caixa.
 */

export interface AcaoItem {
  id: string;
  kind: string;
  status: string;
  actor: string;
  description: string;
  reversible: boolean;
  contaEmail: string;
  contaCor: string;
  error: string | null;
  quando: string;
  executadoEm: string | null;
}

const STATUS_LABEL: Record<string, { texto: string; classe: string }> = {
  PENDING: { texto: 'esperando você', classe: 'warn' },
  CONFIRMED: { texto: 'confirmada', classe: '' },
  DONE: { texto: 'feita', classe: 'ok' },
  FAILED: { texto: 'falhou', classe: 'crit' },
  UNDONE: { texto: 'desfeita por você', classe: '' },
  CANCELLED: { texto: 'cancelada', classe: '' },
};

const botao = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 12,
  whiteSpace: 'nowrap' as const,
};

export function AcaoLinha({ item }: { item: AcaoItem }) {
  const [confirmandoSemVolta, setConfirmandoSemVolta] = useState(false);
  const [exec, acaoExec, executando] = useActionState<AcaoResultado | null>(
    confirmarEExecutar.bind(null, item.id),
    null,
  );
  const [undo, acaoUndo, desfazendo] = useActionState<AcaoResultado | null>(
    desfazer.bind(null, item.id),
    null,
  );

  const status = STATUS_LABEL[item.status] ?? { texto: item.status, classe: '' };
  const pendente = item.status === 'PENDING' || item.status === 'CONFIRMED';

  return (
    <section
      className="card"
      style={{
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        borderLeft: !item.reversible ? '3px solid var(--crit)' : undefined,
        opacity: item.status === 'CANCELLED' || item.status === 'UNDONE' ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="ponto" style={{ background: item.contaCor }} />
        <strong style={{ fontSize: 13 }}>{item.description}</strong>
        <span className={`pill ${status.classe}`}>{status.texto}</span>
        {!item.reversible && <span className="pill crit">sem volta</span>}
        {item.actor === 'AGENT' && <span className="pill">proposta pelo agente</span>}
      </div>

      <div className="sub" style={{ fontSize: 12 }}>
        {item.contaEmail} · pedida em {item.quando}
        {item.executadoEm && ` · executada em ${item.executadoEm}`}
      </div>

      {item.error && (
        <div className="sub" style={{ fontSize: 12, color: 'var(--crit)' }}>
          {item.error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {pendente && item.reversible && (
          <form action={acaoExec}>
            <button type="submit" style={botao} disabled={executando}>
              {executando ? 'executando…' : 'confirmar'}
            </button>
          </form>
        )}

        {pendente && !item.reversible && !confirmandoSemVolta && (
          <button type="button" style={botao} onClick={() => setConfirmandoSemVolta(true)}>
            confirmar…
          </button>
        )}

        {pendente && !item.reversible && confirmandoSemVolta && (
          <>
            {/* Confirmacao em duas etapas para o que nao volta. Um clique
                unico no meio de uma lista e clique por engano. */}
            <span className="sub" style={{ fontSize: 12, color: 'var(--crit)' }}>
              Isto não pode ser desfeito. Tem certeza?
            </span>
            <form action={acaoExec}>
              <button type="submit" style={{ ...botao, borderColor: 'var(--crit)' }} disabled={executando}>
                {executando ? 'executando…' : 'sim, executar'}
              </button>
            </form>
            <button type="button" style={botao} onClick={() => setConfirmandoSemVolta(false)}>
              não
            </button>
          </>
        )}

        {pendente && (
          <button type="button" style={botao} onClick={() => cancelar(item.id)}>
            descartar
          </button>
        )}

        {item.status === 'DONE' && item.reversible && (
          <form action={acaoUndo}>
            <button type="submit" style={botao} disabled={desfazendo}>
              {desfazendo ? 'desfazendo…' : 'desfazer'}
            </button>
          </form>
        )}

        {item.status === 'DONE' && !item.reversible && (
          <span className="sub" style={{ fontSize: 12 }}>
            sem desfazer — o registro fica aqui
          </span>
        )}

        {exec?.erro && <span className="sub" style={{ color: 'var(--crit)' }}>{exec.erro}</span>}
        {undo?.erro && <span className="sub" style={{ color: 'var(--crit)' }}>{undo.erro}</span>}
        {undo?.mensagem && <span className="sub" style={{ color: 'var(--ok)' }}>{undo.mensagem}</span>}
      </div>
    </section>
  );
}
