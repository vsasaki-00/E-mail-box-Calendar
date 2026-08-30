import { prisma } from '@/lib/db';
import { desconectar, sincronizarAgora } from './actions';
import { FormularioImapCaldav } from './imap-form';

/**
 * Pagina de conexoes: conectar contas novas e gerenciar as existentes.
 * Ver docs/03-conectores.md
 */

export const dynamic = 'force-dynamic';

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

export default async function PaginaConexoes() {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
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
      <header className="topo">
        <div>
          <h1>Conexões</h1>
          <p className="sub">Contas de e-mail e calendário conectadas à Torre de Comando.</p>
        </div>
        <a href="/" className="sub">
          ← voltar
        </a>
      </header>

      <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
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
          <h2>Contas conectadas</h2>
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
                        ? ` · último sync ${conexao.lastSyncAt.toLocaleString('pt-BR')}`
                        : ' · nunca sincronizou'}
                      {conexao.lastErrorMessage ? ` · ${conexao.lastErrorMessage}` : ''}
                    </span>
                  </span>
                  <span className={`pill ${pill.classe}`}>{pill.texto}</span>
                  <form action={sincronizarAgora.bind(null, conexao.id)}>
                    <button
                      type="submit"
                      style={{
                        marginLeft: 8,
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Sincronizar agora
                    </button>
                  </form>
                  <form action={desconectar.bind(null, conexao.id)}>
                    <button
                      type="submit"
                      style={{
                        marginLeft: 8,
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--crit)',
                        background: 'transparent',
                        color: 'var(--crit)',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Desconectar
                    </button>
                  </form>
                </div>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
