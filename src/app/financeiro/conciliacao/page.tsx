import { prisma } from '@/lib/db';
import { formatarValor } from '@/core/finance/format';
import { DEFAULT_TIMEZONE, formatInZone } from '@/core/time/zone';
import { Nav } from '../../nav';
import { BotaoProcurar, BotoesDecisao, CasarManual, type CobrancaOpcao } from './controles';

/**
 * Conciliacao: cada saida do extrato x a cobranca que chegou por e-mail.
 * Ver docs/10-financeiro.md
 *
 * Tres listas, nesta ordem, porque e a ordem do seu trabalho:
 *   1. sugestoes esperando voce (confirmo / nao e);
 *   2. saidas sem par, com a opcao de casar a mao;
 *   3. o que ja foi decidido, com desfazer.
 */

export const dynamic = 'force-dynamic';

const JANELA_DIAS = 120;

export default async function PaginaConciliacao() {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) {
    return (
      <main className="shell">
        <Nav atual="/financeiro/conciliacao" />
        <h1>Conciliação</h1>
        <p className="vazio">Nenhuma conta conectada ainda.</p>
      </main>
    );
  }
  const tz = usuario.timezone || DEFAULT_TIMEZONE;
  const desde = new Date(Date.now() - JANELA_DIAS * 24 * 3600 * 1000);

  const [saidas, cobrancasAbertas, cobrancasTodas] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { userId: usuario.id, amountCents: { lt: 0 }, postedAt: { gte: desde } },
      orderBy: { postedAt: 'desc' },
      take: 400,
      include: { account: { select: { label: true } } },
    }),
    prisma.billExtraction.findMany({
      where: { userId: usuario.id, isPayable: true, status: 'PENDING', amountCents: { not: null } },
      orderBy: { dueDate: 'asc' },
      select: { id: true, amountCents: true, dueDate: true, payee: true },
    }),
    prisma.billExtraction.findMany({
      where: { userId: usuario.id },
      select: { id: true, amountCents: true, dueDate: true, payee: true, kind: true, status: true, unifiedItem: { select: { title: true } } },
    }),
  ]);

  const cobrancaPorId = new Map(cobrancasTodas.map((c) => [c.id, c]));
  const dia = (d: Date | null) => (d ? formatInZone(d, tz, { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

  const sugeridas = saidas.filter((s) => s.matchStatus === 'SUGGESTED' && s.matchedBillId);
  const semPar = saidas.filter((s) => s.matchStatus === 'NONE');
  const decididas = saidas.filter((s) => s.matchStatus === 'CONFIRMED' || s.matchStatus === 'REJECTED');

  const opcoes: CobrancaOpcao[] = cobrancasAbertas.map((c) => ({
    id: c.id,
    rotulo: `${c.payee ?? '(sem beneficiário)'} · ${formatarValor(c.amountCents)} · vence ${dia(c.dueDate)}`,
  }));

  const Cobranca = ({ id }: { id: string | null }) => {
    const c = id ? cobrancaPorId.get(id) : undefined;
    if (!c) return <span className="sub">cobrança não encontrada</span>;
    return (
      <span>
        {c.payee ?? c.unifiedItem.title ?? '(sem beneficiário)'}
        <br />
        <span className="sub" style={{ fontSize: 11 }}>
          {formatarValor(c.amountCents)} · vence {dia(c.dueDate)} · {c.kind.toLowerCase()}
          {c.status === 'PAID' ? ' · paga' : ''}
        </span>
      </span>
    );
  };

  const Saida = ({ s }: { s: (typeof saidas)[number] }) => (
    <span>
      {s.description}
      <br />
      <span className="sub" style={{ fontSize: 11 }}>
        {dia(s.postedAt)} · {s.account.label}
      </span>
    </span>
  );

  const celula = { padding: '8px 10px 8px 0', verticalAlign: 'top' as const, fontSize: 13 };

  return (
    <main className="shell">
      <Nav atual="/financeiro/conciliacao" />
      <header className="topo">
        <div>
          <h1>Conciliação</h1>
          <p className="sub">
            Cada saída do extrato cruzada com a cobrança que chegou por e-mail. Nada é casado sem você.
          </p>
        </div>
        <div>
          <BotaoProcurar />
        </div>
      </header>

      <div className="grid" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>Esperando você</h2>
          <div className="metric">{sugeridas.length}</div>
          <div className="metric-label">sugestões</div>
        </section>
        <section className="card">
          <h2>Sem par</h2>
          <div className="metric">{semPar.length}</div>
          <div className="metric-label">saídas nos últimos {JANELA_DIAS} dias</div>
        </section>
        <section className="card">
          <h2>Cobranças em aberto</h2>
          <div className="metric">{cobrancasAbertas.length}</div>
          <div className="metric-label">com valor, ainda não pagas</div>
        </section>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Sugestões</h2>
        {sugeridas.length === 0 ? (
          <p className="vazio">
            Nenhuma sugestão pendente. Clique em <strong>Procurar pares</strong> depois de importar um extrato ou extrair cobranças.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 12 }}>
                  <th style={celula}>saída no extrato</th>
                  <th style={celula}>cobrança no e-mail</th>
                  <th style={celula}>por quê</th>
                  <th style={celula}></th>
                </tr>
              </thead>
              <tbody>
                {sugeridas.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={celula}>
                      <strong style={{ color: 'var(--crit)' }}>{formatarValor(s.amountCents)}</strong>
                      <br />
                      <Saida s={s} />
                    </td>
                    <td style={celula}>
                      <Cobranca id={s.matchedBillId} />
                    </td>
                    <td style={{ ...celula, fontSize: 12 }}>
                      <span className={`pill ${(s.matchConfidence ?? 0) >= 0.85 ? 'ok' : 'warn'}`}>
                        {Math.round((s.matchConfidence ?? 0) * 100)}%
                      </span>{' '}
                      <span className="sub">{s.matchReason}</span>
                    </td>
                    <td style={celula}>
                      <BotoesDecisao lancamentoId={s.id} status={s.matchStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Saídas sem par</h2>
        <p className="sub" style={{ fontSize: 12, marginBottom: 8 }}>
          Normal para a maioria: salário, transferência entre contas, compra no débito. Se uma delas é o pagamento de
          uma cobrança que chegou por e-mail, escolha qual.
        </p>
        {semPar.length === 0 ? (
          <p className="vazio">Todas as saídas recentes têm decisão.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <tbody>
                {semPar.slice(0, 150).map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ ...celula, whiteSpace: 'nowrap' }}>
                      <strong style={{ color: 'var(--crit)' }}>{formatarValor(s.amountCents)}</strong>
                    </td>
                    <td style={celula}>
                      <Saida s={s} />
                    </td>
                    <td style={celula}>
                      <CasarManual lancamentoId={s.id} cobrancas={opcoes} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {semPar.length > 150 && (
              <p className="sub" style={{ fontSize: 12 }}>
                Mostrando 150 de {semPar.length}.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Decididas</h2>
        {decididas.length === 0 ? (
          <p className="vazio">Nada decidido ainda.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <tbody>
                {decididas.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ ...celula, whiteSpace: 'nowrap' }}>
                      <span className={`pill ${s.matchStatus === 'CONFIRMED' ? 'ok' : ''}`}>
                        {s.matchStatus === 'CONFIRMED' ? 'confirmado' : 'não é cobrança'}
                      </span>
                    </td>
                    <td style={celula}>
                      <strong>{formatarValor(s.amountCents)}</strong> <Saida s={s} />
                    </td>
                    <td style={celula}>{s.matchStatus === 'CONFIRMED' ? <Cobranca id={s.matchedBillId} /> : <span className="sub">{s.matchReason}</span>}</td>
                    <td style={celula}>
                      <BotoesDecisao lancamentoId={s.id} status={s.matchStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
