import { describe, expect, it } from 'vitest';
import { urlDeMidiaPermitida } from './midia';

describe('urlDeMidiaPermitida — a unica coisa entre um webhook e uma requisicao saindo', () => {
  it('aceita as URLs de midia do Twilio', () => {
    expect(urlDeMidiaPermitida('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1')).toBe(true);
    expect(urlDeMidiaPermitida('https://media.twiliocdn.com/AC1/abc')).toBe(true);
  });

  it('recusa http — credencial nao viaja em claro', () => {
    expect(urlDeMidiaPermitida('http://api.twilio.com/x')).toBe(false);
  });

  it('recusa outro host', () => {
    expect(urlDeMidiaPermitida('https://exemplo.com/arquivo.pdf')).toBe(false);
  });

  it('recusa endereco interno — e o ataque que esta trava existe para impedir', () => {
    for (const u of [
      'https://169.254.169.254/latest/meta-data/',
      'https://localhost/admin',
      'https://127.0.0.1:5432/',
      'https://10.0.0.5/interno',
      'file:///etc/passwd',
    ]) {
      expect(urlDeMidiaPermitida(u)).toBe(false);
    }
  });

  it('nao cai no host que so PARECE do Twilio', () => {
    // O classico: sufixo colado num dominio de quem ataca.
    expect(urlDeMidiaPermitida('https://api.twilio.com.evil.com/x')).toBe(false);
    expect(urlDeMidiaPermitida('https://evil.com/api.twilio.com/x')).toBe(false);
    expect(urlDeMidiaPermitida('https://notapi.twilio.com/x')).toBe(false);
    // Credencial embutida na URL nao muda o host, mas confunde leitura humana.
    expect(urlDeMidiaPermitida('https://api.twilio.com@evil.com/x')).toBe(false);
  });

  it('nao explode com lixo', () => {
    for (const u of ['', 'nao é url', '://', 'javascript:alert(1)']) {
      expect(urlDeMidiaPermitida(u)).toBe(false);
    }
  });

  it('maiuscula no host nao burla', () => {
    expect(urlDeMidiaPermitida('https://API.TWILIO.COM/x')).toBe(true);
  });
});
