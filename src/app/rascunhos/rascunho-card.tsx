'use client';

import { useActionState, useState } from 'react';
import { aprovar, descartar, gerarRascunho, salvarEdicao, type AcaoResultado } from './actions';

/**
 * Card de um item que precisa de resposta (fase 5D).
 * Ver docs/07-agente-de-triagem.md
 *
 * A tela inteira e construida em torno de uma frase: **nada aqui envia**.
 * Aprovar significa "este texto esta bom, vou usar" — voce copia e manda do
 * seu cliente de e-mail.
 */

export interface RascunhoItem {
  unifiedItemId: string;
  title: string;
  fromName: string | null;
  fromEmail: string | null;
  occurredAt: string;
  contaCor: string;
  contaEmail: string;
  negocio: string | null;
  prioridade: string;
  perfilValidado: boolean;
  rascunho: {
    subject: string | null;
    bodyComposed: string;
    bodyEdited: string | null;
    status: string;
    reason: string | null;
    criadoEm: string;
  } | null;
}

const STATUS_LABEL: Record<string, string> = {
  PROPOSED: 'proposto',
  EDITED: 'editado por você',
  APPROVED: 'aprovado por você',
  DISCARDED: 'descartado',
};

const botao = {
  padding: '6px 12px',
  borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 12,
} as const;

const campo = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'inherit',
  lineHeight: 1.55,
} as const;

export function RascunhoCard({ item }: { item: RascunhoItem }) {
  const [editando, setEditando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const [geracao, acaoGerar, gerando] = useActionState<AcaoResultado | null, FormData>(
    gerarRascunho.bind(null, item.unifiedItemId),
    null,
  );
  const [edicao, acaoEditar, salvando] = useActionState<AcaoResultado | null, FormData>(
    salvarEdicao.bind(null, item.unifiedItemId),
    null,
  );

  const r = item.rascunho;
  const textoAtual = r ? (r.bodyEdited ?? r.bodyComposed) : '';

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoAtual);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // O texto esta visivel na tela de qualquer forma.
    }
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span className="ponto" style={{ background: item.contaCor }} />
        <strong style={{ fontSize: 14 }}>{item.title}</strong>
        {item.prioridade === 'URGENT' && <span className="pill warn">urgente</span>}
        {r && <span className="pill">{STATUS_LABEL[r.status] ?? r.status}</span>}
      </div>

      <div className="sub" style={{ fontSize: 12 }}>
        de {item.fromName ?? item.fromEmail} · {item.occurredAt} · {item.contaEmail}
        {item.negocio && ` · ${item.negocio}`}
      </div>

      {!item.perfilValidado && (
        <div className="aviso" style={{ margin: 0 }}>
          <p className="sub" style={{ margin: 0 }}>
            Esta caixa ainda não tem <strong>perfil de voz validado</strong>. Sem ele o rascunho
            não soaria como você — <a href="/voz">validar em /voz →</a>
          </p>
        </div>
      )}

      {r ? (
        <>
          {r.subject && (
            <div className="sub" style={{ fontSize: 12 }}>
              Assunto: <strong>{r.subject}</strong>
            </div>
          )}

          {editando ? (
            <form action={acaoEditar} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea name="bodyEdited" rows={10} defaultValue={textoAtual} style={campo} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="submit" style={botao} disabled={salvando}>
                  {salvando ? 'salvando…' : 'salvar minha versão'}
                </button>
                <button type="button" style={botao} onClick={() => setEditando(false)}>
                  cancelar
                </button>
                {edicao?.mensagem && (
                  <span className="sub" style={{ color: 'var(--ok)' }}>{edicao.mensagem}</span>
                )}
              </div>
            </form>
          ) : (
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: 'var(--bg)',
                borderRadius: 7,
                fontSize: 13,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
              }}
            >
              {textoAtual}
            </pre>
          )}

          {r.reason && (
            <p className="sub" style={{ fontSize: 12, margin: 0 }}>
              Por que respondeu assim: {r.reason}
            </p>
          )}

          {!editando && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" style={botao} onClick={copiar}>
                copiar texto
              </button>
              <button type="button" style={botao} onClick={() => setEditando(true)}>
                editar
              </button>
              {r.status !== 'APPROVED' && (
                <button type="button" style={botao} onClick={() => aprovar(item.unifiedItemId)}>
                  está bom, vou usar
                </button>
              )}
              {r.status !== 'DISCARDED' && (
                <button type="button" style={botao} onClick={() => descartar(item.unifiedItemId)}>
                  descartar
                </button>
              )}
              {copiado && (
                <span className="sub" style={{ color: 'var(--ok)', fontSize: 12 }}>copiado</span>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="vazio" style={{ margin: 0 }}>
          Nenhum rascunho ainda para este item.
        </p>
      )}

      <form action={acaoGerar} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          name="direction"
          placeholder="o que você quer nesta resposta? ex.: recuse educadamente, agenda cheia até novembro"
          style={{ ...campo, fontSize: 12 }}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="submit" style={botao} disabled={gerando}>
            {gerando ? 'escrevendo…' : r ? 'gerar de novo' : 'gerar rascunho'}
          </button>
          <span className="sub" style={{ fontSize: 11 }}>
            gerar lê o corpo deste e-mail — só dele
          </span>
          {geracao?.mensagem && (
            <span className="sub" style={{ color: 'var(--ok)' }}>{geracao.mensagem}</span>
          )}
          {geracao?.erro && (
            <span className="sub" style={{ color: 'var(--crit)' }}>{geracao.erro}</span>
          )}
        </div>
      </form>
    </section>
  );
}
