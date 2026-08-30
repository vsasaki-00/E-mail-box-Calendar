import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Envelope encryption dos segredos das conexoes (tokens OAuth, senhas de app).
 *
 * Regras que sustentam docs/04-seguranca.md:
 *  - a chave mestra vive em variavel de ambiente / KMS, nunca no banco;
 *  - AES-256-GCM: cifra e autentica, entao adulteracao no banco falha na
 *    decifragem em vez de devolver lixo silenciosamente;
 *  - o keyId gravado junto permite rotacao de chave sem downtime.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // recomendado para GCM
const KEY_BYTES = 32;

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  keyId: string;
}

/** Chaves disponiveis para decifrar. A corrente e usada para cifrar. */
export interface Keyring {
  currentKeyId: string;
  keys: Record<string, Buffer>;
}

function decodeKey(raw: string, label: string): Buffer {
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${label} deve ter exatamente ${KEY_BYTES} bytes em base64 (gere com: openssl rand -base64 32)`,
    );
  }
  return key;
}

/**
 * Monta o keyring a partir do ambiente.
 *
 * MASTER_ENCRYPTION_KEY      chave corrente (base64, 32 bytes)
 * MASTER_ENCRYPTION_KEY_ID   identificador da chave corrente (default "k1")
 * MASTER_ENCRYPTION_KEYS_OLD chaves antigas, formato "id:base64,id:base64",
 *                            mantidas apenas para decifrar durante a rotacao.
 */
export type EnvMap = Record<string, string | undefined>;

export function keyringFromEnv(env: EnvMap = process.env): Keyring {
  const raw = env.MASTER_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'MASTER_ENCRYPTION_KEY nao configurada. Gere com: openssl rand -base64 32',
    );
  }
  const currentKeyId = env.MASTER_ENCRYPTION_KEY_ID || 'k1';
  const keys: Record<string, Buffer> = {
    [currentKeyId]: decodeKey(raw, 'MASTER_ENCRYPTION_KEY'),
  };

  for (const entry of (env.MASTER_ENCRYPTION_KEYS_OLD || '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(':');
    if (separator === -1) {
      throw new Error('MASTER_ENCRYPTION_KEYS_OLD deve usar o formato "id:base64,id:base64"');
    }
    const id = trimmed.slice(0, separator);
    keys[id] = decodeKey(trimmed.slice(separator + 1), `chave antiga "${id}"`);
  }

  return { currentKeyId, keys };
}

export function encryptSecret(plaintext: string, keyring: Keyring): EncryptedSecret {
  const key = keyring.keys[keyring.currentKeyId];
  if (!key) {
    throw new Error(`Chave corrente "${keyring.currentKeyId}" ausente no keyring`);
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    keyId: keyring.currentKeyId,
  };
}

export function decryptSecret(secret: EncryptedSecret, keyring: Keyring): string {
  const key = keyring.keys[secret.keyId];
  if (!key) {
    throw new Error(
      `Chave "${secret.keyId}" nao esta no keyring; a conexao precisa ser reautenticada`,
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(secret.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Precisa ser reescrito com a chave corrente? Usado pelo job de rotacao. */
export function needsRotation(secret: EncryptedSecret, keyring: Keyring): boolean {
  return secret.keyId !== keyring.currentKeyId;
}

/** Comparacao em tempo constante, para validar o `state` do fluxo OAuth. */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
