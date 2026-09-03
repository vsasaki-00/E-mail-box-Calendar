import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assinaturaTwilioConfere, converterTwilio, urlPublica } from './twilio';

const TOKEN = 'auth-token-de-teste';
const URL_PUB = 'https://exemplo.app/api/whatsapp/twilio';

/** Assina como o Twilio: URL + pares ordenados, HMAC-SHA1, base64. */
function assinarComoTwilio(url: string, params: Record<string, string>, token = TOKEN): string {
  const base = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', token).update(Buffer.from(base, 'utf8')).digest('base64');
}

const FORM = {
  MessageSid: 'SM1234567890abcdef',
  From: 'whatsapp:+5511987654321',
  To: 'whatsapp:+14155238886',
  Body: 'paguei o fornecedor XYZ, 1.200',
  NumMedia: '0',
  ProfileName: 'Vinicius',
};

describe('assinaturaTwilioConfere', () => {
  it('aceita a assinatura certa', () => {
    expect(assinaturaTwilioConfere(URL_PUB, FORM, assinarComoTwilio(URL_PUB, FORM), TOKEN)).toBe(true);
  });

  it('recusa quando um parametro muda', () => {
    const adulterado = { ...FORM, Body: 'paguei 999.999' };
    expect(assinaturaTwilioConfere(URL_PUB, adulterado, assinarComoTwilio(URL_PUB, FORM), TOKEN)).toBe(false);
  });

  it('recusa quando a URL nao e a mesma — o erro classico atras de proxy', () => {
    const assinada = assinarComoTwilio(URL_PUB, FORM);
    expect(assinaturaTwilioConfere('https://interno.vercel.app/api/whatsapp/twilio', FORM, assinada, TOKEN)).toBe(false);
  });

  it('recusa token errado, cabecalho ausente e tamanho diferente', () => {
    expect(assinaturaTwilioConfere(URL_PUB, FORM, assinarComoTwilio(URL_PUB, FORM, 'outro'), TOKEN)).toBe(false);
    expect(assinaturaTwilioConfere(URL_PUB, FORM, null, TOKEN)).toBe(false);
    expect(assinaturaTwilioConfere(URL_PUB, FORM, 'curto', TOKEN)).toBe(false);
    expect(assinaturaTwilioConfere(URL_PUB, FORM, assinarComoTwilio(URL_PUB, FORM), '')).toBe(false);
  });

  it('a ORDEM das chaves nao importa no objeto — o algoritmo ordena', () => {
    const invertido = Object.fromEntries(Object.entries(FORM).reverse());
    expect(assinaturaTwilioConfere(URL_PUB, invertido, assinarComoTwilio(URL_PUB, FORM), TOKEN)).toBe(true);
  });
});

describe('urlPublica', () => {
  const req = (headers: Record<string, string>, url = 'https://interno.vercel.app/api/whatsapp/twilio') => ({
    url,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  });

  it('WHATSAPP_PUBLIC_URL manda, e a barra final nao duplica', () => {
    process.env.WHATSAPP_PUBLIC_URL = 'https://meridiano.app/';
    expect(urlPublica(req({}))).toBe('https://meridiano.app/api/whatsapp/twilio');
    delete process.env.WHATSAPP_PUBLIC_URL;
  });

  it('sem ela, reconstroi pelos cabecalhos do proxy', () => {
    expect(urlPublica(req({ 'x-forwarded-host': 'meridiano.app', 'x-forwarded-proto': 'https' }))).toBe(
      'https://meridiano.app/api/whatsapp/twilio',
    );
    expect(urlPublica(req({ host: 'meridiano.app' }))).toBe('https://meridiano.app/api/whatsapp/twilio');
  });

  it('sem nada, cai na URL da requisicao sem query', () => {
    expect(urlPublica(req({}, 'https://x.app/api/whatsapp/twilio?a=1'))).toBe('https://x.app/api/whatsapp/twilio');
  });
});

describe('converterTwilio', () => {
  const AGORA = new Date('2026-09-02T15:00:00Z');

  it('texto: tira o prefixo whatsapp: do numero', () => {
    const m = converterTwilio(FORM, AGORA)!;
    expect(m).toMatchObject({
      externalId: 'SM1234567890abcdef',
      fromNumber: '5511987654321',
      fromName: 'Vinicius',
      kind: 'TEXT',
      text: 'paguei o fornecedor XYZ, 1.200',
    });
    expect(m.receivedAt).toEqual(AGORA);
  });

  it('foto vira IMAGE, por referencia', () => {
    const m = converterTwilio(
      { ...FORM, Body: '', NumMedia: '1', MediaUrl0: 'https://api.twilio.com/.../Media/ME123', MediaContentType0: 'image/jpeg' },
      AGORA,
    )!;
    expect(m.kind).toBe('IMAGE');
    expect(m.mediaId).toBe('https://api.twilio.com/.../Media/ME123');
    expect(m.text).toBeUndefined();
  });

  it('pdf vira DOCUMENT; audio vira AUDIO', () => {
    expect(converterTwilio({ ...FORM, NumMedia: '1', MediaContentType0: 'application/pdf' }, AGORA)?.kind).toBe('DOCUMENT');
    expect(converterTwilio({ ...FORM, NumMedia: '1', MediaContentType0: 'audio/ogg' }, AGORA)?.kind).toBe('AUDIO');
  });

  it('aceita SmsMessageSid quando MessageSid nao vem', () => {
    const { MessageSid: _, ...semSid } = FORM;
    expect(converterTwilio({ ...semSid, SmsMessageSid: 'SM9' }, AGORA)?.externalId).toBe('SM9');
  });

  it('sem sid ou sem remetente, nao converte', () => {
    expect(converterTwilio({ From: 'whatsapp:+55119' }, AGORA)).toBeUndefined();
    expect(converterTwilio({ MessageSid: 'SM1' }, AGORA)).toBeUndefined();
  });
});
