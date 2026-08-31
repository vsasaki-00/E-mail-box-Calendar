import { prisma } from '@/lib/db';
import { formatarValor } from '@/core/finance/format';
import { CobrancaCard, type CobrancaItem } from './cobranca-card';
import { ExtrairForm } from './extrair-form';
import { Nav } from '../nav';

/**
 * Painel de contas a pagar. Ver docs/07-agente-de-triagem.md (fase 5B)
 *
 * A armadilha desta tela, e ela e seria: um painel que perde um boleto faz
 * voce olhar, ver "nada vencendo" e concluir que esta tudo pago. O erro do
 * sistema virou o seu. Por isso a tela declara em todo lugar que a deteccao
 * e automatica e NAO e garantia de completude, mostra de onde veio cada
 * numero, e nunca esconde uma cobranca com problema.
 */

export const dynamic = 'force-dynamic';

const FILTROS = [
  { chave: 'aberto', rotulo: 'Em aberto' },
  { chave: 'vencendo', rotulo: 'Vencendo (7 dias)' },
  { chave: 'revisar', rotulo: 'Com aviso' },
  { chave: 'tudo', rotulo: 'Tudo' },
] as const;

type Filtro = (typeof FILTROS)[number]['chave'];

const DIA_MS = 86_400_000;

function diasAte(data: Date | null, hoje: Date): number | null {
  if (!data) return null;
  const d = Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate());
  const h = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  return Math.round((d - h) / DIA_MS);
}

export default async function PaginaFinanceiro({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  const params = await searchParams;
  const filtro: Filtro = FILTROS.some((f) => f.chave === params.filtro)
    ? (params.filtro as Filtro)
    : 'aberto';

  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) {
    return (
      <main className="shell">
      <Nav atual="/financeiro" />
        <h1>Financeiro</h1>
        <div className="aviso">
          <p>
            <strong>Nenhuma conta conectada.</strong>{' '}
            <a href="/conexoes">Conectar uma caixa →</a>
          </p>
        </div>
      </main>
    );
  }

  const hoje = new Date();

  const cobrancas = await prisma.billExtraction.findMany({
    where: { userId: usuario.id },
    include: {
      unifiedItem: {
        select: {
          title: true,
          // Um item unificado pode ter varias copias (a mesma cobranca
          // chegando em duas caixas). A primeira basta para mostrar de onde
          // veio; a deduplicacao ja garante que ela aparece uma vez so.
          messages: {
            take: 1,
            select: {
              fromEmail: true,
              connection: { select: { color: true, accountEmail: true } },
            },
          },
        },
      },
    },
  });

  const itens: CobrancaItem[] = cobrancas.map((c) => {
    const mensagem = c.unifiedItem.messages[0];
    return {
      unifiedItemId: c.unifiedItemId,
      payee: c.payee,
      subject: c.unifiedItem.title ?? null,
      fromEmail: mensagem?.fromEmail ?? null,
      amountCents: c.amountCents,
      dueDate: c.dueDate ? c.dueDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : null,
      dueDateISO: c.dueDate ? c.dueDate.toISOString().slice(0, 10) : null,
      diasAteVencer: diasAte(c.dueDate, hoje),
      kind: c.kind,
      source: c.source,
      confidence: c.confidence,
      reason: c.reason,
      warnings: Array.isArray(c.warnings) ? (c.warnings as string[]) : [],
      digitableLine: c.digitableLine,
      pixPayload: c.pixPayload,
      status: c.status,
      isPayable: c.isPayable,
      userNotes: c.userNotes,
      contaCor: mensagem?.connection.color ?? '#888',
      contaEmail: mensagem?.connection.accountEmail ?? '',
    };
  });

  const emAberto = itens.filter((i) => i.status === 'PENDING' && i.isPayable);

  const visiveis = itens
    .filter((i) => {
      switch (filtro) {
        case 'aberto':
          return i.status === 'PENDING';
        case 'vencendo':
          return (
            i.status === 'PENDING' &&
            i.isPayable &&
            i.diasAteVencer !== null &&
            i.diasAteVencer <= 7
          );
        case 'revisar':
          return i.warnings.length > 0;
        default:
          return true;
      }
    })
    // Vencidas primeiro, depois as que vencem antes. Sem vencimento vai
    // para o fim, mas NUNCA some — e justamente o caso que precisa de olho.
    .sort((a, b) => {
      const ka = a.diasAteVencer ?? Number.MAX_SAFE_INTEGER;
      const kb = b.diasAteVencer ?? Number.MAX_SAFE_INTEGER;
      return ka - kb;
    });

  const totalAberto = emAberto.reduce((s, i) => s + (i.amountCents ?? 0), 0);
  const semValor = emAberto.filter((i) => i.amountCents === null).length;
  const vencidas = emAberto.filter((i) => (i.diasAteVencer ?? 1) < 0).length;
  const comAviso = itens.filter((i) => i.warnings.length > 0).length;

  return (
    <main className="shell">
      <Nav atual="/financeiro" />
      <header className="topo">
        <div>
          <h1>Financeiro</h1>
          <p className="sub">
            Contas a pagar detectadas nos seus e-mails, somando todas as caixas.
          </p>
        </div>
      </header>

      <div className="aviso" style={{ marginBottom: 16 }}>
        <p>
          <strong>Isto é detecção automática, não uma garantia de completude.</strong> Uma
          cobrança que chegou só como PDF anexo, ou num e-mail que a triagem não marcou como
          cobrança, não aparece aqui. Não use esta tela como prova de que está tudo pago.
        </p>
        <p className="sub">
          Boleto e PIX são lidos <strong>localmente</strong>, com conferência de dígito
          verificador. O modelo só entra no que sobrou — e o que veio dele fica marcado como
          “estimado”.
        </p>
      </div>

      <div className="grid" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>Em aberto</h2>
          <div className="metric">{formatarValor(totalAberto || null)}</div>
          <div className="metric-label">
            {emAberto.length} cobrança{emAberto.length === 1 ? '' : 's'}
          </div>
          {semValor > 0 && (
            <p className="sub" style={{ marginTop: 8 }}>
              {semValor} sem valor identificado — <strong>não estão nesse total</strong>.
            </p>
          )}
        </section>

        <section className="card">
          <h2>Vencidas</h2>
          <div className="metric" style={{ color: vencidas > 0 ? 'var(--crit)' : undefined }}>
            {vencidas}
          </div>
          <div className="metric-label">
            {vencidas === 0 ? 'nenhuma entre as detectadas' : 'passaram do vencimento'}
          </div>
        </section>

        <section className="card">
          <h2>Precisam de conferência</h2>
          <div className="metric">{comAviso}</div>
          <div className="metric-label">
            {comAviso === 0 ? 'nenhum aviso' : 'com aviso de extração'}
          </div>
        </section>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {FILTROS.map((f) => (
          <a
            key={f.chave}
            href={`/financeiro?filtro=${f.chave}`}
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

      <div style={{ marginBottom: 16 }}>
        <ExtrairForm temChave={Boolean(process.env.ANTHROPIC_API_KEY)} />
      </div>

      {visiveis.length === 0 ? (
        <p className="vazio">
          {itens.length === 0
            ? 'Nenhuma cobrança extraída ainda. O painel lê os e-mails que a triagem marcou como COBRANÇA — rode a triagem em /triagem e depois clique em “Extrair cobranças”.'
            : 'Nenhuma cobrança neste filtro.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visiveis.map((item) => (
            <CobrancaCard key={item.unifiedItemId} item={item} />
          ))}
        </div>
      )}
    </main>
  );
}
