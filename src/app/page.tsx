import { prisma } from '@/lib/db';
import { AlertaLinha } from './alerta-linha';
import { loadControlTower, type ControlTowerData } from '@/core/metrics/control-tower';
import { DEFAULT_TIMEZONE, formatDateTime, formatTime } from '@/core/time/zone';
import { descreverIdade, nomeDoRecurso } from '@/core/metrics/estado-conexao';
import { Nav } from './nav';
import {
  IconeBussola,
  IconeCalendario,
  IconeConexoes,
  IconeConflito,
  IconeDinheiro,
  IconeRascunho,
  IconeRelogio,
  IconeSaude,
} from './icons';

/**
 * Torre de Controle. Ver docs/05-torre-de-controle.md
 *
 * Le exclusivamente do cache local: a tela precisa abrir instantaneamente mesmo
 * com todas as contas fora do ar, mostrando o estado conhecido e a idade dele.
 */

export const dynamic = 'force-dynamic';

const PROVIDER_LABEL: Record<string, string> = {
  GOOGLE: 'Google',
  MICROSOFT: 'Microsoft',
  APPLE: 'Apple iCloud',
  IMAP_CALDAV: 'IMAP/CalDAV',
};

// Sempre com fuso explicito: o padrao e o do servidor. Ver core/time/zone.
function hora(date: Date, tz: string): string {
  return formatTime(date, tz);
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="vazio">{children}</p>;
}

