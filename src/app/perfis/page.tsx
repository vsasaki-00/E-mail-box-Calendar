import { prisma } from '@/lib/db';
import { formatList } from '@/core/triage/businesses';
import { PerfilForm, type PerfilInicial } from './perfil-form';
import { Nav } from '../nav';

/**
 * Perfis das caixas. Ver docs/07-agente-de-triagem.md
 *
 * Cada caixa é um negócio diferente, com urgência diferente e gente
 * diferente do outro lado. Sem esta tela, a calibragem por caixa não teria
 * como ser configurada e a triagem trataria tudo igual.
 */

export const dynamic = 'force-dynamic';

export default async function PaginaPerfis() {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  const conexoes = usuario
    ? await prisma.connection.findMany({
        where: { userId: usuario.id },
        orderBy: { createdAt: 'asc' },
        include: { mailboxProfile: true },
      })
    : [];

  const perfis: PerfilInicial[] = conexoes.map((conexao) => ({
    connectionId: conexao.id,
    accountEmail: conexao.accountEmail,
    color: conexao.color,
    provider: conexao.provider,
    businessName: conexao.mailboxProfile?.businessName ?? '',
    role: conexao.mailboxProfile?.role ?? '',
    objective: conexao.mailboxProfile?.objective ?? '',
    calibration: conexao.mailboxProfile?.calibration ?? 'BALANCED',
    vipSenders: formatList(conexao.mailboxProfile?.vipSenders),
    urgentKeywords: formatList(conexao.mailboxProfile?.urgentKeywords),
    configurado: Boolean(conexao.mailboxProfile),
  }));

  const semPerfil = perfis.filter((p) => !p.configurado).length;

  return (
    <main className="shell">
      <Nav atual="/perfis" />
      <header className="topo">
        <div>
          <h1>Perfis das caixas</h1>
          <p className="sub">
            Cada caixa é um negócio diferente. O que você define aqui entra no prompt de triagem
            daquela caixa — é o que faz o mesmo e-mail ser urgente numa e irrelevante em outra.
          </p>
        </div>
      </header>

      {conexoes.length === 0 ? (
        <div className="aviso">
          <p>
            <strong>Nenhuma conta conectada.</strong> Conecte uma caixa antes de definir o perfil
            dela.
          </p>
          <p>
            <a href="/conexoes">Ir para conexões →</a>
          </p>
        </div>
      ) : (
        <>
          {semPerfil > 0 && (
            <div className="aviso" style={{ marginBottom: 20 }}>
              <p>
                {semPerfil === conexoes.length
                  ? 'Nenhuma caixa tem perfil ainda.'
                  : `${semPerfil} de ${conexoes.length} caixas ainda sem perfil.`}{' '}
                Até definir, a triagem trata todas com a calibragem padrão e sem contexto de
                negócio — o que reduz bastante a qualidade da classificação.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {perfis.map((perfil) => (
              <PerfilForm key={perfil.connectionId} inicial={perfil} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
