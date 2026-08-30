import { randomBytes, createHash } from 'node:crypto';

/**
 * PKCE (Proof Key for Code Exchange), compartilhado por todos os conectores
 * OAuth2. Ver docs/04-seguranca.md — obrigatorio mesmo no fluxo server-side.
 */

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
