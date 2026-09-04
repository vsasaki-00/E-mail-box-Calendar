import { prisma } from '@/lib/db';
import { DEFAULT_TIMEZONE, formatDateTime, formatInZone } from '@/core/time/zone';
import { BotaoDesconectar, BotaoSincronizar, BotaoSincronizarTodas } from './sync-controls';
import { BotaoDesconectarTodas, FilaReconexao } from './reconexao';
import { BotaoAutorizar, FecharSePopup } from './autorizar';
import { SincronizacaoAutomatica } from './automatico';
import { ConfiguracaoDoBanco } from './config-banco';
import { FormularioImapCaldav } from './imap-form';
import { Nav } from '../nav';
import { coberturaDaUltimaVolta } from '@/core/sync/cobertura';
import {
  estadoDaConexao,
  frescorDaConexao,
  haQuantoTempo,
  nomeDoRecurso,
} from '@/core/metrics/estado-conexao';

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

export default async function PaginaConexoes({
  searchParams,
}: {
  searchParams: Promise<{ reconectado?: string; popup?: string }>;
}) {
  const { reconectado, popup } = await searchParams;
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  const tz = usuario?.timezone || DEFAULT_TIMEZONE;
  const conexoes = usuario
    ? await prisma.connection.findMany({
        where: { userId: usuario.id },
        orderBy: { createdAt: 'asc' },
        // A conta so esta atual quando o recurso mais atrasado dela esta:
        // `lastSyncAt` da conexao e gravado por QUALQUER recurso que termine
        // bem, e por isso esconde a metade parada. Ver `frescorDaConexao`.
        include: {
          syncStates: { select: { resource: true, lastSyncAt: true } },
        },
      })
    : [];
  const agora = new Date();

  // Uma regua so para a tela inteira.
  //
  // O frescor e calculado UMA vez por conta e serve tanto a faixa de cima
  // quanto as linhas. Media-los separado foi o erro que esta tela ja teve:
  // a faixa contava por `Connection.lastSyncAt` (otimista — qualquer recurso
  // que termine bem grava ali) e as linhas pelo recurso mais atrasado, entao
  // a faixa dizia "alcancou 5 de 6" enquanto so tres linhas pareciam
  // recentes. Duas contas do mesmo fato, lado a lado.
  const frescorPorConexao = new Map(
    conexoes.map((conexao) => [
      conexao.id,
      frescorDaConexao(conexao, conexao.syncStates, agora),
    ]),
  );
  const cobertura = coberturaDaUltimaVolta(
    conexoes.map((conexao) => ({
      lastSyncAt: frescorPorConexao.get(conexao.id)?.desde ?? null,
    })),
  );

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

  // Chegou aqui dentro da janelinha de autorizacao: nao adianta desenhar o
  // app inteiro num quadrado de 520px — o trabalho dela e avisar a pagina de
  // tras e sumir.
  if (popup === '1') {
    return (
      <main className="shell">
        <FecharSePopup />
      </main>
    );
  }

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
              <BotaoAutorizar href="/api/auth/google/start" style={botaoConectar}>
                Conectar conta Google
              </BotaoAutorizar>
            ) : (
              <p className="vazio">
                Configure <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> e{' '}
                <code>GOOGLE_REDIRECT_URI</code> no <code>.env</code> para habilitar o Google.
              </p>
            )}
            {microsoftConfigurado ? (
              <BotaoAutorizar href="/api/auth/microsoft/start" style={botaoConectar}>
                Conectar conta Microsoft
              </BotaoAutorizar>
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
          <ConfiguracaoDoBanco />
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
          <SincronizacaoAutomatica
            ultimoSync={cobertura.ultima}
            alcancadas={cobertura.alcancadas}
            total={cobertura.total}
            timeZone={tz}
          />
          {conexoes.length === 0 ? (
            <p className="vazio">Nenhuma conta conectada ainda.</p>
          ) : (
            conexoes.map((conexao) => {
              const frescor = frescorPorConexao.get(conexao.id) ?? {
                desde: null,
                recurso: null,
                minutos: null,
              };
              const pill = estadoDaConexao(conexao, frescor, agora);
              return (
                <div key={conexao.id} className="linha" style={{ alignItems: 'center' }}>
                  <span className="ponto" style={{ background: conexao.color }} />
                  <span className="titulo-item">
                    {conexao.accountEmail}
                    <br />
                    <span className="sub">
                      {PROVIDER_LABEL[conexao.provider] ?? conexao.provider}
                      {/* Relativo E absoluto, e o relativo primeiro: e ele
                          que a Torre mostra, e as duas telas precisam dizer
                          o mesmo numero. O relogio exato fica na frente de
                          quem foi ate aqui conferir. */}
                      {frescor.desde
                        ? ` · último sync ${haQuantoTempo(frescor.desde, agora)} (${formatDateTime(frescor.desde, tz)})`
                        : ' · nunca sincronizou'}
                      {frescor.recurso && pill.atrasada
                        ? ` · parada: ${nomeDoRecurso(frescor.recurso)}`
                        : ''}
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
                    <BotaoAutorizar
                      href={`/api/auth/${conexao.provider.toLowerCase()}/start?write=1&conta=${encodeURIComponent(conexao.accountEmail)}`}
                      style={{
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        cursor: 'pointer',
                        font: 'inherit',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        color: 'var(--muted)',
                      }}
                      title="Abre a tela do provedor pedindo permissão de escrita nesta caixa"
                    >
                      autorizar escrita →
                    </BotaoAutorizar>
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
