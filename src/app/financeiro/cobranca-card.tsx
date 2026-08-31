'use client';

import { useActionState, useState } from 'react';
import { formatarValor } from '@/core/finance/format';
import { corrigirCobranca, marcarStatus, type AcaoResultado } from './actions';

/**
 * Card de uma cobranca. Ver docs/07-agente-de-triagem.md (fase 5B)
 *
 * Duas coisas que este card NAO pode esconder: de onde veio o numero
 * (boleto lido x palpite do modelo) e os avisos. Um painel de contas a
 * pagar que parece mais certo do que e faz voce deixar de pagar uma conta.
 */

export interface CobrancaItem {
  unifiedItemId: string;
  payee: string | null;
  subject: string | null;
  fromEmail: string | null;
  amountCents: number | null;
  dueDate: string | null;
  dueDateISO: string | null;
  diasAteVencer: number | null;
  kind: string;
  source: string;
  confidence: number;
  reason: string | null;
  warnings: string[];
  digitableLine: string | null;
  pixPayload: string | null;
  status: string;
  isPayable: boolean;
  userNotes: string | null;
  contaCor: string;
  contaEmail: string;
}

const KIND_LABEL: Record<string, string> = {
  BOLETO: 'boleto',
  PIX: 'PIX',
  FATURA: 'fatura',
  ASSINATURA: 'assinatura',
  NOTA_FISCAL: 'nota fiscal',
  OUTRO: 'cobrança',
};

/** A distincao mais importante da tela. */
const SOURCE_LABEL: Record<string, string> = {
  INSTRUMENT: 'lido do boleto/PIX',
  TEXT: 'lido do corpo do e-mail',
  MODEL: 'estimado pelo modelo',
  USER: 'corrigido por você',
};

const botao = {
  padding: '5px 11px',
  borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 12,
} as const;

const campo = {
  padding: '6px 9px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'inherit',
} as const;

function Prazo({ dias, data }: { dias: number | null; data: string | null }) {
  if (data === null) {
    return <span className="pill warn">sem vencimento identificado</span>;
  }
  if (dias === null) return <span>{data}</span>;
  if (dias < 0) {
    return (
      <span style={{ color: 'var(--crit)' }}>
        <strong>{data}</strong> · vencida há {Math.abs(dias)}d
      </span>
    );
  }
  if (dias === 0) return <span style={{ color: 'var(--crit)' }}><strong>{data}</strong> · vence hoje</span>;
  return (
    <span style={{ color: dias <= 3 ? 'var(--warn, var(--crit))' : undefined }}>
      <strong>{data}</strong> · em {dias}d
    </span>
  );
}

