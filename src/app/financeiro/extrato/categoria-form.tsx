'use client';

import { useState, useTransition } from 'react';
import { apagarRegra, categorizarLancamento, categorizarTudo, type ResultadoCategoria } from './actions';

/**
 * Categoria e negocio de um lancamento, inline. "Sempre" vira regra.
 *
 * A chave da regra aparece no resultado ("porto seguro saude"), porque e
 * voce quem julga se ela faz sentido — e apaga se nao fizer.
 */

const campo = {
  padding: '3px 6px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 11,
  fontFamily: 'inherit',
} as const;

export function CategoriaInline({
  lancamentoId,
  category,
  categorySource,
  business,
  categorias,
  negocios,
}: {
  lancamentoId: string;
  category: string | null;
  categorySource: string | null;
  business: string | null;
  categorias: readonly string[];
  negocios: readonly string[];
}) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        title={categorySource === 'USER' ? 'Definida por você' : categorySource === 'RULE' ? 'Por regra sua' : categorySource === 'HEURISTIC' ? 'Palpite — confirme ou corrija' : 'Sem categoria'}
        style={{
          ...campo,
          cursor: 'pointer',
          background: 'transparent',
          color: category ? 'var(--text)' : 'var(--muted)',
          borderStyle: categorySource === 'HEURISTIC' ? 'dashed' : 'solid',
          fontStyle: category ? 'normal' : 'italic',
        }}
      >
        {category ?? 'categoria?'}
        {business ? ` · ${business}` : ''}
      </button>
    );
  }

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const f = new FormData(evento.currentTarget);
    setErro(null);
    iniciar(async () => {
      const r: ResultadoCategoria = await categorizarLancamento(lancamentoId, {
        category: String(f.get('category') ?? ''),
        business: String(f.get('business') ?? ''),
        sempre: f.get('sempre') === 'on',
      });
      if (!r.ok) {
        setErro(r.erro ?? 'Falha');
        return;
      }
      setMsg(r.texto ?? 'Salvo.');
      setTimeout(() => window.location.reload(), 900);
    });
  }

  return (
    <form onSubmit={enviar} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <select name="category" defaultValue={category ?? ''} style={campo}>
        <option value="">(sem categoria)</option>
        {categorias.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select name="business" defaultValue={business ?? ''} style={campo}>
        <option value="">(negócio da conta)</option>
        {negocios.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <label style={{ fontSize: 11, display: 'inline-flex', gap: 3, alignItems: 'center' }} title="Cria uma regra para lançamentos parecidos">
        <input type="checkbox" name="sempre" /> sempre
      </label>
      <button type="submit" disabled={pendente} style={{ ...campo, cursor: 'pointer', background: 'var(--surface)' }}>
        {pendente ? '…' : 'ok'}
      </button>
      <button type="button" onClick={() => setAberto(false)} style={{ ...campo, cursor: 'pointer', background: 'transparent', color: 'var(--muted)' }}>
        ×
      </button>
      {msg && <span className="sub" style={{ fontSize: 11 }}>{msg}</span>}
      {erro && <span style={{ fontSize: 11, color: 'var(--crit)' }}>{erro}</span>}
    </form>
  );
}

export function BotaoCategorizar() {
  const [pendente, iniciar] = useTransition();
  const [texto, setTexto] = useState<string | null>(null);
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        type="button"
        disabled={pendente}
        onClick={() =>
          iniciar(async () => {
            const r = await categorizarTudo();
            setTexto(r.ok ? (r.texto ?? 'Feito.') : (r.erro ?? 'Falha'));
            if (r.ok) setTimeout(() => window.location.reload(), 1200);
          })
        }
        style={{ ...campo, fontSize: 12, padding: '4px 10px', cursor: 'pointer', background: 'transparent' }}
        title="Aplica suas regras e os palpites embutidos ao que ainda não tem categoria"
      >
        {pendente ? 'Categorizando…' : 'Categorizar'}
      </button>
      {texto && <span className="sub" style={{ fontSize: 11 }}>{texto}</span>}
    </span>
  );
}

export function BotaoApagarRegra({ regraId }: { regraId: string }) {
  const [pendente, iniciar] = useTransition();
  return (
    <button
      type="button"
      disabled={pendente}
      onClick={() => iniciar(async () => { await apagarRegra(regraId); window.location.reload(); })}
      style={{ ...campo, cursor: 'pointer', background: 'transparent', color: 'var(--muted)' }}
    >
      apagar
    </button>
  );
}
