import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Verificação de senha. Ver docs/09-deploy.md
 *
 * Roda só no Node (usa `node:crypto`), nunca no middleware Edge — por isso
 * está separado de `session.ts`.
 *
 * scrypt, e não SHA direto: uma senha passada por hash rápido é quebrada
 * por força bruta em minutos. scrypt é caro de propósito, em CPU e em
 * memória, o que torna a força bruta impraticável.
 *
 * A senha NUNCA fica no banco. Só o hash, e só em variável de ambiente —
 * um dump do banco não revela como entrar.
 */

/** Custo do scrypt. 2^15 é o recomendado atual e leva ~100ms. */
const N = 32768;
const TAMANHO_HASH = 64;

/** Gera o hash para colar em `APP_PASSWORD_HASH`. */
export function gerarHashDeSenha(senha: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(senha, salt, TAMANHO_HASH, { N, r: 8, p: 1, maxmem: 128 * N * 8 * 2 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * Confere a senha contra o hash.
 *
 * Nunca lança: hash malformado (variável de ambiente digitada errada) vira
 * `false`, e não erro 500 — a tela de login continua funcionando e dizendo
 * "senha incorreta", que é o comportamento seguro.
 */
export function conferirSenha(senha: string, hashGuardado: string | undefined): boolean {
  if (!hashGuardado) return false;

  const partes = hashGuardado.split('$');
  if (partes.length !== 3 || partes[0] !== 'scrypt') return false;

  const [, saltHex, hashHex] = partes;
  if (!saltHex || !hashHex) return false;

  try {
    const salt = Buffer.from(saltHex, 'hex');
    const esperado = Buffer.from(hashHex, 'hex');
    if (esperado.length !== TAMANHO_HASH) return false;

    const calculado = scryptSync(senha, salt, TAMANHO_HASH, {
      N,
      r: 8,
      p: 1,
      maxmem: 128 * N * 8 * 2,
    });
    // Comparação em tempo constante: comparar com `===` vazaria, pelo
    // tempo de resposta, quantos bytes iniciais estavam certos.
    return timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}
