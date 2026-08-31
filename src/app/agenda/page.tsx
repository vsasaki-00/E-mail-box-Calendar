import { prisma } from '@/lib/db';
import { loadAgenda, loadMonth } from '@/core/agenda/load';
import { shiftMonths, shiftWeeks } from '@/core/agenda/week';
import { formatInZone, formatTime, isoDateInZone, zonedParts, zoneLabel } from '@/core/time/zone';
import { Nav } from '../nav';

/**
 * Agenda unificada por semana. Ver docs/05-torre-de-controle.md
 *
 * A promessa do produto em uma tela: o mesmo compromisso que existe em três
 * calendários aparece como UMA linha, com uma bolinha por conta — e o
 * choque entre contas diferentes, que nenhuma agenda sozinha mostra,
 * aparece marcado.
 */

export const dynamic = 'force-dynamic';

const DIA_SEMANA = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

// Formatacao SEMPRE com fuso explicito. Ver src/core/time/zone.ts — o
// padrao silencioso e o fuso do servidor, e ele nao e o seu.

/** Expediente usado pela barrinha de horario. */
const HORA_INICIO = 7;
const HORA_FIM = 22;

/**
 * Posicao do instante dentro do expediente, em porcentagem.
 *
 * Recortado em 0..100: um compromisso as 05:00 nao desenha barra fora do
 * quadro, ele encosta na borda.
 */
function faixaDoDia(instante: Date, tz: string): { left: number } {
  const p = zonedParts(instante, tz);
  const minutos = p.hour * 60 + p.minute;
  const inicio = HORA_INICIO * 60;
  const total = (HORA_FIM - HORA_INICIO) * 60;
  return { left: Math.min(100, Math.max(0, ((minutos - inicio) / total) * 100)) };
}