export function CobrancaCard({ item }: { item: CobrancaItem }) {
  const [corrigindo, setCorrigindo] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [correcao, acaoCorrigir, salvando] = useActionState<AcaoResultado | null, FormData>(
    corrigirCobranca.bind(null, item.unifiedItemId),
    null,
  );

  const pagavel = item.status === 'PENDING' && item.isPayable;

  async function copiar(texto: string, rotulo: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(rotulo);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      // Clipboard bloqueado (http, permissao): o valor fica visivel na
      // tela de qualquer forma, entao da para copiar na mao.
      setCopiado('bloqueado');
    }
  }

  return (
    <section
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        opacity: item.status === 'PENDING' ? 1 : 0.55,
        borderLeft: item.warnings.length > 0 ? '3px solid var(--crit)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span className="ponto" style={{ background: item.contaCor }} />
        <strong style={{ fontSize: 15 }}>{item.payee ?? 'Beneficiário não identificado'}</strong>
        <span className="pill" style={{ fontSize: 11 }}>{KIND_LABEL[item.kind] ?? item.kind}</span>
        {item.status === 'PAID' && <span className="pill ok">paga</span>}
        {item.status === 'IGNORED' && <span className="pill">ignorada</span>}
        {!item.isPayable && item.status === 'PENDING' && (
          <span className="pill warn">não parece conta a pagar</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={{ fontSize: 22, fontWeight: 600 }}>{formatarValor(item.amountCents)}</span>
        <Prazo dias={item.diasAteVencer} data={item.dueDate} />
      </div>

      <div className="sub" style={{ fontSize: 12 }}>
        {/* Sem valor nem vencimento, nada foi extraido — dizer "estimado
            pelo modelo" ali seria atribuir a alguem um palpite que nunca
            houve. */}
        {item.amountCents === null && item.dueDate === null
          ? 'nada identificado automaticamente'
          : `${SOURCE_LABEL[item.source] ?? item.source} · confiança ${Math.round(item.confidence * 100)}%`}
        {' · '}
        {item.contaEmail}
      </div>

      {item.subject && (
        <div className="sub" style={{ fontSize: 12 }}>
          “{item.subject}” — {item.fromEmail}
        </div>
      )}

      {item.warnings.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--crit)' }}>
          {item.warnings.map((aviso) => (
            <li key={aviso}>{aviso}</li>
          ))}
        </ul>
      )}

      {(item.digitableLine || item.pixPayload) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {item.digitableLine && (
            <button type="button" style={botao} onClick={() => copiar(item.digitableLine!, 'linha')}>
              copiar linha digitável
            </button>
          )}
          {item.pixPayload && (
            <button type="button" style={botao} onClick={() => copiar(item.pixPayload!, 'pix')}>
              copiar PIX copia e cola
            </button>
          )}
          {copiado === 'bloqueado' ? (
            <span className="sub" style={{ fontSize: 12, color: 'var(--crit)' }}>
              o navegador bloqueou a cópia
            </span>
          ) : (
            copiado && <span className="sub" style={{ fontSize: 12, color: 'var(--ok)' }}>copiado</span>
          )}
        </div>
      )}

      {item.digitableLine && (
        <code style={{ fontSize: 11, color: 'var(--muted)', wordBreak: 'break-all' }}>
          {item.digitableLine}
        </code>
      )}

      {item.userNotes && (
        <p className="sub" style={{ fontSize: 12 }}>Sua observação: “{item.userNotes}”</p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {pagavel && (
          <>
            <button
              type="button"
              style={botao}
              onClick={() => marcarStatus(item.unifiedItemId, 'PAID')}
            >
              marcar como paga
            </button>
            <button
              type="button"
              style={botao}
              onClick={() => marcarStatus(item.unifiedItemId, 'IGNORED')}
            >
              não é cobrança
            </button>
          </>
        )}
        {item.status !== 'PENDING' && (
          <button
            type="button"
            style={botao}
            onClick={() => marcarStatus(item.unifiedItemId, 'PENDING')}
          >
            reabrir
          </button>
        )}
        <button type="button" style={botao} onClick={() => setCorrigindo((v) => !v)}>
          {corrigindo ? 'cancelar' : 'corrigir'}
        </button>
      </div>

      {corrigindo && (
        <form action={acaoCorrigir} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="sub" style={{ fontSize: 12, margin: 0 }}>
            Deixe em branco o que estiver certo. Corrigir marca esta cobrança como sua e a
            protege de ser sobrescrita numa próxima extração.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              name="valor"
              placeholder={item.amountCents !== null ? formatarValor(item.amountCents) : 'R$ 0,00'}
              style={{ ...campo, width: 130 }}
              aria-label="Valor"
            />
            <input
              name="vencimento"
              type="date"
              defaultValue={item.dueDateISO ?? ''}
              style={campo}
              aria-label="Vencimento"
            />
            <input
              name="payee"
              placeholder={item.payee ?? 'Quem cobra'}
              style={{ ...campo, flex: 1, minWidth: 160 }}
              aria-label="Beneficiário"
            />
          </div>
          <input name="userNotes" placeholder="observação (opcional)" style={campo} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="submit" style={botao} disabled={salvando}>
              {salvando ? 'salvando…' : 'salvar correção'}
            </button>
            {correcao?.erro && (
              <span className="sub" style={{ color: 'var(--crit)' }}>{correcao.erro}</span>
            )}
            {correcao?.mensagem && (
              <span className="sub" style={{ color: 'var(--ok)' }}>{correcao.mensagem}</span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
