import { prisma } from '@/lib/db';
import { formatarValor } from '@/core/finance/format';
import { DEFAULT_TIMEZONE, formatDateTime, isoDateInZone } from '@/core/time/zone';
import { CATEGORIAS } from '@/core/finance/categorias';
import { BUSINESS_CONTEXTS } from '@/core/triage/businesses';
import { lerAllowlist } from '@/core/whatsapp/seguranca';
import { Nav } from '../../nav';
import { BotaoDescartar, PropostaForm } from './proposta-form';

/**
 * Entrada por WhatsApp: o que chegou, esperando você. Ver docs/11-whatsapp.md
 *
 * Nada aqui virou lançamento sozinho. A tela existe justamente porque o
 * canal não tem remetente verificável e uma frase digitada com pressa é
 * palpite sobre intenção.
 */

export const dynamic = 'force-dynamic';

/** Centavos → "1.234,56", para preencher o campo editável. */
function paraCampo(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export default async function PaginaEntrada() {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) {
    return (
      <main className="shell">
        <Nav atual="/financeiro/entrada" />
        <h1>Entrada</h1>
        <p className="vazio">Nenhuma conta conectada ainda.</p>
      </main>
    );
  }
  const tz = usuario.timezone || DEFAULT_TIMEZONE;

  const [mensagens, contas, jaLancadas] = await Promise.all([
    prisma.inboxMessage.findMany({
      where: { userId: usuario.id, status: { in: ['PENDING', 'PROPOSED', 'FAILED'] } },
      orderBy: { receivedAt: 'desc' },
      take: 100,
    }),
    prisma.financialAccount.findMany({
      where: { userId: usuario.id, archived: false },
      orderBy: { createdAt: 'asc' },
      select: { id: true, label: true },
    }),
    prisma.inboxMessage.count({ where: { userId: usuario.id, status: 'ACCEPTED' } }),
  ]);

  // Dois caminhos oficiais, e basta UM. Twilio é BSP homologado pela Meta;
  // a Cloud API é a Meta direto. O núcleo não sabe de qual veio.
  const viaTwilio = Boolean(process.env.TWILIO_AUTH_TOKEN);
  const viaMeta = Boolean(process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN);
  const configurado = viaTwilio || viaMeta;
  const provedor = viaTwilio ? 'Twilio' : viaMeta ? 'Cloud API da Meta' : null;
  const allowlist = lerAllowlist(process.env.WHATSAPP_ALLOWED_NUMBERS);
  const propostas = mensagens.filter((m) => m.status === 'PROPOSED');
  const semProposta = mensagens.filter((m) => m.status !== 'PROPOSED');

  return (
    <main className="shell">
      <Nav atual="/financeiro/entrada" />
      <header className="topo">
        <div>
          <h1>Entrada</h1>
          <p className="sub">
            Mensagens de WhatsApp esperando virar lançamento. Nenhuma vira sozinha.
          </p>
        </div>
      </header>

      {!configurado ? (
        <div className="aviso" style={{ marginBottom: 16 }}>
          <p>
            <strong>O canal ainda não está ligado.</strong> Basta um dos dois caminhos:{' '}
            <code>TWILIO_AUTH_TOKEN</code> (se você usa Twilio) ou{' '}
            <code>WHATSAPP_APP_SECRET</code> + <code>WHATSAPP_VERIFY_TOKEN</code> (Cloud API da
            Meta). O passo a passo está em <code>docs/11-whatsapp.md</code>.
          </p>
          <p className="sub">
            Enquanto isso, <strong>encaminhar o comprovante para uma das caixas conectadas</strong>{' '}
            já funciona: a extração de cobranças lê o e-mail e o anexo, sem nada de novo.
          </p>
        </div>
      ) : allowlist.length === 0 ? (
        <div className="aviso" style={{ marginBottom: 16, borderLeftColor: 'var(--crit)' }}>
          <p>
            <strong><code>WHATSAPP_ALLOWED_NUMBERS</code> está vazia — nenhuma mensagem será aceita.</strong>{' '}
            É de propósito: lista vazia recusa tudo, em vez de liberar geral. Coloque o seu número
            (ex.: <code>5511987654321</code>) para o canal começar a funcionar.
          </p>
        </div>
      ) : (
        <p className="sub" style={{ marginBottom: 16, fontSize: 12 }}>
          Canal ligado via <strong>{provedor}</strong>, aceitando {allowlist.length} número(s).
          {jaLancadas > 0 && ` ${jaLancadas} mensagem(ns) já viraram lançamento.`}
        </p>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Esperando você</h2>
        {propostas.length === 0 ? (
          <p className="vazio">
            Nenhuma proposta pendente. Mande algo como{' '}
            <em>&quot;paguei o fornecedor XYZ, 1.200&quot;</em> para o número do app.
          </p>
        ) : (
          propostas.map((m) => (
            <div key={m.id} style={{ borderTop: '1px solid var(--border)', padding: '12px 0' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14 }}>
                  {formatarValor(
                    m.proposedDirection === 'ENTRADA'
                      ? (m.proposedAmountCents ?? 0)
                      : -(m.proposedAmountCents ?? 0),
                  )}
                </strong>
                <span className="sub">{m.proposedDescription}</span>
                <span className={`pill ${(m.confidence ?? 0) >= 0.7 ? 'ok' : 'warn'}`}>
                  {Math.round((m.confidence ?? 0) * 100)}%
                </span>
              </div>
              <div className="sub" style={{ fontSize: 12, marginTop: 4 }}>
                {/* A mensagem crua fica visível: a proposta é leitura dela,
                    e você precisa poder conferir a leitura contra o texto. */}
                “{m.text}” · {m.fromName ?? m.fromNumber} · {formatDateTime(m.receivedAt, tz)}
                {m.reason ? ` · ${m.reason}` : ''}
              </div>
              <PropostaForm
                item={{
                  id: m.id,
                  valor: paraCampo(m.proposedAmountCents ?? 0),
                  direcao: m.proposedDirection ?? 'SAIDA',
                  descricao: m.proposedDescription ?? '',
                  dataIso: isoDateInZone(m.proposedDate ?? m.receivedAt, tz),
                  categoria: m.proposedCategory,
                  negocio: m.proposedBusiness,
                }}
                contas={contas}
                categorias={CATEGORIAS}
                negocios={BUSINESS_CONTEXTS}
              />
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2>Chegaram, mas não deu para ler</h2>
        <p className="sub" style={{ fontSize: 12, marginBottom: 8 }}>
          Foto e áudio ficam aqui: o app não lê valor de imagem, e inventar um seria pior que não
          ler. O arquivo continua no seu WhatsApp.
        </p>
        {semProposta.length === 0 ? (
          <p className="vazio">Nada pendente.</p>
        ) : (
          semProposta.map((m) => (
            <div key={m.id} className="linha" style={{ alignItems: 'flex-start' }}>
              <span className="titulo-item">
                {m.text ? `“${m.text}”` : `(${m.kind.toLowerCase()}${m.mediaFileName ? `: ${m.mediaFileName}` : ''})`}
                <br />
                <span className="sub">
                  {m.fromName ?? m.fromNumber} · {formatDateTime(m.receivedAt, tz)}
                  {m.errorMessage ? ` · ${m.errorMessage}` : ''}
                </span>
              </span>
              <BotaoDescartar mensagemId={m.id} />
            </div>
          ))
        )}
      </section>
    </main>
  );
}
