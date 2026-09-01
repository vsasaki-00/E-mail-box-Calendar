import { prisma } from '@/lib/db';
import { DEFAULT_TIMEZONE, formatDateTime, formatInZone } from '@/core/time/zone';
import { BotaoDesconectar, BotaoSincronizar, BotaoSincronizarTodas } from './sync-controls';
import { BotaoDesconectarTodas, FilaReconexao } from './reconexao';
import { FormularioImapCaldav } from './imap-form';
import { Nav } from '../nav';

/**
 * Pagina de conexoes: conectar contas novas e gerenciar as existentes.
 * Ver docs/03-conectores.md
 */

export const dynamic = 'force-dynamic';

// Vale tambem para as Server Actions desta pagina ("Sincronizar agora"):
// sem isto elas herdam o timeout padrao do runtime (~15s), que corta o
// primeiro sync de uma caixa real no meio e sem feedback. 60s e o teto
// seguro do Hobby; um corte segue nao sendo fatal — o cursor persiste e o
// proximo clique retoma de onde parou.
export const maxDuration = 60;

const PROVIDER_LABEL: Record<string, string> = {
  GOOGLE: 'Google',
  MICROSOFT: 'Microsoft',
  APPLE: 'Apple iCloud',
  IMAP_CALDAV: 'IMAP/CalDAV',
};

function statusTexto(status: string): { classe: string; texto: string } {
  switch (status) {
    case 'ACTIVE':
      return { classe: 'ok', texto: 'ativa' };
    case 'REAUTH_REQUIRED':
      return { classe: 'crit', texto: 'reautenticar' };
    case 'ERROR':
      return { classe: 'crit', texto: 'erro' };
    case 'DISABLED':
      return { classe: 'warn', texto: 'desativada' };
    default:
      return { classe: 'warn', texto: 'degradada' };
  }
}

export default async function PaginaConexoes({
  searchParams,
}: {
  searchParams: Promise<{ reconectado?: string }>;
}) {
  const { reconectado } = await searchParams;
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  const tz = usuario?.timezone || DEFAULT_TIMEZONE;
  const conexoes = usuario
    ? await prisma.connection.findMany({
        where: { userId: usuario.id },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const googleConfigurado = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
  const microsoftConfigurado = Boolean(
    process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET,
  );

  const botaoConectar = {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    cursor: 'pointer',
  } as const;

  return (
    <main className="shell">
      <Nav atual="/conexoes" />
      <header className="topo">
        <div>
          <h1>Conexões</h1>
          <p className="sub">Contas de e-mail e calendário conectadas à Meridiano.</p>
        </div>
        <div>
          <a href="/perfis" className="sub" style={{ marginRight: 14 }}>
            perfis das caixas →
          </a>
        </div>
      </header>

      <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
        <FilaReconexao
          jaConectados={conexoes.map((c) => c.accountEmail)}
          reconectado={reconectado}
        />

        <section className="card">
          <h2>Conectar uma conta</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {googleConfigurado ? (
              <a href="/api/auth/google/start">
                <button type="button" style={botaoConectar}>
                  Conectar conta Google
                </button>
              </a>
            ) : (
              <p className="vazio">
                Configure <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> e{' '}
                <code>GOOGLE_REDIRECT_URI</code> no <code>.env</code> para habilitar o Google.
              </p>
            )}
            {microsoftConfigurado ? (
              <a href="/api/auth/microsoft/start">
                <button type="button" style={botaoConectar}>
                  Conectar conta Microsoft
                </button>
              </a>
            ) : (
              <p className="vazio">
                Configure <code>MICROSOFT_CLIENT_ID</code> e <code>MICROSOFT_CLIENT_SECRET</code>{' '}
                no <code>.env</code> para habilitar o Microsoft (aceita Hotmail/Outlook.com
                pessoal e conta corporativa).
              </p>
            )}
          </div>
          <div style={{ marginTop: 14 }}>
            <FormularioImapCaldav />
          </div>
          <p className="sub" style={{ marginTop: 12 }}>
            Ver <code>docs/03-conectores.md</code>.
          </p>
        </section>

        <section className="card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <h2>Contas conectadas</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <BotaoSincronizarTodas connectionIds={conexoes.map((c) => c.id)} />
              <BotaoDesconectarTodas
                contas={conexoes.map((c) => ({
                  id: c.id,
                  accountEmail: c.accountEmail,
                  provider: c.provider,
                }))}
              />
            </div>
          </div>
          {conexoes.length === 0 ? (
            <p className="vazio">Nenhuma conta conectada ainda.</p>
          ) : (
            conexoes.map((conexao) => {
              const pill = statusTexto(conexao.status);
              return (
                <div key={conexao.id} className="linha" style={{ alignItems: 'center' }}>
                  <span className="ponto" style={{ background: conexao.color }} />
                  <span className="titulo-item">
                    {conexao.accountEmail}
                    <br />
                    <span className="sub">
                      {PROVIDER_LABEL[conexao.provider] ?? conexao.provider}
                      {conexao.lastSyncAt
                        ? ` · último sync ${formatDateTime(conexao.lastSyncAt, tz)}`
                        : ' · nunca sincronizou'}
                      {conexao.lastErrorMessage ? ` · ${conexao.lastErrorMessage}` : ''}
                    </span>
                  </span>
                  <span className={`pill ${pill.classe}`}>{pill.texto}</span>
                  {/* Escrita e por CAIXA, e o rotulo diz em qual modo ela
                      esta. Somente-leitura nao e um aviso: e o padrao. */}
                  <span className={`pill ${conexao.writeEnabled ? 'warn' : ''}`}>
                    {conexao.writeEnabled ? 'escrita autorizada' : 'somente leitura'}
                  </span>
                  {conexao.provider !== 'IMAP_CALDAV' && !conexao.writeEnabled && (
                    <a
                      href={`/api/auth/${conexao.provider.toLowerCase()}/start?write=1`}
                      className="pill"
                      style={{ textDecoration: 'none' }}
                      title="Abre a tela do provedor pedindo permissão de escrita nesta caixa"
                    >
                      autorizar escrita →
                    </a>
                  )}
                  <BotaoSincronizar connectionId={conexao.id} />
                  <BotaoDesconectar
                    connectionId={conexao.id}
                    rotuloConta={conexao.accountEmail}
                  />
                </div>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
