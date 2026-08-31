import { prisma } from '@/lib/db';
import { loadControlTower, type ControlTowerData } from '@/core/metrics/control-tower';

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

function hora(date: Date): string {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function statusPill(status: string, isStale: boolean) {
  if (status === 'ACTIVE' && !isStale) return { classe: 'ok', texto: 'ativa' };
  if (status === 'REAUTH_REQUIRED') return { classe: 'crit', texto: 'reautenticar' };
  if (status === 'ERROR') return { classe: 'crit', texto: 'erro' };
  if (status === 'DISABLED') return { classe: 'warn', texto: 'desativada' };
  if (isStale) return { classe: 'warn', texto: 'atrasada' };
  return { classe: 'warn', texto: 'degradada' };
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="vazio">{children}</p>;
}

function Painel({ dados }: { dados: ControlTowerData }) {
  const criticos = dados.conflicts.filter((c) => c.crossAccount);

  return (
    <>
      <div className="grid">
        <section className="card">
          <h2>Precisam de resposta</h2>
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

        <section className="card">
          <h2>
            <a href="/financeiro" style={{ color: 'inherit' }}>Cobranças a pagar</a>
          </h2>
          <div className="metric">{dados.triage.cobrancas}</div>
          <div className="metric-label">
            {dados.triage.cobrancas === 0
              ? 'nenhuma detectada'
              : 'faturas, boletos e assinaturas'}
          </div>
          <p className="sub" style={{ marginTop: 10 }}>
            Detecção automática a partir dos e-mails — <strong>não é garantia</strong> de que
            todas as cobranças foram encontradas.
          </p>
        </section>

        <section className="card">
          <h2>Agenda de hoje</h2>
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

        <section className="card">
          <h2>Conflitos</h2>
          <div className="metric" style={{ color: criticos.length ? 'var(--crit)' : undefined }}>
            {dados.conflicts.length}
          </div>
          <div className="metric-label">
            {criticos.length > 0
              ? `${criticos.length} entre contas diferentes`
              : 'nenhuma sobreposicao entre contas'}
          </div>
        </section>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Saude das conexoes</h2>
          {dados.connections.length === 0 ? (
            <Vazio>Nenhuma conta conectada ainda.</Vazio>
          ) : (
            dados.connections.map((conexao) => {
              const pill = statusPill(conexao.status, conexao.isStale);
              return (
                <div key={conexao.id} className="linha">
                  <span className="ponto" style={{ background: conexao.color }} />
                  <span className="titulo-item">
                    {conexao.accountEmail}
                    <br />
                    <span className="sub">
                      {PROVIDER_LABEL[conexao.provider] ?? conexao.provider}
                      {conexao.minutesSinceSync !== null
                        ? ` · sync ha ${conexao.minutesSinceSync}min`
                        : ' · nunca sincronizou'}
                    </span>
                  </span>
                  <span className={`pill ${pill.classe}`}>{pill.texto}</span>
                </div>
              );
            })
          )}
        </section>

        <section className="card">
          <h2>Linha do dia</h2>
          {dados.timeline.length === 0 ? (
            <Vazio>Nenhum compromisso hoje.</Vazio>
          ) : (
            dados.timeline.map((evento) => (
              <div key={evento.id} className="linha">
                <span className="hora">
                  {evento.isAllDay ? 'dia' : `${hora(evento.startsAt)}–${hora(evento.endsAt)}`}
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
          <h2>Conflitos e alertas</h2>
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
                <div key={alerta.id} className="linha">
                  <span
                    className={`pill ${alerta.severity === 'CRITICAL' ? 'crit' : alerta.severity === 'WARN' ? 'warn' : 'ok'}`}
                  >
                    {alerta.severity.toLowerCase()}
                  </span>
                  <span className="titulo-item">
                    {alerta.title}
                    <br />
                    <span className="sub">{alerta.detail}</span>
                  </span>
                </div>
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
        <strong>Banco de dados indisponivel.</strong> A Torre de Controle le do cache local, entao
        precisa do Postgres no ar.
      </p>
      <pre>
        {`cp .env.example .env
# gere a chave mestra e cole em MASTER_ENCRYPTION_KEY:
openssl rand -base64 32

pnpm db:up      # sobe o Postgres via Docker
pnpm db:push    # aplica o schema
pnpm db:seed    # popula dados de demonstracao`}
      </pre>
      <p className="sub">
        Detalhe tecnico: <code>{erro}</code>
      </p>
    </div>
  );
}

export default async function TorreDeControle() {
  let dados: ControlTowerData | null = null;
  let erro: string | null = null;

  try {
    // Single-user na fase 1: o primeiro usuario e o dono. Ver docs/02.
    const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
    if (usuario) dados = await loadControlTower(usuario.id);
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="shell">
      <header className="topo">
        <div>
          <h1>Torre de Comando</h1>
          <p className="sub">Todas as caixas de e-mail e todos os calendarios, em um lugar so.</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          {dados && (
            <div className="sub">estado de {dados.generatedAt.toLocaleString('pt-BR')}</div>
          )}
          <a href="/rascunhos" className="sub" style={{ marginRight: 14 }}>
            rascunhos →
          </a>
          <a href="/financeiro" className="sub" style={{ marginRight: 14 }}>
            financeiro →
          </a>
          <a href="/triagem" className="sub" style={{ marginRight: 14 }}>
            triagem →
          </a>
          <a href="/voz" className="sub" style={{ marginRight: 14 }}>
            perfil de voz →
          </a>
          <a href="/perfis" className="sub" style={{ marginRight: 14 }}>
            perfis das caixas →
          </a>
          <a href="/conexoes" className="sub">
            gerenciar conexões →
          </a>
        </div>
      </header>

      {erro && <SemBanco erro={erro} />}

      {!erro && !dados && (
        <div className="aviso">
          <p>
            <strong>Banco vazio.</strong> Rode <code>pnpm db:seed</code> para popular dados de
            demonstracao e ver a tela funcionando.
          </p>
        </div>
      )}

      {dados && <Painel dados={dados} />}
    </main>
  );
}
