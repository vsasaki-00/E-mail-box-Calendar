import { prisma } from '@/lib/db';
import { formatarValor } from '@/core/finance/format';
import { DEFAULT_TIMEZONE, formatDateTime, formatInZone } from '@/core/time/zone';
import { BUSINESS_CONTEXTS } from '@/core/triage/businesses';
import { Nav } from '../../nav';
import { ImportarExtrato } from './importar-form';
import { EditarConta } from './conta-form';
import { nomeDaInstituicao } from '@/core/finance/bancos';
import { ATALHOS, resolverPeriodo } from '@/core/finance/extrato/periodo';
import { CATEGORIAS } from '@/core/finance/categorias';
import { BotaoApagarRegra, BotaoCategorizar, CategoriaInline } from './categoria-form';

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

const LIMITE_LINHAS = 300;

export default async function PaginaExtrato({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; de?: string; ate?: string; conta?: string }>;
}) {
  const params = await searchParams;
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) {
    return (
      <main className="shell">
        <Nav atual="/financeiro/extrato" />
        <h1>Extrato</h1>
        <p className="vazio">Nenhuma conta conectada ainda.</p>
      </main>
    );
  }
  const tz = usuario.timezone || DEFAULT_TIMEZONE;

  // Periodo no fuso do usuario. "Este mes" as 23h de 31/08 ainda e agosto.
  const periodo = resolverPeriodo({ atalho: params.periodo, de: params.de, ate: params.ate }, tz);
  const contaFiltro = params.conta?.trim() || undefined;
  const filtro = {
    userId: usuario.id,
    ...(contaFiltro ? { accountId: contaFiltro } : {}),
    ...(periodo.inicio || periodo.fim
      ? { postedAt: { ...(periodo.inicio ? { gte: periodo.inicio } : {}), ...(periodo.fim ? { lt: periodo.fim } : {}) } }
      : {}),
  };

  const [contas, importacoes, lancamentos, totalNoPeriodo, somas, regras] = await Promise.all([
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
      where: filtro,
      orderBy: { postedAt: 'desc' },
      take: LIMITE_LINHAS,
      include: { account: { select: { label: true } } },
    }),
    prisma.ledgerEntry.count({ where: filtro }),
    // Entradas e saidas do periodo, somadas no banco — nao so das linhas
    // mostradas. E o numero que responde "quanto entrou este mes".
    Promise.all([
      prisma.ledgerEntry.aggregate({ where: { ...filtro, amountCents: { gt: 0 } }, _sum: { amountCents: true } }),
      prisma.ledgerEntry.aggregate({ where: { ...filtro, amountCents: { lt: 0 } }, _sum: { amountCents: true } }),
    ]),
    prisma.categoryRule.findMany({ where: { userId: usuario.id }, orderBy: { createdAt: 'desc' } }),
  ]);
  const entradas = somas[0]._sum.amountCents ?? 0;
  const saidas = somas[1]._sum.amountCents ?? 0;

  const linkPeriodo = (atalho: string) => {
    const q = new URLSearchParams({ periodo: atalho });
    if (contaFiltro) q.set('conta', contaFiltro);
    return `/financeiro/extrato?${q.toString()}`;
  };

  const dia = (d: Date) => formatInZone(d, tz, { day: '2-digit', month: '2-digit', year: '2-digit' });

  return (
    <main className="shell">
      <Nav atual="/financeiro/extrato" />
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
            contas.map((c) => {
              const banco = nomeDaInstituicao(c);
              return (
                <div key={c.id} className="linha" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <span className="titulo-item" style={{ flex: 1, minWidth: 220 }}>
                    {c.label}
                    <br />
                    <span className="sub">
                      {/* Banco por extenso, sempre que der: "0260" nao diz nada. */}
                      {banco ? `${banco} · ` : ''}
                      {TIPO_CONTA[c.kind] ?? c.kind}
                      {c.accountId ? ` · ${c.accountId}` : ''}
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
                  <div style={{ flexBasis: '100%' }}>
                    <EditarConta
                      conta={{
                        id: c.id,
                        label: c.label,
                        institution: c.institution,
                        kind: c.kind,
                        business: c.business,
                      }}
                      negocios={BUSINESS_CONTEXTS}
                    />
                  </div>
                </div>
              );
            })
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Lançamentos · {periodo.rotulo}</h2>
          <span className="sub" style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--ok)' }}>+{formatarValor(entradas)}</span>
            {' · '}
            <span style={{ color: 'var(--crit)' }}>{formatarValor(saidas)}</span>
            {' · líquido '}
            <strong>{formatarValor(entradas + saidas)}</strong>
          </span>
        </div>

        {/* Filtro sem JavaScript: links para os atalhos e um GET para datas
            livres. A URL e o estado — da para mandar o link para alguem. */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0 12px' }}>
          {ATALHOS.map((a) => (
            <a
              key={a.chave}
              href={linkPeriodo(a.chave)}
              className="pill"
              style={{
                textDecoration: 'none',
                fontWeight: periodo.atalho === a.chave ? 600 : 400,
                color: periodo.atalho === a.chave ? 'var(--text)' : 'var(--muted)',
              }}
            >
              {a.rotulo}
            </a>
          ))}
          <form method="get" action="/financeiro/extrato" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 8 }}>
            {contaFiltro && <input type="hidden" name="conta" value={contaFiltro} />}
            <label className="sub" style={{ fontSize: 12 }}>
              de <input type="date" name="de" defaultValue={periodo.deIso ?? ''} style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
            </label>
            <label className="sub" style={{ fontSize: 12 }}>
              até <input type="date" name="ate" defaultValue={periodo.ateIso ?? ''} style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
            </label>
            <button type="submit" className="pill" style={{ cursor: 'pointer', font: 'inherit', fontSize: 12 }}>
              filtrar
            </button>
          </form>
          {contas.length > 1 && (
            <form method="get" action="/financeiro/extrato" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              {periodo.atalho && <input type="hidden" name="periodo" value={periodo.atalho} />}
              {!periodo.atalho && periodo.deIso && <input type="hidden" name="de" value={periodo.deIso} />}
              {!periodo.atalho && periodo.ateIso && <input type="hidden" name="ate" value={periodo.ateIso} />}
              <select name="conta" defaultValue={contaFiltro ?? ''} style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
                <option value="">todas as contas</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button type="submit" className="pill" style={{ cursor: 'pointer', font: 'inherit', fontSize: 12 }}>
                ok
              </button>
            </form>
          )}
        </div>

        <div style={{ marginBottom: 10 }}>
          <BotaoCategorizar />
        </div>

        {totalNoPeriodo > lancamentos.length && (
          <p className="sub" style={{ fontSize: 12, marginBottom: 8 }}>
            Mostrando {lancamentos.length} de {totalNoPeriodo} — os totais acima somam todos. Estreite o período para ver o resto.
          </p>
        )}

        {lancamentos.length === 0 ? (
          <p className="vazio">
            {totalNoPeriodo === 0 && !periodo.inicio && !periodo.fim
              ? 'Importe um extrato para ver os lançamentos aqui.'
              : 'Nenhum lançamento neste período.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 12 }}>
                  <th style={{ padding: '4px 8px 4px 0' }}>data</th>
                  <th style={{ padding: '4px 8px' }}>descrição</th>
                  <th style={{ padding: '4px 8px' }}>conta</th>
                  <th style={{ padding: '4px 8px' }}>categoria</th>
                  <th style={{ padding: '4px 0 4px 8px', textAlign: 'right' }}>valor</th>
                </tr>
              </thead>
              <tbody>
                {lancamentos.map((l) => (
                  <tr key={l.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px 6px 0', whiteSpace: 'nowrap' }}>{dia(l.postedAt)}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {l.description}
                    </td>
                    <td style={{ padding: '6px 8px' }} className="sub">
                      {l.account.label}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <CategoriaInline
                        lancamentoId={l.id}
                        category={l.category}
                        categorySource={l.categorySource}
                        business={l.business}
                        categorias={CATEGORIAS}
                        negocios={BUSINESS_CONTEXTS}
                      />
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

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Regras de categoria</h2>
        <p className="sub" style={{ fontSize: 12, marginBottom: 8 }}>
          Nascem quando você categoriza um lançamento e marca <strong>sempre</strong>. Casam por palavras
          da descrição; a próxima importação já vem classificada. Apague a que não fizer sentido.
        </p>
        {regras.length === 0 ? (
          <p className="vazio">Nenhuma regra ainda.</p>
        ) : (
          regras.map((r) => (
            <div key={r.id} className="linha" style={{ alignItems: 'center' }}>
              <span className="titulo-item">
                <code>{r.pattern}</code>
                <br />
                <span className="sub">
                  {[r.category, r.business].filter(Boolean).join(' · ') || '(sem efeito)'} · {r.hits} acerto(s)
                </span>
              </span>
              <BotaoApagarRegra regraId={r.id} />
            </div>
          ))
        )}
      </section>
    </main>
  );
}
