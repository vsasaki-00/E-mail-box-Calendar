import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { DEFAULT_TIMEZONE, formatDateTime } from '@/core/time/zone';
import { AcaoLinha, type AcaoItem } from './acao-linha';

/**
 * Fila de ações e log de auditoria (fase 4).
 * Ver docs/08-escrita-e-acoes.md
 *
 * São a mesma lista de propósito. Um log separado da fila diverge dela, e
 * aí você tem dois registros discordando sobre o que o app fez na sua
 * caixa — e o registro que some quando você desfaz não é auditoria.
 */

export const dynamic = 'force-dynamic';

const FILTROS = [
  { chave: 'pendentes', rotulo: 'Esperando você' },
  { chave: 'feitas', rotulo: 'Já feitas' },
  { chave: 'tudo', rotulo: 'Tudo' },
] as const;

type Filtro = (typeof FILTROS)[number]['chave'];

export default async function PaginaAcoes({
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
        <h1>Ações</h1>
        <div className="aviso">
          <p>
            <strong>Nenhuma conta conectada.</strong> <a href="/conexoes">Conectar uma caixa →</a>
          </p>
        </div>
      </main>
    );
  }

  const tz = usuario.timezone || DEFAULT_TIMEZONE;

  const where: Prisma.ActionRequestWhereInput =
    filtro === 'pendentes'
      ? { userId: usuario.id, status: { in: ['PENDING', 'CONFIRMED', 'FAILED'] } }
      : filtro === 'feitas'
        ? { userId: usuario.id, status: { in: ['DONE', 'UNDONE'] } }
        : { userId: usuario.id };

  const [acoes, conexoes] = await Promise.all([
    prisma.actionRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { connection: { select: { accountEmail: true, color: true } } },
    }),
    prisma.connection.findMany({
      where: { userId: usuario.id },
      select: { id: true, accountEmail: true, writeEnabled: true, provider: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const itens: AcaoItem[] = acoes.map((a) => ({
    id: a.id,
    kind: a.kind,
    status: a.status,
    actor: a.actor,
    description: a.description,
    reversible: a.reversible,
    contaEmail: a.connection.accountEmail,
    contaCor: a.connection.color,
    error: a.error,
    quando: formatDateTime(a.createdAt, tz),
    executadoEm: a.executedAt ? formatDateTime(a.executedAt, tz) : null,
  }));

  const comEscrita = conexoes.filter((c) => c.writeEnabled);
  const pendentes = acoes.filter((a) => a.status === 'PENDING' || a.status === 'CONFIRMED').length;

  return (
    <main className="shell">
      <header className="topo">
        <div>
          <h1>Ações</h1>
          <p className="sub">
            Tudo que o app escreveu — ou vai escrever — nas suas caixas. Fila e log de auditoria
            na mesma lista.
          </p>
        </div>
        <a href="/" className="sub">← voltar</a>
      </header>

      <div className="aviso" style={{ marginBottom: 16 }}>
        <p>
          <strong>Nada acontece sem você confirmar.</strong> O agente pode propor ações
          reversíveis (arquivar, marcar lido, aplicar marcador); enviar e-mail e criar evento
          são coisas que <strong>só você</strong> pode pedir, e pedem uma confirmação em duas
          etapas.
        </p>
        <p className="sub">
          Não existe ação de <strong>excluir</strong> neste sistema. Arquivar resolve o mesmo
          problema e volta atrás; apagar é o único erro que você nunca descobre.
        </p>
      </div>

      <div className="grid" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>Esperando você</h2>
          <div className="metric" style={{ color: pendentes > 0 ? 'var(--crit)' : undefined }}>
            {pendentes}
          </div>
          <div className="metric-label">
            {pendentes === 0 ? 'nada na fila' : 'ações propostas'}
          </div>
        </section>

        <section className="card">
          <h2>Caixas que podem escrever</h2>
          <div className="metric">
            {comEscrita.length}
            <span className="sub" style={{ fontSize: 14 }}> / {conexoes.length}</span>
          </div>
          <div className="metric-label">
            {comEscrita.length === 0
              ? 'todas em somente-leitura'
              : comEscrita.map((c) => c.accountEmail).join(', ')}
          </div>
          <p className="sub" style={{ marginTop: 8 }}>
            <a href="/conexoes">gerenciar autorização por caixa →</a>
          </p>
        </section>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {FILTROS.map((f) => (
          <a
            key={f.chave}
            href={`/acoes?filtro=${f.chave}`}
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

      {itens.length === 0 ? (
        <p className="vazio">
          {conexoes.every((c) => !c.writeEnabled)
            ? 'Nenhuma caixa autorizou escrita ainda. Enquanto isso o app só lê — que é o padrão.'
            : 'Nenhuma ação neste filtro.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {itens.map((item) => (
            <AcaoLinha key={item.id} item={item} />
          ))}
        </div>
      )}
    </main>
  );
}