function Painel({ dados, tz }: { dados: ControlTowerData; tz: string }) {
  const criticos = dados.conflicts.filter((c) => c.crossAccount);

  return (
    <>
      <div className="grid">
        <section
          className={`card ${dados.triage.urgent > 0 ? 'alerta' : 'destaque'}`}
        >
          <h2>
            <IconeBussola size={13} /> Precisam de resposta
          </h2>
          {dados.triage.needsReply === 0 && dados.triage.pending > 0 ? (
            <>
              {/* Nao dizer "0 precisam de resposta" quando ninguem analisou
                  ainda — seria a mentira mais facil deste painel. */}
              <div className="metric">—</div>
              <div className="metric-label">triagem ainda não executada</div>
            </>
          ) : (
            <>
              <div
                className="metric"
                style={{ color: dados.triage.urgent > 0 ? 'var(--crit)' : undefined }}
              >
                {dados.triage.needsReply}
              </div>
              <div className="metric-label">
                {dados.triage.urgent > 0
                  ? `${dados.triage.urgent} urgente${dados.triage.urgent > 1 ? 's' : ''}`
                  : `de ${dados.backlog.totalUnread} não lidos`}
              </div>
            </>
          )}
          {dados.triage.pending > 0 && (
            <p className="sub" style={{ marginTop: 10 }}>
              {dados.triage.pending} ainda sem triagem.
            </p>
          )}
          {dados.triage.lowConfidence > 0 && (
            <p className="sub" style={{ marginTop: 4 }}>
              {dados.triage.lowConfidence} com baixa confiança — revise.
            </p>
          )}
          {dados.backlog.oldestUnreadHours !== null && (
            <p className="sub" style={{ marginTop: 4 }}>
              O não lido mais antigo espera há <strong>{dados.backlog.oldestUnreadHours}h</strong>.
            </p>
          )}
        </section>

        <section className={`card ${dados.bills.overdue > 0 ? 'alerta' : ''}`}>
          <h2>
            <IconeDinheiro size={13} />
            <a href="/financeiro">Cobranças a pagar</a>
          </h2>
          <div
            className="metric"
            style={{ color: dados.bills.overdue > 0 ? 'var(--crit)' : undefined }}
          >
            {dados.bills.open > 0
              ? (dados.bills.totalOpenCents / 100).toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })
              : dados.triage.cobrancas > 0
                ? '—'
                : 'R$ 0,00'}
          </div>
          <div className="metric-label">
            {dados.bills.open > 0
              ? `${dados.bills.open} em aberto${dados.bills.overdue > 0 ? `, ${dados.bills.overdue} vencida${dados.bills.overdue > 1 ? 's' : ''}` : ''}`
              : dados.triage.cobrancas > 0
                ? `${dados.triage.cobrancas} detectada${dados.triage.cobrancas > 1 ? 's' : ''}, nenhuma extraída ainda`
                : 'nenhuma detectada'}
          </div>
          {dados.bills.withoutAmount > 0 && (
            <p className="sub" style={{ marginTop: 8 }}>
              {/* O total nao pode engolir o que nao foi identificado. */}
              {dados.bills.withoutAmount} sem valor identificado —{' '}
              <strong>não estão nesse total</strong>.
            </p>
          )}
          {dados.bills.dueSoon > 0 && (
            <p className="sub" style={{ marginTop: 4 }}>
              {dados.bills.dueSoon} vencendo nos próximos 3 dias.
            </p>
          )}
          <p className="sub" style={{ marginTop: 10 }}>
            Detecção automática a partir dos e-mails — <strong>não é garantia</strong> de que
            todas as cobranças foram encontradas.
          </p>
        </section>

        <section className="card">
          <h2>
            <IconeCalendario size={13} />
            <a href="/agenda">Agenda de hoje</a>
          </h2>
          <div className="metric">{dados.timeline.length}</div>
          <div className="metric-label">compromissos somando todas as contas</div>
          {dados.focusWindows.length > 0 && (
            <p className="sub" style={{ marginTop: 10 }}>
              {dados.focusWindows.length}{' '}
              {dados.focusWindows.length === 1 ? 'janela livre' : 'janelas livres'} de 90min+ no
              expediente.
            </p>
          )}
        </section>

        <section className={`card ${criticos.length > 0 ? 'alerta' : ''}`}>
          <h2>
            <IconeConflito size={13} /> Conflitos
          </h2>
          <div className="metric" style={{ color: criticos.length ? 'var(--crit)' : undefined }}>
            {dados.conflicts.length}
          </div>
          <div className="metric-label">
            {criticos.length > 0
              ? `${criticos.length} entre contas diferentes`
              : 'nenhuma sobreposição entre contas'}
          </div>
        </section>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>
            <IconeSaude size={13} />
            <a href="/conexoes/saude">Saúde das conexões</a>
          </h2>
          {dados.connections.length === 0 ? (
            <Vazio>Nenhuma conta conectada ainda.</Vazio>
          ) : (
            dados.connections.map((conexao) => (
              <div key={conexao.id} className="linha">
                <span className="ponto" style={{ background: conexao.color }} />
                <span className="titulo-item">
                  {conexao.accountEmail}
                  <br />
                  <span className="sub">
                    {PROVIDER_LABEL[conexao.provider] ?? conexao.provider}
                    {conexao.minutesSinceSync === null
                      ? ' · nunca sincronizou'
                      : ` · sync ${descreverIdade(conexao.minutesSinceSync)}`}
                    {/* Dizer QUAL parte está atrás: "sync há 40h" numa conta
                        cujo e-mail chegou agora parece erro do painel até
                        você ler que quem está parada é a agenda. */}
                    {conexao.recursoAtrasado && conexao.isStale
                      ? ` (${nomeDoRecurso(conexao.recursoAtrasado)})`
                      : ''}
                  </span>
                </span>
                <span className={`pill ${conexao.rotulo.classe}`}>{conexao.rotulo.texto}</span>
              </div>
            ))
          )}
        </section>

        <section className="card">
          <h2>
            <IconeCalendario size={13} /> Linha do dia
          </h2>
          {dados.timeline.length === 0 ? (
            <Vazio>Nenhum compromisso hoje.</Vazio>
          ) : (
            dados.timeline.map((evento) => (
              <div key={evento.id} className="linha">
                <span className="hora">
                  {evento.isAllDay ? 'dia' : `${hora(evento.startsAt, tz)}–${hora(evento.endsAt, tz)}`}
                </span>
                <span className="titulo-item">
                  {evento.title}
                  <br />
                  <span className="sub">
                    {evento.accounts.map((conta) => conta.label).join(' + ')}
                    {evento.accounts.length > 1 && ` (${evento.accounts.length} caixas)`}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 3, flex: 'none' }}>
                  {evento.accounts.map((conta) => (
                    <span key={conta.label} className="ponto" style={{ background: conta.color }} />
                  ))}
                </span>
              </div>
            ))
          )}
        </section>

        <section className="card">
          <h2>
            <IconeRelogio size={13} />
            <a href="/rascunhos">Prazo de resposta</a>
          </h2>
          {(() => {
            const atrasadas = dados.sla.filter((caixa) => caixa.overdue > 0);
            const totalAtrasado = atrasadas.reduce((soma, c) => soma + c.overdue, 0);
            const esperando = dados.sla.reduce((soma, c) => soma + c.waiting, 0);

            return (
              <>
                <div
                  className="metric"
                  style={{ color: totalAtrasado > 0 ? 'var(--crit)' : undefined }}
                >
                  {totalAtrasado}
                </div>
                <div className="metric-label">
                  {/* "47 nao lidos" nao mede nada: metade e newsletter. O que
                      mede e quem esta esperando VOCE, e ha quanto tempo. */}
                  {totalAtrasado === 0
                    ? esperando > 0
                      ? `${esperando} esperando, todas dentro do prazo`
                      : 'ninguém esperando resposta'
                    : `passaram do prazo, de ${esperando} esperando`}
                </div>
                {atrasadas.map((caixa) => (
                  <p key={caixa.connectionId} className="sub" style={{ marginTop: 6 }}>
                    <strong>{caixa.label}</strong>: {caixa.overdue} passou do prazo de{' '}
                    {caixa.slaHours}h
                    {caixa.oldestHours !== null && ` · o mais antigo espera há ${caixa.oldestHours}h`}
                  </p>
                ))}
                {dados.overdueItems.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    {dados.overdueItems.slice(0, 3).map((item) => (
                      <div key={item.unifiedItemId} className="linha">
                        <span className={`pill ${item.overdue ? 'crit' : 'warn'}`}>
                          {item.hours}h
                        </span>
                        <span className="titulo-item">
                          {item.title}
                          <br />
                          <span className="sub">{item.fromLabel}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </section>

        <section className="card">
          <h2>
            <IconeRascunho size={13} />
            <a href="/rascunhos">Rascunhos</a>
          </h2>
          <div className="metric">{dados.drafts.proposed}</div>
          <div className="metric-label">
            {dados.drafts.proposed === 0 ? 'nenhum esperando você' : 'esperando você olhar'}
          </div>
          {(dados.drafts.approved > 0 || dados.drafts.edited > 0) && (
            <p className="sub" style={{ marginTop: 8 }}>
              {dados.drafts.approved} aprovado{dados.drafts.approved === 1 ? '' : 's'},{' '}
              {dados.drafts.edited} editado{dados.drafts.edited === 1 ? '' : 's'} por você.
            </p>
          )}
          <p className="sub" style={{ marginTop: 8 }}>
            {/* A frase mais importante desta tela. */}
            <strong>Nenhum rascunho é enviado</strong> — o sistema não envia e-mail.
          </p>
        </section>

        <section className="card">
          <h2>
            <IconeConflito size={13} /> Conflitos e alertas
          </h2>
          {dados.conflicts.length === 0 && dados.alerts.length === 0 ? (
            <Vazio>Nada exigindo atencao.</Vazio>
          ) : (
            <>
              {dados.conflicts.map((conflito) => (
                <div key={`${conflito.a.id}-${conflito.b.id}`} className="linha">
                  <span className={`pill ${conflito.crossAccount ? 'crit' : 'warn'}`}>
                    {conflito.overlapMinutes}min
                  </span>
                  <span className="titulo-item">
                    {conflito.a.title} × {conflito.b.title}
                    <br />
                    <span className="sub">
                      {conflito.crossAccount
                        ? `${conflito.a.connectionLabel} vs ${conflito.b.connectionLabel}`
                        : conflito.a.connectionLabel}
                    </span>
                  </span>
                </div>
              ))}
              {dados.alerts.map((alerta) => (
                <AlertaLinha key={alerta.id} alerta={alerta} />
              ))}
            </>
          )}
        </section>
      </div>
    </>
  );
}

function SemBanco({ erro }: { erro: string }) {
  return (
    <div className="aviso">
      <p>
        <strong>Banco de dados indisponível.</strong> A Torre de Controle le do cache local, entao
        precisa do Postgres no ar.
      </p>
      <pre>
        {`cp .env.example .env
# gere a chave mestra e cole em MASTER_ENCRYPTION_KEY:
openssl rand -base64 32

pnpm db:up      # sobe o Postgres via Docker
pnpm db:push    # aplica o schema
pnpm db:seed    # popula dados de demonstração`}
      </pre>
      <p className="sub">
        Detalhe tecnico: <code>{erro}</code>
      </p>
    </div>
  );
}

export default async function TorreDeControle() {
  let dados: ControlTowerData | null = null;
  let tz = DEFAULT_TIMEZONE;
  let erro: string | null = null;

  try {
    // Single-user na fase 1: o primeiro usuario e o dono. Ver docs/02.
    const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
    if (usuario) {
      dados = await loadControlTower(usuario.id);
      tz = usuario.timezone || DEFAULT_TIMEZONE;
    }
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="shell">
      <Nav
        atual="/"
        direita={dados ? `estado de ${formatDateTime(dados.generatedAt, tz)}` : undefined}
      />

      <header className="topo">
        <div>
          <h1>Torre de Comando</h1>
          <p className="sub">
            Todas as caixas e todos os calendários sob uma única linha de referência.
          </p>
        </div>
      </header>

      {erro && <SemBanco erro={erro} />}

      {!erro && !dados && (
        <div className="aviso">
          <p>
            <strong>Banco vazio.</strong> Rode <code>pnpm db:seed</code> para popular dados de
            demonstração e ver a tela funcionando.
          </p>
        </div>
      )}

      {dados && <Painel dados={dados} tz={tz} />}
    </main>
  );
}
