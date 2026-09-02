import { prisma } from '@/lib/db';
import { formatarValor } from '@/core/finance/format';
import { DEFAULT_TIMEZONE, formatInZone } from '@/core/time/zone';
import {
  fluxoMensal,
  fluxoPorNegocio,
  previsibilidade,
  recorrentes,
  saidasPorCategoria,
  torneiras,
  ultimosMeses,
  type LancamentoAnalise,
} from '@/core/finance/analise';
import { Nav } from '../../nav';
import { GraficoCategorias, GraficoFluxo, Legenda, MiniFluxo } from './graficos';

/**
 * Análise (fase 7C): fluxo, previsibilidade e torneira vazando.
 * Ver docs/10-financeiro.md
 *
 * Tudo é conta sobre o que FOI importado. A tela diz isso em vez de fingir
 * completude — o erro mais caro de um painel financeiro é o dono acreditar
 * que ele sabe de tudo.
 */

export const dynamic = 'force-dynamic';

const MESES_PADRAO = 12;

const TIPO_ROTULO: Record<string, string> = {
  aumentou: 'subiu de preço',
  duplicado: 'pagando duas vezes?',
  'sem-categoria': 'sem categoria',
};

export default async function PaginaAnalise({
  searchParams,
}: {
  searchParams: Promise<{ meses?: string }>;
}) {
  const params = await searchParams;
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) {
    return (
      <main className="shell">
        <Nav atual="/financeiro/analise" />
        <h1>Análise</h1>
        <p className="vazio">Nenhuma conta conectada ainda.</p>
      </main>
    );
  }
  const tz = usuario.timezone || DEFAULT_TIMEZONE;
  const nMeses = [6, 12, 24].includes(Number(params.meses)) ? Number(params.meses) : MESES_PADRAO;
  const meses = ultimosMeses(new Date(), tz, nMeses);
  const desde = new Date(`${meses[0]}-01T00:00:00Z`);

  const [linhas, totalLancamentos, semCategoria] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { userId: usuario.id, postedAt: { gte: desde } },
      select: {
        postedAt: true,
        amountCents: true,
        category: true,
        business: true,
        normalized: true,
        description: true,
        accountId: true,
        account: { select: { label: true } },
      },
    }),
    prisma.ledgerEntry.count({ where: { userId: usuario.id } }),
    prisma.ledgerEntry.count({ where: { userId: usuario.id, category: null } }),
  ]);

  const lancamentos: LancamentoAnalise[] = linhas.map((l) => ({
    postedAt: l.postedAt,
    amountCents: l.amountCents,
    category: l.category,
    business: l.business,
    normalized: l.normalized,
    description: l.description,
    accountId: l.accountId,
    accountLabel: l.account.label,
  }));

  const fluxo = fluxoMensal(lancamentos, tz, meses);
  const porNegocio = fluxoPorNegocio(lancamentos, tz, meses);
  const categorias = saidasPorCategoria(lancamentos);
  const rec = recorrentes(lancamentos, tz);
  const vazamentos = torneiras(rec);
  const prev = previsibilidade(fluxo, rec);

  const escalaNegocio = Math.max(
    1,
    ...porNegocio.flatMap((n) => n.meses.map((m) => Math.max(m.entradas, Math.abs(m.saidas)))),
  );
  const custoTorneiras = vazamentos.reduce((s, t) => s + t.custoMensal, 0);
  const celula = { padding: '8px 10px 8px 0', verticalAlign: 'top' as const, fontSize: 13 };

  if (totalLancamentos === 0) {
    return (
      <main className="shell">
        <Nav atual="/financeiro/analise" />
        <header className="topo">
          <div>
            <h1>Análise</h1>
            <p className="sub">Fluxo, previsibilidade e o que está vazando.</p>
          </div>
        </header>
        <p className="vazio">
          Nada para analisar ainda. <a href="/financeiro/extrato">Importe um extrato →</a>
        </p>
      </main>
    );
  }

  return (
    <main className="shell">
      <Nav atual="/financeiro/analise" />
      <header className="topo">
        <div>
          <h1>Análise</h1>
          <p className="sub">
            Fluxo, previsibilidade e o que está vazando — últimos {nMeses} meses.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[6, 12, 24].map((n) => (
            <a
              key={n}
              href={`/financeiro/analise?meses=${n}`}
              className="pill"
              style={{ textDecoration: 'none', fontWeight: n === nMeses ? 600 : 400, color: n === nMeses ? 'var(--text)' : 'var(--muted)' }}
            >
              {n}m
            </a>
          ))}
        </div>
      </header>

      <div className="aviso" style={{ marginBottom: 16 }}>
        <p>
          <strong>Isto são contas sobre o que você importou</strong>, não sobre suas finanças
          inteiras. Conta que não entrou no app não aparece aqui, e transferência entre contas suas
          é excluída dos totais para não contar o mesmo dinheiro duas vezes.
        </p>
        {semCategoria > 0 && (
          <p className="sub">
            {semCategoria} lançamento(s) ainda sem categoria — a análise por categoria fica
            incompleta até classificá-los. <a href="/financeiro/extrato">Categorizar →</a>
          </p>
        )}
      </div>

      <div className="grid" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>Entra por mês</h2>
          <div className="metric">{formatarValor(prev.mediaEntradas)}</div>
          <div className="metric-label">média dos meses com movimento</div>
        </section>
        <section className="card">
          <h2>Sai por mês</h2>
          <div className="metric">{formatarValor(prev.mediaSaidas)}</div>
          <div className="metric-label">
            {prev.cobertura > 0 ? `entradas cobrem ${prev.cobertura.toFixed(2)}× as saídas` : 'sem saídas no período'}
          </div>
        </section>
        <section className="card">
          <h2>Receita previsível</h2>
          <div className="metric">{Math.round(prev.fracaoRecorrente * 100)}%</div>
          <div className="metric-label">
            {formatarValor(prev.recorrenteEntradas)} recorrente de {formatarValor(prev.mediaEntradas)}
          </div>
        </section>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Fluxo mês a mês</h2>
        <GraficoFluxo meses={fluxo} />
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Torneira vazando</h2>
        <p className="sub" style={{ fontSize: 12, marginBottom: 10 }}>
          O que sai todo mês e merece um olhar. Não é acusação — é a lista do que vale conferir.
          {custoTorneiras > 0 && (
            <>
              {' '}
              Somadas, custam <strong>{formatarValor(-custoTorneiras)}</strong> por mês.
            </>
          )}
        </p>
        {vazamentos.length === 0 ? (
          <p className="vazio">
            Nada sinalizado. {rec.length === 0 ? 'Ainda não há três meses de dados para achar recorrência.' : `${rec.length} recorrente(s) encontrado(s), nenhum fora do padrão.`}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 12 }}>
                  <th style={celula}>o quê</th>
                  <th style={celula}>por quê</th>
                  <th style={celula}>habitual</th>
                  <th style={{ ...celula, textAlign: 'right' }}>por mês</th>
                </tr>
              </thead>
              <tbody>
                {vazamentos.slice(0, 20).map((t) => (
                  <tr key={`${t.tipo}-${t.recorrente.chave}`} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={celula}>
                      {t.recorrente.exemplo}
                      <br />
                      <span className="sub" style={{ fontSize: 11 }}>
                        {t.recorrente.categoria ?? 'sem categoria'} · {t.recorrente.meses} meses ·{' '}
                        {t.recorrente.contas.join(', ')}
                      </span>
                    </td>
                    <td style={celula}>
                      <span className={`pill ${t.tipo === 'aumentou' ? 'crit' : 'warn'}`}>{TIPO_ROTULO[t.tipo]}</span>
                      <br />
                      <span className="sub" style={{ fontSize: 11 }}>{t.motivo}</span>
                    </td>
                    <td style={{ ...celula, fontVariantNumeric: 'tabular-nums' }} className="sub">
                      {formatarValor(t.recorrente.mediana)}
                    </td>
                    <td style={{ ...celula, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      <strong>{formatarValor(-t.custoMensal)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid" style={{ marginBottom: 16, gridTemplateColumns: '1fr' }}>
        <section className="card">
          <h2>Em que o dinheiro sai</h2>
          {categorias.length === 0 ? (
            <p className="vazio">Nenhuma saída no período.</p>
          ) : (
            <GraficoCategorias categorias={categorias} />
          )}
        </section>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Por negócio</h2>
        <p className="sub" style={{ fontSize: 12, marginBottom: 10 }}>
          Mesma escala entre os gráficos, para comparar de verdade.
        </p>
        <Legenda itens={[{ cor: '#1b6ea8', rotulo: 'entradas' }, { cor: '#a93a24', rotulo: 'saídas' }]} />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 12 }}>
                <th style={celula}>negócio</th>
                <th style={celula}>{nMeses} meses</th>
                <th style={{ ...celula, textAlign: 'right' }}>entrou</th>
                <th style={{ ...celula, textAlign: 'right' }}>saiu</th>
                <th style={{ ...celula, textAlign: 'right' }}>líquido</th>
              </tr>
            </thead>
            <tbody>
              {porNegocio.map((n) => (
                <tr key={n.negocio} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={celula}>{n.negocio}</td>
                  <td style={{ ...celula, paddingRight: 16 }}>
                    <MiniFluxo meses={n.meses} escala={escalaNegocio} />
                  </td>
                  <td style={{ ...celula, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatarValor(n.totalEntradas)}
                  </td>
                  <td style={{ ...celula, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatarValor(n.totalSaidas)}
                  </td>
                  <td style={{ ...celula, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <strong>{formatarValor(n.totalEntradas + n.totalSaidas)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Recorrentes</h2>
        <p className="sub" style={{ fontSize: 12, marginBottom: 10 }}>
          Apareceram em três meses ou mais. É o que dá para prever do mês que vem.
        </p>
        {rec.length === 0 ? (
          <p className="vazio">Nada recorrente ainda — são precisos três meses de extrato.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 12 }}>
                  <th style={celula}>o quê</th>
                  <th style={celula}>meses</th>
                  <th style={{ ...celula, textAlign: 'right' }}>habitual/mês</th>
                  <th style={{ ...celula, textAlign: 'right' }}>
                    último ({rec[0]?.ultimoMes ?? ''})
                  </th>
                </tr>
              </thead>
              <tbody>
                {rec.slice(0, 30).map((r) => (
                  <tr key={`${r.saida ? 's' : 'e'}-${r.chave}`} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={celula}>
                      {r.exemplo}
                      <br />
                      <span className="sub" style={{ fontSize: 11 }}>
                        {r.categoria ?? 'sem categoria'}
                        {r.negocios.length > 0 ? ` · ${r.negocios.join(', ')}` : ''}
                      </span>
                    </td>
                    <td style={celula} className="sub">
                      {r.meses}
                    </td>
                    <td style={{ ...celula, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatarValor(r.mediana)}
                    </td>
                    <td style={{ ...celula, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatarValor(r.ultimo)}
                      {Math.abs(r.variacao) > 0.05 && (
                        <>
                          <br />
                          <span className="sub" style={{ fontSize: 11, color: r.variacao > 0 && r.saida ? 'var(--crit)' : 'var(--muted)' }}>
                            {r.variacao > 0 ? '+' : ''}
                            {Math.round(r.variacao * 100)}%
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="sub" style={{ fontSize: 11, marginTop: 12 }}>
        Período analisado a partir de {formatInZone(desde, tz, { day: '2-digit', month: '2-digit', year: 'numeric' })}.
      </p>
    </main>
  );
}
