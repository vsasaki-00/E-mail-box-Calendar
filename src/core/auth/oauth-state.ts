import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';

/**
 * Estado efemero do fluxo OAuth (o `state` do CSRF + o verifier do PKCE).
 *
 * Guardado no banco, nao em cookie assinado, porque o verifier do PKCE nao
 * pode viajar de volta ao navegador — ele so existe para provar ao Google que
 * quem troca o `code` e quem iniciou o fluxo. TTL curto: um link de
 * autorizacao velho nao deve continuar valido.
 */

const TTL_MINUTOS = 10;

export async function criarOAuthState(params: {
  provider: 'GOOGLE' | 'MICROSOFT';
  codeVerifier: string;
  redirectAfter?: string;
  /** Fluxo de upgrade para escrita (fase 4). */
  requestWrite?: boolean;
}): Promise<string> {
  const state = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MINUTOS * 60_000);

  await prisma.oAuthState.create({
    data: {
      state,
      provider: params.provider,
      codeVerifier: params.codeVerifier,
      requestWrite: params.requestWrite ?? false,
      redirectAfter: params.redirectAfter,
      expiresAt,
    },
  });

  return state;
}

/**
 * Consome o state: le e apaga na mesma operacao. Um `state` so pode ser usado
 * uma vez — reuso e sinal de replay do callback.
 */
export async function consumirOAuthState(
  state: string,
): Promise<{
  provider: 'GOOGLE' | 'MICROSOFT';
  codeVerifier: string;
  redirectAfter?: string;
  /** Este fluxo pediu escopos de escrita? Ver docs/08-escrita-e-acoes.md */
  requestWrite: boolean;
} | null> {
  const registro = await prisma.oAuthState.findUnique({ where: { state } });
  if (!registro) return null;

  await prisma.oAuthState.delete({ where: { state } });

  if (registro.expiresAt.getTime() < Date.now()) return null;

  return {
    provider: registro.provider as 'GOOGLE' | 'MICROSOFT',
    codeVerifier: registro.codeVerifier,
    redirectAfter: registro.redirectAfter ?? undefined,
    requestWrite: registro.requestWrite,
  };
}

/** Remove states expirados. Chamado no inicio do fluxo, sem worker dedicado. */
export async function limparOAuthStatesExpirados(): Promise<void> {
  await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
