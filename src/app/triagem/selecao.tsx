'use client';

import { createContext, useContext, useState, useTransition, type ReactNode } from 'react';
import { corrigirLote } from './actions';
import { CATEGORIA_LABEL, PRIORIDADE_LABEL } from './rotulos';

/**
 * Seleção múltipla e correção em lote.
 *
 * A correção item a item pressupõe que o modelo acerta a maioria — abrir
 * "discordo" seis vezes é razoável, sessenta não é. Quando ele erra em bloco
 * (perfil vazio, chave mal configurada, uma leva de promoções marcada como
 * "precisa resposta"), corrigir de uma em uma é trabalho manual que o app
 * deveria absorver.
 *
 * Cada item corrigido continua gerando seu próprio feedback: um lote vale
 * exatamente a soma das partes para calibrar o sistema.
 */

interface Selecao {
  marcados: Set<string>;
  alternar: (id: string) => void;
}

const ContextoSelecao = createContext<Selecao | null>(null);

export function useSelecao(): Selecao | null {
  return useContext(ContextoSelecao);
}

/*
 * Categorias e prioridades vem dos MESMOS mapas que a lista usa para
 * exibir. Eu havia escrito uma lista propria aqui, com valores inventados
 * ("PROMOTION", "FYI"), e toda correcao em lote voltava "Categoria
 * invalida" — o enum real e COBRANCA/NEEDS_REPLY/INFORMATIVE/PROMOTIONAL/
 * SPAM/DISPOSABLE. Derivar dos rotulos existentes impede a divergencia de
 * acontecer de novo.
 */
const CATEGORIAS = Object.entries(CATEGORIA_LABEL).map(([valor, rotulo]) => ({ valor, rotulo }));
const PRIORIDADES = Object.entries(PRIORIDADE_LABEL).map(([valor, rotulo]) => ({ valor, rotulo }));

const campo = {
  padding: '5px 8px',
  borderRadius: 3,
  border: '1px solid var(--border-forte)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 12,
} as const;

export function ProvedorSelecao({ children }: { children: ReactNode }) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [categoria, setCategoria] = useState<string>('PROMOTIONAL');
  const [prioridade, setPrioridade] = useState<string>('LOW');
  const [precisaResposta, setPrecisaResposta] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();

  function alternar(id: string) {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function aplicar() {
    const ids = [...marcados];
    if (ids.length === 0) return;
    setMensagem(null);
    iniciar(async () => {
      const resultado = await corrigirLote(ids, categoria, prioridade, precisaResposta);
      if (!resultado.ok) {
        setMensagem(resultado.erro ?? 'Falha ao corrigir');
        return;
      }
      if (resultado.erro) {
        setMensagem(`${resultado.corrigidos} corrigidas. ${resultado.erro}`);
        return;
      }
      // Recarrega para a lista refletir a nova classificação e a ordem.
      window.location.reload();
    });
  }

  return (
    <ContextoSelecao.Provider value={{ marcados, alternar }}>
      {marcados.size > 0 && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '10px 12px',
            marginBottom: 12,
            background: 'var(--surface)',
            border: '1px solid var(--meridiano)',
            borderRadius: 4,
          }}
        >
          <strong style={{ fontSize: 13 }}>
            {marcados.size} selecionada{marcados.size > 1 ? 's' : ''}
          </strong>

          <select
            aria-label="Categoria"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            style={campo}
          >
            {CATEGORIAS.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.rotulo}
              </option>
            ))}
          </select>

          <select
            aria-label="Prioridade"
            value={prioridade}
            onChange={(e) => setPrioridade(e.target.value)}
            style={campo}
          >
            {PRIORIDADES.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.rotulo}
              </option>
            ))}
          </select>

          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
            <input
              type="checkbox"
              checked={precisaResposta}
              onChange={(e) => setPrecisaResposta(e.target.checked)}
            />
            precisa resposta
          </label>

          <button
            type="button"
            onClick={aplicar}
            disabled={enviando}
            style={{
              padding: '6px 12px',
              borderRadius: 3,
              border: '1px solid var(--meridiano)',
              background: 'var(--meridiano)',
              color: '#fffdf9',
              fontSize: 12,
              cursor: enviando ? 'progress' : 'pointer',
              opacity: enviando ? 0.6 : 1,
            }}
          >
            {enviando ? 'Aplicando…' : `Aplicar a ${marcados.size}`}
          </button>

          <button
            type="button"
            onClick={() => setMarcados(new Set())}
            style={{ ...campo, border: 'none', background: 'none', cursor: 'pointer' }}
          >
            limpar
          </button>

          {mensagem && (
            <span style={{ fontSize: 12, color: 'var(--crit)', flexBasis: '100%' }}>{mensagem}</span>
          )}

          {/* A correção é do rótulo, não da caixa. Dizer isso evita a leitura
              de que "Spam" moveria a mensagem no provedor. */}
          <span className="sub" style={{ fontSize: 11, flexBasis: '100%' }}>
            Corrige a classificação aqui e ensina o sistema. Não move nem arquiva nada na sua caixa.
          </span>
        </div>
      )}
      {children}
    </ContextoSelecao.Provider>
  );
}

/** Caixa de seleção de uma linha. Fora do provedor, não renderiza nada. */
export function CaixaSelecao({ id }: { id: string }) {
  const selecao = useSelecao();
  if (!selecao) return null;
  return (
    <input
      type="checkbox"
      aria-label="Selecionar mensagem"
      checked={selecao.marcados.has(id)}
      onChange={() => selecao.alternar(id)}
      style={{ marginRight: 8, cursor: 'pointer' }}
    />
  );
}
