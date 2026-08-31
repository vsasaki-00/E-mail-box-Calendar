import type { TriageCategory } from '@prisma/client';
import { prisma } from '@/lib/db';
import { DEFAULT_TIMEZONE, formatDateTime, formatInZone } from '@/core/time/zone';
import { ItemTriagemLinha, type ItemTriagem } from './item-form';
import { Nav } from '../nav';
import { BotaoTriar } from './botao-triar';
import { ProvedorSelecao } from './selecao';

/**
 * Lista de triagem, com correcao. Ver docs/07-agente-de-triagem.md
 *
 * Ordenada pelo que exige atencao, nao por data: urgente primeiro, depois
 * baixa confianca (o item que precisa de olho humano), depois o resto.
 * Ordenar por data faria a lista parecer uma caixa de entrada comum — que e
 * exatamente o que este produto existe para nao ser.
 */

export const dynamic = 'force-dynamic';

// Classificar chama o modelo caixa a caixa; o padrao do runtime nao cobre.
export const maxDuration = 60;

const ORDEM_PRIORIDADE: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const LIMITE_BAIXA_CONFIANCA = 0.6;

const FILTROS = [
  { chave: 'acao', rotulo: 'Precisam de ação' },
  { chave: 'revisar', rotulo: 'Revisar (baixa confiança)' },
  { chave: 'cobranca', rotulo: 'Cobranças' },
  { chave: 'tudo', rotulo: 'Tudo' },
] as const;

type Filtro = (typeof FILTROS)[number]['chave'];

function whereDoFiltro(userId: string, filtro: Filtro) {
  const base = { userId };
  switch (filtro) {
    case 'acao':
      return { ...base, OR: [{ needsReply: true }, { priority: 'URGENT' as const }] };
    case 'revisar':
      return { ...base, confidence: { lt: LIMITE_BAIXA_CONFIANCA } };
    case 'cobranca':
      return { ...base, category: 'COBRANCA' as TriageCategory };
    default:
      return base;
  }
}

export default async function PaginaTriagem({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  const params = await searchParams;
  const filtro: Filtro = FILTROS.some((f) => f.chave === params.filtro)
    ? (params.filtro as Filtro)
    : 'acao';

  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  const tz = usuario?.timezone || DEFAULT_TIMEZONE;
  if (!usuario) {
    return (
      <main className="shell">
      <Nav atual="/triagem" />
        <h1>Triagem</h1>
        <div className="aviso">
          <p>
            <strong>Nenhuma conta conectada.</strong>{' '}
            <a href="/conexoes">Conectar uma caixa →</a>
          </p>
        </div>
      </main>
    );
  }

  const [triagens, totalTriado, pendentes, correcoes] = await Promise.all([
    prisma.itemTriage.findMany({
      where: whereDoFiltro(usuario.id, filtro),
      include: { unifiedItem: { select: { title: true, preview: true, occurredAt: true, copyCount: true } } },
      take: 150,
    }),
    prisma.itemTriage.count({ where: { userId: usuario.id } }),
    prisma.unifiedItem.count({ where: { userId: usuario.id, kind: 'MESSAGE', triage: null } }),
    prisma.triageFeedback.count({ where: { userId: usuario.id } }),
  ]);

  // Ordenacao em memoria: Prisma nao ordena enum pela ordem semantica, e a
  // lista e limitada a 150 itens.
  const itens: ItemTriagem[] = triagens
    .sort((a, b) => {
      const porPrioridade =
        (ORDEM_PRIORIDADE[a.priority] ?? 9) - (ORDEM_PRIORIDADE[b.priority] ?? 9);
      if (porPrioridade !== 0) return porPrioridade;
      // Entre itens de mesma prioridade, o de menor confianca primeiro:
      // e o que mais precisa do seu olho.
      if (a.confidence !== b.confidence) return a.confidence - b.confidence;
      return b.unifiedItem.occurredAt.getTime() - a.unifiedItem.occurredAt.getTime();
    })
    .map((t) => ({
      unifiedItemId: t.unifiedItemId,
      title: t.unifiedItem.title ?? '(sem assunto)',
      preview: t.unifiedItem.preview ?? '',
      occurredAt: formatInZone(t.unifiedItem.occurredAt, tz, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
      category: t.category,
      priority: t.priority,
      needsReply: t.needsReply,
      confidence: t.confidence,
      reason: t.reason,
      source: t.source,
      copyCount: t.unifiedItem.copyCount,
    }));

  return (
    <main className="shell">
      <Nav atual="/triagem" />
      <header className="topo">
        <div>
          <h1>Triagem</h1>
          <p className="sub">
            Ordenado pelo que exige ação, não por data. Discorde de qualquer classificação — cada
            correção sua ensina o sistema.
          </p>
        </div>
      </header>

      {totalTriado === 0 ? (
        <div className="aviso">
          <p>
            <strong>Nenhuma triagem executada ainda.</strong>{' '}
            {pendentes > 0 && `${pendentes} mensagens aguardando classificação. `}
            A triagem envia <strong>apenas metadados</strong> — remetente, assunto e um trecho
            curto. O corpo do e-mail nunca sai daqui.
          </p>
          <p className="sub" style={{ marginBottom: 12 }}>
            Vale preencher antes os <a href="/perfis">perfis das caixas</a> — sem contexto de
            negócio a classificação fica bem pior. Requer <code>ANTHROPIC_API_KEY</code>
            configurada.
          </p>
          <BotaoTriar pendentes={pendentes} />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {FILTROS.map((f) => (
              <a
                key={f.chave}
                href={`/triagem?filtro=${f.chave}`}
                className={`pill ${filtro === f.chave ? 'ok' : ''}`}
                style={{
                  textDecoration: 'none',
                  padding: '5px 12px',
                  color: filtro === f.chave ? 'var(--ok)' : 'var(--muted)',
                }}
              >
                {f.rotulo}
              </a>
            ))}
          </div>

          <ProvedorSelecao>
            <section className="card">
              {itens.length === 0 ? (
                <p className="vazio">Nada neste filtro.</p>
              ) : (
                itens.map((item) => <ItemTriagemLinha key={item.unifiedItemId} item={item} />)
              )}
            </section>
          </ProvedorSelecao>

          <p className="sub" style={{ marginTop: 14 }}>
            {totalTriado} {totalTriado === 1 ? 'item classificado' : 'itens classificados'}
            {pendentes > 0 && ` · ${pendentes} ainda sem triagem`}
            {correcoes > 0 &&
              ` · ${correcoes} ${correcoes === 1 ? 'correção sua registrada' : 'correções suas registradas'}`}
            .
          </p>
          {filtro === 'cobranca' && (
            <p className="sub" style={{ marginTop: 6 }}>
              Detecção automática — <strong>não é garantia</strong> de que todas as cobranças foram
              encontradas. Confira sempre no e-mail original.
            </p>
          )}
        </>
      )}
    </main>
  );
}
