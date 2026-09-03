import { prisma } from '@/lib/db';
import { Nav } from '../../nav';
import { IconeConflito, IconeRelogio, IconeSaude } from '../../icons';
import { DEFAULT_TIMEZONE, formatDateTime } from '@/core/time/zone';
import {
  formatarDuracao,
  MINIMO_PARA_P95,
  VOLTAS_ESPERADAS_POR_DIA,
  type Resumo,
} from '@/core/metrics/saude';
import { carregarSaude, PERIODOS, periodoValido } from '@/core/metrics/saude-dados';

/**
 * Painel de saúde do sync. Ver docs/13-saude.md
 *
 * A pergunta que esta tela responde é uma só: **por que a caixa está
 * desatualizada?** A Torre já diz "sync há 22h (agenda)"; aqui está o
 * histórico que explica as 22 horas — e por que foi a agenda.
 */

export const dynamic = 'force-dynamic';

const RECURSO: Record<string, string> = { MAIL: 'e-mail', CALENDAR: 'agenda', CONTACTS: 'contatos' };

/** `2026-08-31` → `31/08`. O resto da tela fala assim; o aviso também deve. */
function diaBr(iso: string): string {
  return `${iso.slice(8)}/${iso.slice(5, 7)}`;
}

const ESTADO: Record<string, { classe: string; texto: string }> = {
  IDLE: { classe: 'ok', texto: 'em dia' },
  RUNNING: { classe: 'warn', texto: 'rodando' },
  BACKOFF: { classe: 'warn', texto: 'recuando' },
  CURSOR_EXPIRED: { classe: 'warn', texto: 'cursor expirado' },
  FAILED: { classe: 'crit', texto: 'falhando' },
};

function taxa(r: Pick<Resumo, 'total' | 'sucesso' | 'parcial'>): number | undefined {
  // Sem corrida nenhuma não existe taxa. "0%" seria uma acusação falsa, e
  // "100%" um elogio falso — as duas mentiras que um denominador zero conta.
  if (r.total === 0) return undefined;
  return Math.round(((r.sucesso + r.parcial) / r.total) * 100);
}

function Percentual({ valor }: { valor: number | undefined }) {
  if (valor === undefined) return <span className="sub">sem corridas</span>;
  const classe = valor >= 95 ? 'ok' : valor >= 80 ? 'warn' : 'crit';
  return <span className={`pill ${classe}`}>{valor}%</span>;
}

/** Uma linha de resumo, usada para provedor e para conta × recurso. */
function LinhaResumo({ r, tz }: { r: Resumo; tz: string }) {
  return (
    <div className="linha alto">
      {/* `solto`: cortar com reticencias esconderia justamente a mensagem
          de erro, que e a unica coisa que esta linha existe para dizer. */}
      <span className="titulo-item solto">
        {r.rotulo}
        <br />
        <span className="sub">
          {r.total} corrida{r.total === 1 ? '' : 's'} · mediana {formatarDuracao(r.p50Ms)}
          {r.p95Ms !== undefined && ` · p95 ${formatarDuracao(r.p95Ms)}`}
          {r.itens > 0 && ` · ${r.itens} itens`}
          {r.orfas > 0 && (
            <>
              {' · '}
              <strong style={{ color: 'var(--crit)' }}>
                {r.orfas} {r.orfas === 1 ? 'morreu' : 'morreram'} no meio
              </strong>
            </>
          )}
          {r.ultimoErro && (
            <>
              <br />
              <span style={{ color: 'var(--crit)' }}>
                {formatDateTime(r.ultimoErro.quando, tz)} — {r.ultimoErro.mensagem.slice(0, 140)}
              </span>
            </>
          )}
        </span>
      </span>
      <Percentual valor={taxa(r)} />
    </div>
  );
}

