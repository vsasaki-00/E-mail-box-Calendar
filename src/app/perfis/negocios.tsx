'use client';

import { useState, useTransition } from 'react';
import {
  acaoApagarNegocio,
  acaoArquivarNegocio,
  acaoCriarNegocio,
  acaoRenomearNegocio,
} from './negocios-actions';

/**
 * Cadastro de negócios. Ver docs/07-agente-de-triagem.md
 *
 * Renomear aqui **migra as linhas** que citam o nome antigo. É a razão de
 * esta tela existir em vez de um campo de texto solto: sem a migração, o
 * filtro por negócio devolveria menos do que existe, e você só descobriria
 * ao estranhar um total.
 */

export interface NegocioNaTela {
  id: string;
  name: string;
  system: boolean;
  archived: boolean;
  usos: number;
}

const campo: React.CSSProperties = {
  font: 'inherit',
  padding: '5px 8px',
  border: '1px solid var(--border-forte)',
  borderRadius: 'var(--radius)',
  background: 'var(--surface)',
  minWidth: 0,
};

function Linha({ negocio }: { negocio: NegocioNaTela }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(negocio.name);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const rodar = (fn: () => Promise<{ ok: boolean; erro?: string }>) =>
    iniciar(async () => {
      const r = await fn();
      setErro(r.ok ? null : (r.erro ?? 'Não deu'));
      if (r.ok) setEditando(false);
    });

  return (
    <div className="linha alto">
      <span className="titulo-item solto">
        {editando ? (
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            style={{ ...campo, width: '100%', maxWidth: 260 }}
            autoFocus
          />
        ) : (
          <>
            {negocio.name}
            {negocio.archived && <span className="pill" style={{ marginLeft: 6 }}>arquivado</span>}
            {negocio.system && (
              <span className="pill" style={{ marginLeft: 6 }} title="Regra de escape, não um negócio">
                fixo
              </span>
            )}
          </>
        )}
        <br />
        <span className="sub">
          {negocio.usos === 0
            ? 'nenhum registro usa ainda'
            : `${negocio.usos} registro${negocio.usos === 1 ? '' : 's'}`}
          {/* Renomear migra as linhas: dizer o número aqui é o que torna
              essa promessa verificável em vez de confiável. */}
          {editando && negocio.usos > 0 && ` — serão atualizados com o nome novo`}
          {erro && <span style={{ color: 'var(--crit)' }}> · {erro}</span>}
        </span>
      </span>

      <span style={{ display: 'flex', gap: 4, flex: 'none' }}>
        {editando ? (
          <>
            <button
              type="button"
              className="sair"
              disabled={pendente}
              onClick={() => rodar(() => acaoRenomearNegocio(negocio.id, nome))}
            >
              {pendente ? '…' : 'salvar'}
            </button>
            <button
              type="button"
              className="sair"
              onClick={() => {
                setNome(negocio.name);
                setErro(null);
                setEditando(false);
              }}
            >
              cancelar
            </button>
          </>
        ) : (
          <>
            {!negocio.system && (
              <button type="button" className="sair" onClick={() => setEditando(true)}>
                renomear
              </button>
            )}
            {!negocio.system && (
              <button
                type="button"
                className="sair"
                disabled={pendente}
                onClick={() => rodar(() => acaoArquivarNegocio(negocio.id, !negocio.archived))}
              >
                {negocio.archived ? 'reativar' : 'arquivar'}
              </button>
            )}
            {!negocio.system && negocio.usos === 0 && (
              <button
                type="button"
                className="sair"
                disabled={pendente}
                onClick={() => rodar(() => acaoApagarNegocio(negocio.id))}
              >
                apagar
              </button>
            )}
          </>
        )}
      </span>
    </div>
  );
}

export function Negocios({ negocios }: { negocios: NegocioNaTela[] }) {
  const [novo, setNovo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  return (
    <section className="card" style={{ marginBottom: 20 }}>
      <h2>Negócios</h2>
      <p className="sub" style={{ marginTop: -4, marginBottom: 10 }}>
        O nome entra no prompt de triagem e em toda a tela do financeiro. Renomear aqui{' '}
        <strong>atualiza os registros que já usam o nome antigo</strong>.
      </p>

      {negocios.map((n) => (
        <Linha key={n.id} negocio={n} />
      ))}

      <div className="linha" style={{ borderBottom: 'none', gap: 6 }}>
        <input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          placeholder="novo negócio"
          style={{ ...campo, flex: 1 }}
        />
        <button
          type="button"
          className="botao"
          disabled={pendente || !novo.trim()}
          onClick={() =>
            iniciar(async () => {
              const r = await acaoCriarNegocio(novo);
              setErro(r.ok ? null : (r.erro ?? 'Não deu'));
              if (r.ok) setNovo('');
            })
          }
        >
          {pendente ? '…' : 'criar'}
        </button>
      </div>
      {erro && (
        <p className="sub" style={{ color: 'var(--crit)', margin: 0 }}>
          {erro}
        </p>
      )}
    </section>
  );
}
