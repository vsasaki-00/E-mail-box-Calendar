import { prisma } from '@/lib/db';
import { formatarValor } from '@/core/finance/format';
import { DEFAULT_TIMEZONE, formatDateTime, formatInZone } from '@/core/time/zone';
import { BUSINESS_CONTEXTS } from '@/core/triage/businesses';
import { Nav } from '../../nav';
import { ImportarExtrato } from './importar-form';

/**
 * Extrato: contas, importacoes e lancamentos. Ver docs/10-financeiro.md
 *
 * E o razao — o que de fato entrou e saiu das contas. Diferente do
 * /financeiro, que e o que CHEGOU POR E-MAIL para pagar. A conciliacao
 * entre os dois e o proximo passo.
 */

export const dynamic = 'force-dynamic';

const TIPO_CONTA: Record<string, string> = {
  CHECKING: 'conta corrente',
  SAVINGS: 'poupança',
  CREDIT_CARD: 'cartão',
  CASH: 'dinheiro',
  INVESTMENT: 'investimento',
  OTHER: 'outra',
};

export default async function PaginaExtrato() {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) {
    return (
      <main className="shell">
        <Nav atual="/financeiro" />
        <h1>Extrato</h1>
        <p className="vazio">Nenhuma conta conectada ainda.</p>
      </main>
    );
  }
  const tz = usuario.timezone || DEFAULT_TIMEZONE;

  const [contas, importacoes, lancamentos] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId: usuario.id, archived: false },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { entries: true } } },
    }),
    prisma.statementImport.findMany({
      where: { userId: usuario.id },
      orderBy: { importedAt: 'desc' },
      take: 10,
      include: { account: { select: { label: true } } },
    }),
    prisma.ledgerEntry.findMany({
      where: { userId: usuario.id },
      orderBy: { postedAt: 'desc' },
      take: 60,
      include: { account: { select: { label: true } } },
    }),
  ]);

  const dia = (d: Date) => formatInZone(d, tz, { day: '2-digit', month: '2-digit', year: '2-digit' });

  return (
    <main className="shell">
      <Nav atual="/financeiro" />
      <header className="topo">
        <div>
          <h1>Extrato</h1>
          <p className="sub">
            O que entrou e saiu das suas contas, importado do banco. <a href="/financeiro">← cobranças por e-mail</a>
          </p>
        </div>
      </header>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Importar extrato</h2>
        <ImportarExtrato
          contas={contas.map((c) => ({ id: c.id, label: c.label }))}
          negocios={BUSINESS_CONTEXTS}
        />
      </section>

      <div className="grid" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>Contas</h2>
          {contas.length === 0 ? (
            <p className="vazio">Nenhuma conta ainda. A primeira importação cria uma.</p>
          ) : (
            contas.map((c) => (
              <div key={c.id} className="linha" style={{ alignItems: 'center' }}>
                <span className="titulo-item">
                  {c.label}
                  <br />
                  <span className="sub">
                    {TIPO_CONTA[c.kind] ?? c.kind}
                    {c.business ? ` · ${c.business}` : ''}
                    {' · '}
                    {c._count.entries} lançamentos
                  </span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <strong>{formatarValor(c.balanceCents)}</strong>
                  <br />
                  <span className="sub" style={{ fontSize: 11 }}>
                    {c.balanceAt ? `saldo em ${dia(c.balanceAt)}` : 'sem saldo informado'}
                  </span>
                </span>
              </div>
            ))
          )}
        </section>

        <section className="card">
          <h2>Importações</h2>
          {importacoes.length === 0 ? (
            <p className="vazio">Nada importado ainda.</p>
          ) : (
            importacoes.map((i) => (
              <div key={i.id} className="linha">
                <span className="titulo-item">
                  {i.fileName ?? '(sem nome)'} → {i.account.label}
                  <br />
                  <span className="sub">
                    {i.source} · {formatDateTime(i.importedAt, tz)}
                    {i.periodStart && i.periodEnd ? ` · ${dia(i.periodStart)} a ${dia(i.periodEnd)}` : ''}
                  </span>
                </span>
                <span className="sub" style={{ textAlign: 'right', fontSize: 12 }}>
                  {i.entriesCreated} novos
                  <br />
                  {i.entriesDuplicate} repetidos
                </span>
              </div>
            ))
          )}
        </section>
      </div>

      <section className="card">
        <h2>Últimos lançamentos</h2>
        {lancamentos.length === 0 ? (
          <p className="vazio">Importe um extrato para ver os lançamentos aqui.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 12 }}>
                  <th style={{ padding: '4px 8px 4px 0' }}>data</th>
                  <th style={{ padding: '4px 8px' }}>descrição</th>
                  <th style={{ padding: '4px 8px' }}>conta</th>
                  <th style={{ padding: '4px 0 4px 8px', textAlign: 'right' }}>valor</th>
                </tr>
              </thead>
              <tbody>
                {lancamentos.map((l) => (
                  <tr key={l.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px 6px 0', whiteSpace: 'nowrap' }}>{dia(l.postedAt)}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {l.description}
                      {l.business && <span className="sub" style={{ fontSize: 11 }}> · {l.business}</span>}
                    </td>
                    <td style={{ padding: '6px 8px' }} className="sub">
                      {l.account.label}
                    </td>
                    <td
                      style={{
                        padding: '6px 0 6px 8px',
                        textAlign: 'right',
                        whiteSpace: 'nowrap',
                        color: l.amountCents < 0 ? 'var(--crit)' : 'var(--ok)',
                      }}
                    >
                      {formatarValor(l.amountCents)}
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
