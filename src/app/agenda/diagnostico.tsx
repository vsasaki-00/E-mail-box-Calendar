import { prisma } from '@/lib/db';
import { DEFAULT_TIMEZONE, formatDateTime, formatInZone, isoDateInZone } from '@/core/time/zone';
import { lerJanelaDoCursor } from '@/lib/connectors/container-cursor';
import { assinaturaJanela, janelaCalendario } from '@/lib/connectors/janela-calendario';

/**
 * Por que a agenda está vazia.
 *
 * Uma agenda vazia tem várias causas possíveis, e a tela não distinguia
 * nenhuma: calendário que nunca sincronizou, calendário que sincronizou e
 * não achou nenhum calendário na conta, eventos gravados fora da janela que
 * está sendo mostrada, ou erro do provedor. Sem essa distinção, cada
 * tentativa de conserto é um palpite — e vários palpites custaram tempo
 * neste projeto.
 *
 * Só aparece quando não há evento nenhum na visão atual. Com a agenda
 * cheia, ele some.
 */

/**
 * Data COM ano.
 *
 * O formato curto do resto do app omite o ano, e num intervalo isso vira
 * absurdo: "entre 16/11 e 26/08" parece erro de leitura quando na verdade
 * são anos diferentes. Aqui o ano é a informação que importa.
 */
function comAno(instante: Date, timeZone: string): string {
  return formatInZone(instante, timeZone, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export async function DiagnosticoAgendaVazia({
  userId,
  timeZone = DEFAULT_TIMEZONE,
}: {
  userId: string;
  timeZone?: string;
}) {
  const [conexoes, totalEventos, extremos] = await Promise.all([
    prisma.connection.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        accountEmail: true,
        provider: true,
        lastErrorMessage: true,
        _count: { select: { calendarSources: true, events: true } },
        syncStates: {
          where: { resource: 'CALENDAR' },
          select: {
            status: true,
            lastSyncAt: true,
            failureCount: true,
            pageToken: true,
            // A janela em vigor viaja DENTRO do cursor: e a unica forma de
            // ver que uma conta ainda busca no periodo antigo.
            cursor: true,
          },
        },
      },
    }),
    prisma.calendarEvent.count({ where: { connection: { userId } } }),
    prisma.calendarEvent.aggregate({
      where: { connection: { userId } },
      _min: { startsAt: true },
      _max: { startsAt: true },
    }),
  ]);

  const assinatura = assinaturaJanela();
  const janela = janelaCalendario();

  return (
    <section className="card" style={{ borderLeft: '3px solid var(--zenite)' }}>
      <h2>Por que a agenda está vazia</h2>

      <p className="sub" style={{ marginBottom: 10, fontSize: 11 }}>
        Período buscado nos provedores: <strong>{comAno(janela.since, timeZone)}</strong> a{' '}
        <strong>{comAno(janela.until, timeZone)}</strong>. Nada fora disso é trazido — ajuste com{' '}
        <code>SYNC_CALENDAR_PAST_MONTHS</code> e <code>SYNC_CALENDAR_FUTURE_MONTHS</code>.
      </p>

      {totalEventos > 0 ? (
        <p className="sub" style={{ marginBottom: 10 }}>
          Existem <strong>{totalEventos} eventos</strong> guardados, de{' '}
          <strong>{extremos._min.startsAt ? comAno(extremos._min.startsAt, timeZone) : '—'}</strong>{' '}
          a{' '}
          <strong>{extremos._max.startsAt ? comAno(extremos._max.startsAt, timeZone) : '—'}</strong>.
          Se nada aparece aqui, eles estão fora do período que esta tela mostra.
          {extremos._max.startsAt && (
            <>
              {' '}
              {/* Levar ate la vale mais que instruir a navegar: com meses de
                  distancia, "navegue" e varios cliques as cegas. */}
              <a href={`/agenda?vista=mes&semana=${isoDateInZone(extremos._max.startsAt, timeZone)}`}>
                Ir para o mês do evento mais recente →
              </a>
            </>
          )}
        </p>
      ) : (
        <p className="sub" style={{ marginBottom: 10 }}>
          Nenhum evento foi gravado ainda. A tabela abaixo mostra em que ponto cada conta parou.
        </p>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
              <th style={{ padding: '4px 10px 4px 0' }}>conta</th>
              <th style={{ padding: '4px 10px' }}>último sync de agenda</th>
              <th style={{ padding: '4px 10px' }}>calendários</th>
              <th style={{ padding: '4px 10px' }}>eventos</th>
              <th style={{ padding: '4px 10px' }}>situação</th>
            </tr>
          </thead>
          <tbody>
            {conexoes.map((c) => {
              const estado = c.syncStates[0];
              // O diagnóstico é a diferença entre estes casos, que exigem
              // consertos completamente diferentes.
              const situacao = !estado
                ? 'sem registro de sync — reconecte a conta'
                : estado.status === 'RUNNING'
                  ? 'sincronizando agora — recarregue em instantes'
                  : !estado.lastSyncAt
                    ? // Sem lastSyncAt mas COM evento gravado: a execução
                      // escreveu e ainda não fechou. Dizer "nunca rodou" ali
                      // seria contradizer a coluna ao lado.
                      c._count.events > 0
                      ? 'sincronizando agora — recarregue em instantes'
                      : 'nunca rodou'
                    : c._count.calendarSources === 0
                      ? 'rodou, mas não achou calendário na conta'
                      : // O provedor grava a janela dentro do próprio
                        // cursor (syncToken do Google, deltaLink do Graph):
                        // enquanto o cursor for antigo, a conta continua
                        // buscando no período velho, por mais certa que a
                        // configuração esteja aqui.
                        lerJanelaDoCursor(estado.cursor ?? undefined) !== assinatura
                        ? 'período antigo no cursor — o próximo sync refaz a busca inteira'
                        : c._count.events === 0
                        ? 'achou calendário, não gravou evento'
                        : estado.pageToken
                          ? 'em andamento — sincronize de novo'
                          : 'ok';

              return (
                <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 10px 6px 0' }}>
                    {c.accountEmail}
                    <br />
                    <span className="sub" style={{ fontSize: 11 }}>{c.provider}</span>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    {estado?.lastSyncAt ? formatDateTime(estado.lastSyncAt, timeZone) : '—'}
                  </td>
                  <td style={{ padding: '6px 10px' }}>{c._count.calendarSources}</td>
                  <td style={{ padding: '6px 10px' }}>{c._count.events}</td>
                  <td style={{ padding: '6px 10px' }}>
                    {situacao}
                    {c.lastErrorMessage && (
                      <>
                        <br />
                        <span style={{ color: 'var(--crit)', fontSize: 11 }}>
                          {c.lastErrorMessage}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="sub" style={{ marginTop: 12, fontSize: 11 }}>
        &quot;nunca rodou&quot; ou erro de permissão → reconecte a conta em{' '}
        <a href="/conexoes">Conexões</a>. &quot;em andamento&quot; e &quot;período antigo no
        cursor&quot; → clique em Sincronizar mais vezes; cada volta traz um pedaço.
      </p>
    </section>
  );
}
