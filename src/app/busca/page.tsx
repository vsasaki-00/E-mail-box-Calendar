import { prisma } from '@/lib/db';
import { DEFAULT_TIMEZONE, formatDateTime, formatInZone } from '@/core/time/zone';
import { runSearch } from '@/core/search/run';
import { MIN_QUERY_LENGTH } from '@/core/search/query';
import { Nav } from '../nav';

/**
 * Busca unificada (fase 3). Ver docs/05-torre-de-controle.md
 *
 * Busca sobre metadados de TODAS as caixas de uma vez. O corpo fica de fora
 * de propósito: indexar o corpo de tudo significaria guardar o corpo de
 * tudo, e a decisão de privacidade do projeto é a oposta.
 */

export const dynamic = 'force-dynamic';

const CATEGORIA_LABEL: Record<string, string> = {
  COBRANCA: 'cobrança',
  NEEDS_REPLY: 'precisa resposta',
  INFORMATIVE: 'informativo',
  PROMOTIONAL: 'promocional',
  SPAM: 'spam',
  DISPOSABLE: 'descartável',
};

const campo = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 14,
  fontFamily: 'inherit',
} as const;

export default async function PaginaBusca({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; conta?: string; tipo?: string; filtro?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? '').trim();

  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  const tz = usuario?.timezone || DEFAULT_TIMEZONE;
  const conexoes = usuario
    ? await prisma.connection.findMany({
        where: { userId: usuario.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, accountEmail: true, displayName: true, color: true },
      })
    : [];

  const resultados =
    usuario && q
      ? await runSearch(usuario.id, {
          q,
          connectionId: params.conta || null,
          kind: params.tipo === 'MESSAGE' || params.tipo === 'EVENT' ? params.tipo : null,
          needsReply: params.filtro === 'resposta',
          cobranca: params.filtro === 'cobranca',
        })
      : [];

  const curtoDemais = q.length > 0 && q.length < MIN_QUERY_LENGTH;

  return (
    <main className="shell">
      <Nav atual="/busca" />
      <header className="topo">
        <div>
          <h1>Busca</h1>
          <p className="sub">Todas as caixas e todos os calendários de uma vez.</p>
        </div>
      </header>

      <form method="get" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          name="q"
          defaultValue={q}
          placeholder="assunto, remetente, título de evento…"
          style={{ ...campo, flex: 1, minWidth: 240 }}
          autoFocus
        />
        <select name="conta" defaultValue={params.conta ?? ''} style={campo} aria-label="Conta">
          <option value="">todas as contas</option>
          {conexoes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName ?? c.accountEmail}
            </option>
          ))}
        </select>
        <select name="tipo" defaultValue={params.tipo ?? ''} style={campo} aria-label="Tipo">
          <option value="">tudo</option>
          <option value="MESSAGE">e-mails</option>
          <option value="EVENT">eventos</option>
        </select>
        <select name="filtro" defaultValue={params.filtro ?? ''} style={campo} aria-label="Filtro">
          <option value="">sem filtro</option>
          <option value="resposta">precisam resposta</option>
          <option value="cobranca">cobranças</option>
        </select>
        <button
          type="submit"
          style={{ ...campo, cursor: 'pointer', background: 'var(--surface)' }}
        >
          buscar
        </button>
      </form>

      <p className="sub" style={{ fontSize: 12, marginBottom: 14 }}>
        A busca cobre <strong>assunto, remetente, prévia e título</strong> — não o corpo das
        mensagens. Indexar o corpo de tudo exigiria guardar o corpo de tudo, e a decisão deste
        projeto é a oposta: corpo só sob demanda.
      </p>

      {curtoDemais && (
        <p className="vazio">Digite pelo menos {MIN_QUERY_LENGTH} caracteres.</p>
      )}

      {!q && !curtoDemais && <p className="vazio">Digite algo para buscar.</p>}

      {q && !curtoDemais && resultados.length === 0 && (
        <p className="vazio">Nada encontrado para “{q}”.</p>
      )}

      {resultados.length > 0 && (
        <>
          <p className="sub" style={{ fontSize: 12, marginBottom: 10 }}>
            {resultados.length} resultado{resultados.length === 1 ? '' : 's'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resultados.map((hit) => (
              <section
                key={hit.unifiedItemId}
                className="card"
                style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 12 }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className="ponto" style={{ background: hit.connectionColor }} />
                  <strong style={{ fontSize: 14 }}>{hit.title}</strong>
                  {hit.kind === 'EVENT' && <span className="pill">evento</span>}
                  {hit.category && (
                    <span className="pill" style={{ fontSize: 11 }}>
                      {CATEGORIA_LABEL[hit.category] ?? hit.category}
                    </span>
                  )}
                  {hit.needsReply && <span className="pill warn">precisa resposta</span>}
                  {/* A dedup nunca esconde: mostra em quantas caixas existe. */}
                  {hit.copyCount > 1 && (
                    <span className="pill">em {hit.copyCount} caixas</span>
                  )}
                </div>
                <div className="sub" style={{ fontSize: 12 }}>
                  {hit.fromLabel && `${hit.fromLabel} · `}
                  {hit.connectionLabel} ·{' '}
                  {formatInZone(hit.occurredAt, tz, {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
                {hit.preview && (
                  <p className="sub" style={{ fontSize: 12, margin: 0 }}>
                    {hit.preview.slice(0, 180)}
                  </p>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
