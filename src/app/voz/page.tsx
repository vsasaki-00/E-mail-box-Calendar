import { prisma } from '@/lib/db';
import { DEFAULT_TIMEZONE, formatDateTime, formatInZone } from '@/core/time/zone';
import { VozCard, type VozInicial } from './voz-card';

/**
 * Perfil de voz por caixa. Ver docs/07-agente-de-triagem.md (fase 5C)
 *
 * Derivado da pasta Enviados, nao declarado em formulario: ninguem descreve
 * o proprio jeito de escrever com precisao, e voce ja escreve diferente em
 * cada negocio — a prova esta gravada.
 */

export const dynamic = 'force-dynamic';

function lista(valor: unknown): { text: string; count: number }[] {
  return Array.isArray(valor) ? (valor as { text: string; count: number }[]) : [];
}

export default async function PaginaVoz() {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  const tz = usuario?.timezone || DEFAULT_TIMEZONE;
  const conexoes = usuario
    ? await prisma.connection.findMany({
        where: { userId: usuario.id },
        orderBy: { createdAt: 'asc' },
        include: { voiceProfile: true, mailboxProfile: { select: { businessName: true } } },
      })
    : [];

  const cards: VozInicial[] = conexoes.map((c) => ({
    connectionId: c.id,
    accountEmail: c.accountEmail,
    color: c.color,
    businessName: c.mailboxProfile?.businessName ?? null,
    perfil: c.voiceProfile
      ? {
          greetings: lista(c.voiceProfile.greetings),
          closings: lista(c.voiceProfile.closings),
          signature: c.voiceProfile.signature,
          avgWordCount: c.voiceProfile.avgWordCount,
          medianWordCount: c.voiceProfile.medianWordCount,
          formality: c.voiceProfile.formality,
          language: c.voiceProfile.language,
          traits: Array.isArray(c.voiceProfile.traits) ? (c.voiceProfile.traits as string[]) : [],
          sampleCount: c.voiceProfile.sampleCount,
          derivedAt: formatDateTime(c.voiceProfile.derivedAt, tz),
          userApproved: c.voiceProfile.userApproved,
          userNotes: c.voiceProfile.userNotes,
        }
      : null,
  }));

  return (
    <main className="shell">
      <header className="topo">
        <div>
          <h1>Perfil de voz</h1>
          <p className="sub">
            Como você escreve em cada caixa, aprendido da sua pasta Enviados. Você já escreve
            diferente em cada negócio — isto captura essa diferença.
          </p>
        </div>
        <a href="/" className="sub">
          ← voltar
        </a>
      </header>

      <div className="aviso" style={{ marginBottom: 20 }}>
        <p>
          <strong>Nada sai da sua máquina aqui.</strong> Diferente da triagem (que envia
          metadados), a derivação do perfil de voz lê os corpos das suas mensagens enviadas e
          processa tudo <strong>localmente</strong> — nenhuma chamada a API de modelo.
        </p>
        <p className="sub">
          O perfil é uma <strong>proposta</strong> até você confirmar. Ele é o insumo dos
          rascunhos da fase 5D; nada é gerado ainda.
        </p>
      </div>

      {conexoes.length === 0 ? (
        <div className="aviso">
          <p>
            <strong>Nenhuma conta conectada.</strong>{' '}
            <a href="/conexoes">Conectar uma caixa →</a>
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {cards.map((card) => (
            <VozCard key={card.connectionId} inicial={card} />
          ))}
        </div>
      )}
    </main>
  );
}