export default async function PaginaAgenda({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string; conta?: string; vista?: string; dia?: string }>;
}) {
  const params = await searchParams;
  const vista = params.vista === 'mes' ? 'mes' : 'semana';

  const referencia = params.semana ? new Date(`${params.semana}T12:00:00`) : new Date();
  const base = Number.isNaN(referencia.getTime()) ? new Date() : referencia;

  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) {
    return (
      <main className="shell">
      <Nav atual="/agenda" />
        <h1>Agenda</h1>
        <div className="aviso">
          <p>
            <strong>Nenhuma conta conectada.</strong> <a href="/conexoes">Conectar uma caixa →</a>
          </p>
        </div>
      </main>
    );
  }

  if (vista === 'mes') return <VistaMes base={base} userId={usuario.id} conta={params.conta} />;

  const dados = await loadAgenda(usuario.id, base, params.conta || null);
  const tz = dados.timeZone;
  const conta = params.conta ? `&conta=${params.conta}` : '';
  const isoDia = (data: Date) => isoDateInZone(data, tz);

  const rotuloSemana = `${formatInZone(dados.weekStart, tz, {
    day: '2-digit',
    month: 'short',
  })} – ${formatInZone(new Date(dados.weekEnd.getTime() - 1), tz, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}`;

  return (
    <main className="shell">
      <Nav atual="/agenda" />
      <header className="topo">
        <div>
          <h1>Agenda</h1>
          <p className="sub">
            Todos os calendários em uma semana só. O mesmo compromisso em várias contas é{' '}
            <strong>uma linha</strong>, com uma bolinha por conta. Horários em{' '}
            <strong>{tz}</strong> ({zoneLabel(dados.weekStart, tz)}).
          </p>
        </div>
      </header>

      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 14,
        }}
      >
        <a href={`/agenda?semana=${isoDia(shiftWeeks(base, -1))}${conta}`} className="pill">
          ← semana anterior
        </a>
        <strong style={{ fontSize: 14 }}>{rotuloSemana}</strong>
        <a href={`/agenda?semana=${isoDia(shiftWeeks(base, 1))}${conta}`} className="pill">
          próxima semana →
        </a>
        <a href={`/agenda${params.conta ? `?conta=${params.conta}` : ''}`} className="pill">
          hoje
        </a>

        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <a href={`/agenda?semana=${isoDia(base)}${conta}`} className="pill" style={{ fontWeight: 600 }}>
            semana
          </a>
          <a href={`/agenda?vista=mes&semana=${isoDia(base)}${conta}`} className="pill">
            mês
          </a>
          <a
            href={`/agenda?semana=${isoDia(base)}`}
            className="pill"
            style={{ fontWeight: params.conta ? 400 : 600 }}
          >
            todas as contas
          </a>
          {dados.connections.map((c) => (
            <a
              key={c.id}
              href={`/agenda?semana=${isoDia(base)}&conta=${c.id}`}
              className="pill"
              style={{ fontWeight: params.conta === c.id ? 600 : 400 }}
            >
              <span className="ponto" style={{ background: c.color }} /> {c.label}
            </a>
          ))}
        </span>
      </div>

      <div className="grid" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>Compromissos</h2>
          <div className="metric">{dados.summary.total}</div>
          <div className="metric-label">distintos nesta semana</div>
          {dados.summary.collapsed > 0 && (
            <p className="sub" style={{ marginTop: 8 }}>
              {/* A prova de que a unificacao esta servindo para alguma coisa. */}
              {dados.summary.collapsed} cópia{dados.summary.collapsed === 1 ? '' : 's'} colapsada
              {dados.summary.collapsed === 1 ? '' : 's'} — você veria{' '}
              {dados.summary.total + dados.summary.collapsed} linhas sem a unificação.
            </p>
          )}
        </section>

        <section className="card">
          <h2>Conflitos entre contas</h2>
          <div
            className="metric"
            style={{ color: dados.summary.crossAccountConflicts > 0 ? 'var(--crit)' : undefined }}
          >
            {dados.summary.crossAccountConflicts}
          </div>
          <div className="metric-label">
            {dados.summary.crossAccountConflicts === 0
              ? 'nenhuma sobreposição entre contas'
              : 'nenhuma agenda sozinha mostraria isso'}
          </div>
        </section>

        <section className="card">
          <h2>Tempo livre</h2>
          <div className="metric">{dados.summary.freeHours}h</div>
          <div className="metric-label">em janelas de 90min+ no expediente</div>
        </section>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {dados.days.map((dia, i) => {
          const conflitantes = new Set(
            dia.conflicts.flatMap((c) => (c.crossAccount ? [c.a.id, c.b.id] : [])),
          );

          return (
            <section
              key={dia.date.toISOString()}
              className="card"
              style={{
                padding: 12,
                borderLeft: dia.isToday ? '3px solid var(--ok, #4ade80)' : undefined,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'baseline',
                  marginBottom: dia.entries.length || dia.allDay.length ? 8 : 0,
                }}
              >
                <strong style={{ fontSize: 14 }}>
                  {DIA_SEMANA[i]} {formatInZone(dia.date, tz, { day: '2-digit', month: '2-digit' })}
                </strong>
                {dia.isToday && <span className="pill ok">hoje</span>}
                {dia.conflicts.some((c) => c.crossAccount) && (
                  <span className="pill crit">conflito</span>
                )}
                <span className="sub" style={{ marginLeft: 'auto', fontSize: 12 }}>
                  {dia.entries.length + dia.allDay.length === 0
                    ? 'livre'
                    : `${dia.entries.length + dia.allDay.length} compromisso${dia.entries.length + dia.allDay.length === 1 ? '' : 's'}`}
                </span>
              </div>

              {dia.allDay.map((entrada) => (
                <div key={entrada.id} className="linha">
                  <span className="pill">dia inteiro</span>
                  <span className="titulo-item">{entrada.title}</span>
                  <span style={{ display: 'flex', gap: 3 }}>
                    {entrada.accounts.map((conta) => (
                      <span key={conta.id} className="ponto" style={{ background: conta.color }} />
                    ))}
                  </span>
                </div>
              ))}

              {dia.entries.map((entrada) => (
                <div key={entrada.id} className="linha">
                  {/* Barra proporcional ao horario dentro do expediente: da
                      para ver de relance se o dia esta carregado de manha ou
                      de tarde, sem precisar ler cada linha. */}
                  <span
                    aria-hidden
                    style={{
                      display: 'inline-block',
                      width: 46,
                      height: 6,
                      borderRadius: 3,
                      background: 'var(--border)',
                      position: 'relative',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        borderRadius: 3,
                        background: conflitantes.has(entrada.id)
                          ? 'var(--crit)'
                          : entrada.accounts[0]?.color,
                        left: `${faixaDoDia(entrada.startsAt, tz).left}%`,
                        width: `${Math.max(
                          6,
                          faixaDoDia(entrada.endsAt, tz).left - faixaDoDia(entrada.startsAt, tz).left,
                        )}%`,
                      }}
                    />
                  </span>
                  <span
                    className={`pill ${conflitantes.has(entrada.id) ? 'crit' : ''}`}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {formatTime(entrada.startsAt, tz)}–{formatTime(entrada.endsAt, tz)}
                  </span>
                  <span className="titulo-item">
                    {entrada.title}
                    {entrada.accounts.length > 1 && (
                      <>
                        <br />
                        {/* A dedup nunca esconde: diz em quantas caixas existe. */}
                        <span className="sub">
                          em {entrada.accounts.length} contas:{' '}
                          {entrada.accounts.map((a) => a.label).join(', ')}
                        </span>
                      </>
                    )}
                  </span>
                  <span style={{ display: 'flex', gap: 3 }}>
                    {entrada.accounts.map((conta) => (
                      <span key={conta.id} className="ponto" style={{ background: conta.color }} />
                    ))}
                  </span>
                </div>
              ))}

              {dia.freeWindows.length > 0 && (
                <p className="sub" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
                  livre: {dia.freeWindows.map((j) => `${formatTime(j.start, tz)}–${formatTime(j.end, tz)}`).join(' · ')}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}

/**
 * Grade do mês. Reaproveita o mesmo núcleo da semana, então a
 * deduplicação e o conflito se comportam igual nas duas telas.
 */
async function VistaMes({
  base,
  userId,
  conta,
}: {
  base: Date;
  userId: string;
  conta?: string;
}) {
  const dados = await loadMonth(userId, base, conta || null);
  const tz = dados.timeZone;
  const sufixo = conta ? `&conta=${conta}` : '';

  const linhas: (typeof dados.days)[] = [];
  for (let i = 0; i < dados.days.length; i += 7) linhas.push(dados.days.slice(i, i + 7));

  return (
    <main className="shell">
      <Nav atual="/agenda" />
      <header className="topo">
        <div>
          <h1>Agenda</h1>
          <p className="sub">
            Mês inteiro, todos os calendários. Horários em <strong>{tz}</strong> (
            {zoneLabel(dados.monthStart, tz)}).
          </p>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <a href={`/agenda?vista=mes&semana=${isoDateInZone(shiftMonths(base, -1, tz), tz)}${sufixo}`} className="pill">
          ← mês anterior
        </a>
        <strong style={{ fontSize: 14 }}>
          {formatInZone(dados.monthStart, tz, { month: 'long', year: 'numeric' })}
        </strong>
        <a href={`/agenda?vista=mes&semana=${isoDateInZone(shiftMonths(base, 1, tz), tz)}${sufixo}`} className="pill">
          próximo mês →
        </a>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <a href={`/agenda?semana=${isoDateInZone(base, tz)}${sufixo}`} className="pill">
            semana
          </a>
          <a href={`/agenda?vista=mes&semana=${isoDateInZone(base, tz)}${sufixo}`} className="pill" style={{ fontWeight: 600 }}>
            mês
          </a>
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: 4,
          marginBottom: 6,
        }}
      >
        {DIA_SEMANA.map((nome) => (
          <div key={nome} className="sub" style={{ fontSize: 11, textAlign: 'center' }}>
            {nome.slice(0, 3)}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {linhas.map((linha, i) => (
          <div
            key={i}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}
          >
            {linha.map((dia) => {
              const todos = [...dia.allDay, ...dia.entries];
              return (
                <div
                  key={dia.date.toISOString()}
                  className="card"
                  style={{
                    padding: 7,
                    minHeight: 88,
                    // Sobra de semana fica apagada, mas NAO some: um
                    // compromisso do dia 31 do mes anterior continua sendo
                    // um compromisso seu.
                    opacity: dia.inMonth ? 1 : 0.45,
                    borderLeft: dia.isToday ? '3px solid var(--ok, #4ade80)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 12, fontWeight: dia.isToday ? 700 : 500 }}>
                      {formatInZone(dia.date, tz, { day: '2-digit' })}
                    </span>
                    {dia.hasCrossAccountConflict && (
                      <span style={{ color: 'var(--crit)', fontSize: 11 }}>●</span>
                    )}
                  </div>

                  {todos.slice(0, 3).map((entrada) => (
                    <div
                      key={entrada.id}
                      className="sub"
                      style={{
                        fontSize: 10,
                        marginTop: 3,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={entrada.title}
                    >
                      {entrada.accounts.map((c) => (
                        <span
                          key={c.id}
                          className="ponto"
                          style={{ background: c.color, width: 5, height: 5 }}
                        />
                      ))}{' '}
                      {entrada.isAllDay ? '' : `${formatTime(entrada.startsAt, tz)} `}
                      {entrada.title}
                    </div>
                  ))}
                  {todos.length > 3 && (
                    <div className="sub" style={{ fontSize: 10, marginTop: 2 }}>
                      +{todos.length - 3}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </main>
  );
}
