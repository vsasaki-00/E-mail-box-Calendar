import { prisma } from '@/lib/db';
import { DEFAULT_TIMEZONE, formatDateTime } from '@/core/time/zone';

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
          select: { status: true, lastSyncAt: true, failureCount: true, pageToken: true },
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

  return (
    <section className="card" style={{ borderLeft: '3px solid var(--zenite)' }}>
      <h2>Por que a agenda está vazia</h2>

      {totalEventos > 0 ? (
        <p className="sub" style={{ marginBottom: 10 }}>
          Existem <strong>{totalEventos} eventos</strong> guardados, entre{' '}
          {extremos._min.startsAt ? formatDateTime(extremos._min.startsAt, timeZone) : '—'} e{' '}
          {extremos._max.startsAt ? formatDateTime(extremos._max.startsAt, timeZone) : '—'}. Se
          nada aparece aqui, eles estão fora do período que esta tela mostra — navegue até essas
          datas.
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
                : !estado.lastSyncAt
                  ? 'nunca rodou'
                  : c._count.calendarSources === 0
                    ? 'rodou, mas não achou calendário na conta'
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
        <a href="/conexoes">Conexões</a>. &quot;em andamento&quot; → clique em Sincronizar mais
        vezes; cada volta traz um pedaço.
      </p>
    </section>
  );
}
