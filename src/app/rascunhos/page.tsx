import { prisma } from '@/lib/db';
import { DEFAULT_TIMEZONE, formatDateTime, formatInZone } from '@/core/time/zone';
import { RascunhoCard, type RascunhoItem } from './rascunho-card';

/**
 * Rascunhos de resposta (fase 5D). Ver docs/07-agente-de-triagem.md
 *
 * A regra que organiza a tela inteira: **nada aqui envia e-mail**. Não há
 * cliente SMTP no projeto, não há chamada de envio nos conectores, e o
 * schema não tem estado "enviado". "Está bom, vou usar" registra que você
 * aprovou o texto — você copia e manda do seu cliente de e-mail.
 */

export const dynamic = 'force-dynamic';

const ORDEM_PRIORIDADE: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

const FILTROS = [
  { chave: 'pendentes', rotulo: 'Esperando resposta' },
  { chave: 'rascunhos', rotulo: 'Com rascunho' },
  { chave: 'aprovados', rotulo: 'Aprovados por mim' },
] as const;

type Filtro = (typeof FILTROS)[number]['chave'];

export default async function PaginaRascunhos({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  const params = await searchParams;
  const filtro: Filtro = FILTROS.some((f) => f.chave === params.filtro)
    ? (params.filtro as Filtro)
    : 'pendentes';

  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) {
    return (
      <main className="shell">
        <h1>Rascunhos</h1>
        <div className="aviso">
          <p>
            <strong>Nenhuma conta conectada.</strong> <a href="/conexoes">Conectar uma caixa →</a>
          </p>
        </div>
      </main>
    );
  }

  const tz = usuario.timezone || DEFAULT_TIMEZONE;

  const triagens = await prisma.itemTriage.findMany({
    where: { userId: usuario.id, needsReply: true },
    take: 60,
    include: {
      unifiedItem: {
        select: {
          id: true,
          title: true,
          occurredAt: true,
          draft: true,
          messages: {
            take: 1,
            orderBy: { receivedAt: 'desc' },
            select: {
              fromName: true,
              fromEmail: true,
              connection: {
                select: {
                  color: true,
                  accountEmail: true,
                  voiceProfile: { select: { userApproved: true } },
                  mailboxProfile: { select: { businessName: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const itens: RascunhoItem[] = triagens
    .sort((a, b) => {
      const p = (ORDEM_PRIORIDADE[a.priority] ?? 9) - (ORDEM_PRIORIDADE[b.priority] ?? 9);
      if (p !== 0) return p;
      return b.unifiedItem.occurredAt.getTime() - a.unifiedItem.occurredAt.getTime();
    })
    .map((t) => {
      const mensagem = t.unifiedItem.messages[0];
      const rascunho = t.unifiedItem.draft;
      return {
        unifiedItemId: t.unifiedItemId,
        title: t.unifiedItem.title ?? '(sem assunto)',
        fromName: mensagem?.fromName ?? null,
        fromEmail: mensagem?.fromEmail ?? null,
        occurredAt: formatInZone(t.unifiedItem.occurredAt, tz, {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
        contaCor: mensagem?.connection.color ?? '#888',
        contaEmail: mensagem?.connection.accountEmail ?? '',
        negocio: mensagem?.connection.mailboxProfile?.businessName ?? null,
        prioridade: t.priority,
        perfilValidado: mensagem?.connection.voiceProfile?.userApproved ?? false,
        rascunho: rascunho
          ? {
              subject: rascunho.subject,
              bodyComposed: rascunho.bodyComposed,
              bodyEdited: rascunho.bodyEdited,
              status: rascunho.status,
              reason: rascunho.reason,
              criadoEm: formatDateTime(rascunho.createdAt, tz),
            }
          : null,
      };
    });

  const visiveis = itens.filter((i) => {
    switch (filtro) {
      case 'rascunhos':
        return i.rascunho !== null && i.rascunho.status !== 'DISCARDED';
      case 'aprovados':
        return i.rascunho?.status === 'APPROVED';
      default:
        return i.rascunho === null || i.rascunho.status === 'PROPOSED';
    }
  });

  const comRascunho = itens.filter((i) => i.rascunho !== null).length;
  const editados = itens.filter((i) => i.rascunho?.bodyEdited).length;

  return (
    <main className="shell">
      <header className="topo">
        <div>
          <h1>Rascunhos</h1>
          <p className="sub">
            Respostas escritas com o seu perfil de voz, para você aprovar ou corrigir.
          </p>
        </div>
        <a href="/" className="sub">← voltar</a>
      </header>

      <div className="aviso" style={{ marginBottom: 16 }}>
        <p>
          <strong>Nada nesta tela envia e-mail.</strong> Não existe envio no sistema — nem
          desligado por configuração: a capacidade não está aqui. “Está bom, vou usar” só
          registra que você aprovou o texto; copiar e mandar é você, do seu cliente de e-mail.
        </p>
        <p className="sub">
          Gerar um rascunho lê o corpo <strong>daquele e-mail específico</strong>, quando você
          pede. Nunca em lote pela caixa. E só funciona com perfil de voz que você validou.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {FILTROS.map((f) => (
          <a
            key={f.chave}
            href={`/rascunhos?filtro=${f.chave}`}
            className="pill"
            style={{
              textDecoration: 'none',
              fontWeight: filtro === f.chave ? 600 : 400,
              color: filtro === f.chave ? 'var(--text)' : 'var(--muted)',
            }}
          >
            {f.rotulo}
          </a>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <p className="vazio">
          {itens.length === 0
            ? 'Nenhum item marcado como “precisa de resposta”. A lista vem da triagem — rode em /triagem.'
            : 'Nenhum item neste filtro.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {visiveis.map((item) => (
            <RascunhoCard key={item.unifiedItemId} item={item} />
          ))}
        </div>
      )}

      {comRascunho > 0 && (
        <p className="sub" style={{ marginTop: 18, fontSize: 12 }}>
          {comRascunho} rascunho{comRascunho === 1 ? '' : 's'} gerado
          {comRascunho === 1 ? '' : 's'}, {editados} editado{editados === 1 ? '' : 's'} por você.
          {/* A distancia entre o gerado e o editado e a unica medida honesta
              de se o rascunho esta ficando bom. */}
          {editados > 0 && ' Suas edições são o que faz o rascunho melhorar.'}
        </p>
      )}
    </main>
  );
}