export default async function PaginaSaude({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const { dias } = await searchParams;
  const periodo = periodoValido(dias);
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  const tz = usuario?.timezone || DEFAULT_TIMEZONE;
  const dados = await carregarSaude(periodo);

  const t = dados.total;
  const taxaGeral = taxa(t);
  const vencidos = dados.estados.filter((e) => e.vencido).length;
  const falhando = dados.estados.filter((e) => e.failureCount > 0);

  return (
    <div className="shell">
      <Nav atual="/conexoes/saude" />

      <header className="topo">
        <div>
          <h1>Saúde do sync</h1>
          <p className="sub">
            Por que uma caixa está desatualizada — com o histórico que a Torre não cabe mostrar.
          </p>
        </div>
        <nav className="subnav" aria-label="Período">
          {PERIODOS.map((d) => (
            <a
              key={d}
              href={`/conexoes/saude?dias=${d}`}
              className={periodo === d ? 'ativo' : undefined}
            >
              {d === 1 ? '24 horas' : `${d} dias`}
            </a>
          ))}
        </nav>
      </header>

      {dados.semConexoes ? (
        <p className="vazio">
          <strong>Nenhuma conta conectada.</strong> <a href="/conexoes">Conectar uma caixa →</a>
        </p>
      ) : (
        <>
          {/* As três coisas que só um histórico revela, antes de qualquer
              número bonito: corrida que morreu no meio, dia em que o
              agendamento não rodou, e recurso preso em falha. */}
          {t.orfas > 0 && (
            <div className="aviso">
              <p>
                <strong>
                  {t.orfas === 1 ? '1 corrida nunca terminou' : `${t.orfas} corridas nunca terminaram`}
                </strong>{' '}
                no período. Uma corrida é fechada até quando falha; ficar aberta significa que o
                processo <strong>morreu no meio</strong> — quase sempre por estouro de tempo da
                função.
              </p>
              <p className="sub">
                Não é perda de dado: o cursor só avança ao terminar, então a volta seguinte refaz o
                trecho. É perda de tempo, e o sinal de que o ciclo está pegando trabalho demais por
                execução.
              </p>
            </div>
          )}

          {dados.diasSemVolta.length > 0 && (
            <div className="aviso">
              <p>
                <strong>
                  {dados.diasSemVolta.length === 1
                    ? '1 dia sem nenhuma volta'
                    : `${dados.diasSemVolta.length} dias sem nenhuma volta`}
                </strong>{' '}
                — {dados.diasSemVolta.map(diaBr).join(', ')}.
              </p>
              <p className="sub">
                O agendamento roda 3× por dia pelo GitHub Actions. Um dia em branco não aparece em
                média nenhuma, porque não gerou linha para entrar na média: por isso é contado
                separado.
              </p>
            </div>
          )}

          <div className="grid">
            <section className={`card ${taxaGeral !== undefined && taxaGeral < 80 ? 'alerta' : 'destaque'}`}>
              <h2>
                <IconeSaude size={13} /> Corridas com sucesso
              </h2>
              <div
                className="metric"
                style={{ color: taxaGeral !== undefined && taxaGeral < 80 ? 'var(--crit)' : undefined }}
              >
                {taxaGeral === undefined ? '—' : `${taxaGeral}%`}
              </div>
              <div className="metric-label">
                {t.total === 0
                  ? `nenhuma corrida em ${periodo === 1 ? '24h' : `${periodo} dias`}`
                  : `${t.total} corridas · ${t.falha} falha${t.falha === 1 ? '' : 's'}${
                      t.orfas > 0 ? ` · ${t.orfas} sem fim` : ''
                    }`}
              </div>
            </section>

            <section className="card">
              <h2>
                <IconeRelogio size={13} /> Duração de uma corrida
              </h2>
              <div className="metric">
                {formatarDuracao(dados.porProvedor.length > 0 ? maiorMediana(dados.porProvedor) : undefined)}
              </div>
              <div className="metric-label">
                {/* Nomear direito: o relógio cobre buscar E gravar. Chamar
                    isto de "latência do Google" culparia o provedor pelo
                    nosso persist. */}
                pior mediana entre os provedores · buscar + gravar, não só a chamada
              </div>
            </section>

            {/* Sem cor de alerta: com 3 voltas por dia, ter recursos
                vencidos ENTRE dois ciclos é o estado normal, não um
                problema. Quem responde "o agendamento está rodando?" é o
                cartão de voltas por dia — pintar este de âmbar seria um
                alarme aceso o tempo todo. */}
            <section className="card">
              <h2>
                <IconeConflito size={13} /> Esperando a vez
              </h2>
              <div className="metric">{vencidos}</div>
              <div className="metric-label">
                {vencidos === 0
                  ? 'nada na fila: a última volta pegou tudo'
                  : `de ${dados.estados.length} recursos, prontos para a próxima volta`}
              </div>
            </section>
          </div>

          <div className="grid" style={{ marginTop: 16 }}>
            <section className="card">
              <h2>Por provedor</h2>
              {dados.porProvedor.length === 0 ? (
                <p className="vazio">Nenhuma corrida no período.</p>
              ) : (
                dados.porProvedor.map((r) => <LinhaResumo key={r.chave} r={r} tz={tz} />)
              )}
              {t.amostraDuracao < MINIMO_PARA_P95 && t.amostraDuracao > 0 && (
                <p className="sub" style={{ marginTop: 10 }}>
                  p95 só aparece a partir de {MINIMO_PARA_P95} corridas medidas (há{' '}
                  {t.amostraDuracao}). Abaixo disso ele é ruído com cara de medida.
                </p>
              )}
            </section>

            <section className="card">
              <h2>Voltas por dia</h2>
              {dados.ciclos.length === 0 ? (
                <p className="vazio">Nenhuma volta no período.</p>
              ) : (
                dados.ciclos
                  .slice()
                  .reverse()
                  .map((d) => {
                    const completo = d.ciclos >= VOLTAS_ESPERADAS_POR_DIA;
                    // O dia corrente ainda está acontecendo: cobrar 3 dele
                    // seria acusar de atraso toda manhã.
                    const pill = d.parcial
                      ? { classe: '', texto: `${d.hoje ? 'hoje' : 'parcial'} · ${d.ciclos}` }
                      : d.ciclos === 0
                        ? { classe: 'crit', texto: 'nenhuma' }
                        : { classe: completo ? 'ok' : 'warn', texto: `${d.ciclos} de ${VOLTAS_ESPERADAS_POR_DIA}` };
                    return (
                      <div key={d.dia} className="linha">
                        <span className="hora">
                          {diaBr(d.dia)}
                        </span>
                        <span className="titulo-item">
                          <span
                            aria-hidden
                            style={{
                              display: 'inline-block',
                              height: 8,
                              // Zero também precisa OCUPAR espaço: uma barra
                              // de largura nenhuma some, e some justamente o
                              // dia que este cartão existe para mostrar.
                              width: d.ciclos === 0 ? '26px' : `${Math.min(d.ciclos, 6) * 26}px`,
                              background:
                                d.ciclos === 0
                                  ? 'repeating-linear-gradient(45deg, var(--crit-claro) 0 4px, transparent 4px 8px)'
                                  : d.parcial
                                    ? 'var(--border-forte)'
                                    : completo
                                      ? 'var(--meridiano)'
                                      : 'var(--zenite)',
                              border: d.ciclos === 0 ? '1px solid var(--crit)' : undefined,
                              borderRadius: 2,
                              verticalAlign: 'middle',
                            }}
                          />
                        </span>
                        <span className={`pill ${pill.classe}`}>{pill.texto}</span>
                      </div>
                    );
                  })
              )}
            </section>
          </div>

          <div className="grid" style={{ marginTop: 16 }}>
            <section className="card">
              <h2>Por caixa e recurso</h2>
              {dados.porRecurso.length === 0 ? (
                <p className="vazio">Nenhuma corrida no período.</p>
              ) : (
                dados.porRecurso.map((r) => <LinhaResumo key={r.chave} r={r} tz={tz} />)
              )}
            </section>

            <section className={`card ${falhando.length > 0 ? 'alerta' : ''}`}>
              <h2>Estado agora</h2>
              {dados.estados.length === 0 ? (
                <p className="vazio">Nenhum recurso registrado ainda.</p>
              ) : (
                dados.estados.map((e) => {
                  // "em dia" ao lado de "vencido" seria a tela se
                  // contradizendo: IDLE + vencido não é em dia, é esperando
                  // a próxima volta.
                  const pill = e.foraDaFila
                    ? { classe: 'crit', texto: 'fora da fila' }
                    : e.status === 'IDLE' && e.vencido
                      ? { classe: 'warn', texto: 'na fila' }
                      : (ESTADO[e.status] ?? { classe: 'warn', texto: e.status.toLowerCase() });
                  return (
                    <div key={`${e.connectionId}:${e.resource}`} className="linha alto">
                      <span className="titulo-item solto">
                        {e.conta} · {RECURSO[e.resource] ?? e.resource}
                        <br />
                        <span className="sub">
                          {e.lastSyncAt ? `último ${formatDateTime(e.lastSyncAt, tz)}` : 'nunca sincronizou'}
                          {e.failureCount > 0 && (
                            <strong style={{ color: 'var(--crit)' }}>
                              {' · '}
                              {e.failureCount} falha{e.failureCount === 1 ? '' : 's'} seguida
                              {e.failureCount === 1 ? '' : 's'}
                            </strong>
                          )}
                          {/* Sem cursor a próxima volta é full sync: mais
                              cara e mais lenta. Vale dizer antes de alguém
                              se assustar com a duração. */}
                          {!e.temCursor && ' · próxima é completa'}
                        </span>
                      </span>
                      <span className={`pill ${pill.classe}`}>{pill.texto}</span>
                    </div>
                  );
                })
              )}
            </section>
          </div>

          {dados.alertas.length > 0 && (
            <div className="grid" style={{ marginTop: 16 }}>
              <section className="card alerta">
                <h2>Alarmes abertos</h2>
                {dados.alertas.map((a) => (
                  <div key={a.id} className="linha alto">
                    <span className="titulo-item solto">
                      {a.title}
                      <br />
                      <span className="sub">
                        {formatDateTime(a.createdAt, tz)} · {a.kind}
                        {a.detail && ` — ${a.detail}`}
                      </span>
                    </span>
                    <span className={`pill ${a.severity === 'CRITICAL' ? 'crit' : 'warn'}`}>
                      {a.severity === 'CRITICAL' ? 'crítico' : a.severity === 'WARN' ? 'atenção' : 'aviso'}
                    </span>
                  </div>
                ))}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A PIOR mediana entre os provedores, não a média das medianas.
 *
 * Média de percentil não é percentil, e a média esconderia justamente o
 * provedor lento atrás dos rápidos — que é a única coisa que essa métrica
 * serve para achar.
 */
function maiorMediana(resumos: Resumo[]): number | undefined {
  const valores = resumos.map((r) => r.p50Ms).filter((v): v is number => v !== undefined);
  return valores.length > 0 ? Math.max(...valores) : undefined;
}
