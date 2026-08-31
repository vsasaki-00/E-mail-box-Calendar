'use client';

import { useActionState } from 'react';
import { aprovarPerfil, derivarPerfil, type AcaoResultado } from './actions';

/**
 * Card do perfil de voz de uma caixa. Ver docs/07-agente-de-triagem.md
 *
 * O perfil e uma PROPOSTA ate voce confirmar que e assim que escreve.
 * Separar a validacao da geracao e deliberado: julgar "e assim que eu
 * escrevo?" e muito mais facil do que julgar um texto ja gerado.
 */

export interface VozInicial {
  connectionId: string;
  accountEmail: string;
  color: string;
  businessName: string | null;
  perfil: {
    greetings: { text: string; count: number }[];
    closings: { text: string; count: number }[];
    signature: string | null;
    avgWordCount: number;
    medianWordCount: number;
    formality: string | null;
    language: string | null;
    traits: string[];
    sampleCount: number;
    derivedAt: string;
    userApproved: boolean;
    userNotes: string | null;
  } | null;
}

const FORMALIDADE_LABEL: Record<string, string> = {
  formal: 'Formal',
  neutro: 'Neutro',
  informal: 'Informal',
};

const botao = {
  padding: '7px 14px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 13,
} as const;

function Lista({ titulo, itens }: { titulo: string; itens: { text: string; count: number }[] }) {
  if (itens.length === 0) return null;
  return (
    <div>
      <div className="sub" style={{ fontSize: 12 }}>
        {titulo}
      </div>
      <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {itens.map((item) => (
          <span
            key={item.text}
            className="pill"
            style={{ color: 'var(--text)', fontWeight: 400, fontSize: 12 }}
          >
            {item.text} <span style={{ color: 'var(--muted)' }}>{item.count}×</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function VozCard({ inicial }: { inicial: VozInicial }) {
  const [derivar, acaoDerivar, derivando] = useActionState<AcaoResultado | null>(
    derivarPerfil.bind(null, inicial.connectionId),
    null,
  );
  const [aprovar, acaoAprovar, aprovando] = useActionState<AcaoResultado | null, FormData>(
    aprovarPerfil.bind(null, inicial.connectionId),
    null,
  );

  const p = inicial.perfil;

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="ponto" style={{ background: inicial.color }} />
        <strong style={{ fontSize: 14 }}>{inicial.accountEmail}</strong>
        {inicial.businessName && <span className="sub">· {inicial.businessName}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {p?.userApproved && <span className="pill ok">validado por você</span>}
          {p && !p.userApproved && <span className="pill warn">aguardando sua validação</span>}
          {!p && <span className="pill warn">sem perfil</span>}
        </span>
      </div>

      {p ? (
        <>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            <Lista titulo="Como você começa" itens={p.greetings} />
            <Lista titulo="Como você termina" itens={p.closings} />
          </div>

          {p.signature && (
            <div>
              <div className="sub" style={{ fontSize: 12 }}>
                Assinatura detectada
              </div>
              <pre
                style={{
                  marginTop: 4,
                  padding: 10,
                  background: 'var(--bg)',
                  borderRadius: 6,
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                }}
              >
                {p.signature}
              </pre>
            </div>
          )}

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
            <span>
              <span className="sub" style={{ fontSize: 12 }}>
                tamanho típico
              </span>
              <br />
              {p.medianWordCount} palavras{' '}
              <span className="sub" style={{ fontSize: 11 }}>
                (média {p.avgWordCount})
              </span>
            </span>
            {p.formality && (
              <span>
                <span className="sub" style={{ fontSize: 12 }}>
                  registro
                </span>
                <br />
                {FORMALIDADE_LABEL[p.formality] ?? p.formality}
              </span>
            )}
            {p.language && (
              <span>
                <span className="sub" style={{ fontSize: 12 }}>
                  idioma
                </span>
                <br />
                {p.language}
              </span>
            )}
            <span>
              <span className="sub" style={{ fontSize: 12 }}>
                baseado em
              </span>
              <br />
              {p.sampleCount} mensagens suas
            </span>
          </div>

          {p.traits.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {p.traits.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}

          {!p.userApproved && (
            <form action={acaoAprovar} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="sub" style={{ fontSize: 12 }} htmlFor={`notas-${inicial.connectionId}`}>
                É assim que você escreve nesta caixa? Corrija o que estiver errado:
              </label>
              <textarea
                id={`notas-${inicial.connectionId}`}
                name="userNotes"
                rows={2}
                defaultValue={p.userNotes ?? ''}
                placeholder="ex.: nunca uso 'Prezados' aqui; com cliente eu sou mais direto"
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button type="submit" style={botao} disabled={aprovando}>
                  {aprovando ? 'salvando…' : 'Sim, é assim que eu escrevo'}
                </button>
                {aprovar?.mensagem && (
                  <span className="sub" style={{ color: 'var(--ok)' }}>
                    {aprovar.mensagem}
                  </span>
                )}
                {aprovar?.erro && (
                  <span className="sub" style={{ color: 'var(--crit)' }}>
                    {aprovar.erro}
                  </span>
                )}
              </div>
            </form>
          )}

          {p.userApproved && p.userNotes && (
            <p className="sub" style={{ fontSize: 12 }}>
              Sua observação: “{p.userNotes}”
            </p>
          )}
        </>
      ) : (
        <p className="vazio">
          Nenhum perfil ainda. Derivar lê suas mensagens da pasta Enviados desta caixa e monta o
          perfil <strong>localmente</strong> — nada é enviado para nenhuma API.
        </p>
      )}

      <form action={acaoDerivar} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="submit" style={botao} disabled={derivando}>
          {derivando ? 'analisando suas mensagens…' : p ? 'Derivar de novo' : 'Derivar perfil'}
        </button>
        {p && (
          <span className="sub" style={{ fontSize: 12 }}>
            derivado em {p.derivedAt}
            {/* Rederivar reseta a validação: você aprovou outro perfil. */}
            {p.userApproved && ' · derivar de novo pedirá nova validação'}
          </span>
        )}
        {derivar?.mensagem && (
          <span className="sub" style={{ color: 'var(--ok)' }}>
            {derivar.mensagem}
          </span>
        )}
        {derivar?.erro && (
          <span className="sub" style={{ color: 'var(--crit)' }}>
            {derivar.erro}
          </span>
        )}
      </form>
    </section>
  );
}
