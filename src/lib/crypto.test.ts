import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  keyringFromEnv,
  needsRotation,
  safeEquals,
  type Keyring,
} from './crypto';

function chaveBase64(): string {
  return randomBytes(32).toString('base64');
}

function keyring(): Keyring {
  return keyringFromEnv({
    MASTER_ENCRYPTION_KEY: chaveBase64(),
    MASTER_ENCRYPTION_KEY_ID: 'k1',
  });
}

describe('keyringFromEnv', () => {
  it('exige a chave mestra', () => {
    expect(() => keyringFromEnv({})).toThrow(/MASTER_ENCRYPTION_KEY/);
  });

  it('rejeita chave com tamanho errado', () => {
    expect(() =>
      keyringFromEnv({
        MASTER_ENCRYPTION_KEY: Buffer.from('curta').toString('base64'),
      }),
    ).toThrow(/32 bytes/);
  });

  it('carrega chaves antigas para permitir rotacao', () => {
    const anel = keyringFromEnv({
      MASTER_ENCRYPTION_KEY: chaveBase64(),
      MASTER_ENCRYPTION_KEY_ID: 'k2',
      MASTER_ENCRYPTION_KEYS_OLD: `k1:${chaveBase64()}`,
    });

    expect(anel.currentKeyId).toBe('k2');
    expect(Object.keys(anel.keys).sort()).toEqual(['k1', 'k2']);
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('faz o ciclo completo', () => {
    const anel = keyring();
    const segredo = JSON.stringify({ refreshToken: 'token-secreto', accessToken: 'abc' });
    const cifrado = encryptSecret(segredo, anel);

    expect(cifrado.ciphertext).not.toContain('token-secreto');
    expect(decryptSecret(cifrado, anel)).toBe(segredo);
  });

  it('usa IV diferente a cada chamada', () => {
    const anel = keyring();
    const a = encryptSecret('mesmo texto', anel);
    const b = encryptSecret('mesmo texto', anel);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('falha quando o texto cifrado e adulterado no banco', () => {
    // O ponto do GCM: adulteracao vira erro, nao lixo silencioso.
    const anel = keyring();
    const cifrado = encryptSecret('token', anel);
    const bytes = Buffer.from(cifrado.ciphertext, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;

    expect(() =>
      decryptSecret({ ...cifrado, ciphertext: bytes.toString('base64') }, anel),
    ).toThrow();
  });

  it('falha quando a tag de autenticacao e adulterada', () => {
    const anel = keyring();
    const cifrado = encryptSecret('token', anel);
    const tag = Buffer.from(cifrado.tag, 'base64');
    tag[0] = (tag[0] ?? 0) ^ 0xff;

    expect(() => decryptSecret({ ...cifrado, tag: tag.toString('base64') }, anel)).toThrow();
  });

  it('decifra com a chave antiga durante a rotacao', () => {
    const chaveAntiga = chaveBase64();
    const anelAntigo = keyringFromEnv({
      MASTER_ENCRYPTION_KEY: chaveAntiga,
      MASTER_ENCRYPTION_KEY_ID: 'k1',
    });

    const cifrado = encryptSecret('token-antigo', anelAntigo);

    const anelNovo = keyringFromEnv({
      MASTER_ENCRYPTION_KEY: chaveBase64(),
      MASTER_ENCRYPTION_KEY_ID: 'k2',
      MASTER_ENCRYPTION_KEYS_OLD: `k1:${chaveAntiga}`,
    });

    expect(decryptSecret(cifrado, anelNovo)).toBe('token-antigo');
    expect(needsRotation(cifrado, anelNovo)).toBe(true);
  });

  it('avisa quando a chave nao esta no anel, em vez de devolver lixo', () => {
    const anel = keyring();
    const cifrado = encryptSecret('token', anel);
    expect(() => decryptSecret({ ...cifrado, keyId: 'inexistente' }, anel)).toThrow(
      /reautenticada/,
    );
  });
});

describe('safeEquals', () => {
  it('compara o state do fluxo OAuth', () => {
    expect(safeEquals('abc123', 'abc123')).toBe(true);
    expect(safeEquals('abc123', 'abc124')).toBe(false);
    expect(safeEquals('abc', 'abcdef')).toBe(false);
  });
});
