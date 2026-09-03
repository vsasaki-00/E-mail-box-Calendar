import { describe, expect, it } from 'vitest';
import { lerCobrancaDePdf } from './pdf-cobranca';

describe('lerCobrancaDePdf', () => {
  it('recusa o que nao e PDF pela ASSINATURA do arquivo, nao pelo tipo declarado', async () => {
    // O content-type vem de quem mandou; o byte nao mente.
    const r = await lerCobrancaDePdf(new TextEncoder().encode('<html>oi</html>'));
    expect(r.motivo).toBe('O arquivo não é um PDF.');
    expect(r.amountCents).toBeUndefined();
  });

  it('arquivo vazio nao explode', async () => {
    expect((await lerCobrancaDePdf(new Uint8Array())).motivo).toBeTruthy();
  });

  it('PDF valido mas sem texto diz que e escaneado — e nao "nao achei valor"', async () => {
    // "%PDF-" seguido de lixo: passa na assinatura, nao rende texto. Dizer
    // "nao achei valor" sugeriria que o arquivo estava certo.
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x00]);
    const r = await lerCobrancaDePdf(bytes);
    expect(r.amountCents).toBeUndefined();
    expect(r.motivo).toBeTruthy();
  });
});
