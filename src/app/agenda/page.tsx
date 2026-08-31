import { prisma } from '@/lib/db';
import { loadAgenda } from '@/core/agenda/load';
import { shiftWeeks } from '@/core/agenda/week';

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

function hhmm(data: Date): string {
  return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function isoDia(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export default async function PaginaAgenda({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string; conta?: string }>;
}) {
  const params = await searchParams;

  const referencia = params.semana ? new Date(`${params.semana}T12:00:00`) : new Date();
  const base = Number.isNaN(referencia.getTime()) ? new Date() : referencia;

  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) {
    return (
      <main className="shell">
        <h1>Agenda</h1>
        <div className="aviso">
          <p>
            <strong>Nenhuma conta conectada.</strong> <a href="/conexoes">Conectar uma caixa →</a>
          </p>
        </div>
      </main>
    );
  }

  const dados = await loadAgenda(usuario.id, base, params.conta || null);
  const conta = params.conta ? `&conta=${params.conta}` : '';

  const rotuloSemana = `${dados.weekStart.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  })} – ${new Date(dados.weekEnd.getTime() - 1).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}`;

  return (
    <main className="shell">
      <header className="topo">
        <div>
          <h1>Agenda</h1>
          <p className="sub">
            Todos os calendários em uma semana só. O mesmo compromisso em várias contas é{' '}
            <strong>uma linha</strong>, com uma bolinha por conta.
          </p>
        </div>
        <a href="/" className="sub">← voltar</a>
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
                  {DIA_SEMANA[i]} {dia.date.getDate()}/{dia.date.getMonth() + 1}
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
                      <span key={conta.label} className="ponto" style={{ background: conta.color }} />
                    ))}
                  </span>
                </div>
              ))}

              {dia.entries.map((entrada) => (
                <div key={entrada.id} className="linha">
                  <span
                    className={`pill ${conflitantes.has(entrada.id) ? 'crit' : ''}`}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {hhmm(entrada.startsAt)}–{hhmm(entrada.endsAt)}
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
                      <span key={conta.label} className="ponto" style={{ background: conta.color }} />
                    ))}
                  </span>
                </div>
              ))}

              {dia.freeWindows.length > 0 && (
                <p className="sub" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
                  livre: {dia.freeWindows.map((j) => `${hhmm(j.start)}–${hhmm(j.end)}`).join(' · ')}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
