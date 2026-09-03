import { describe, expect, it } from 'vitest';
import { destinoDeRedirecionamentoPermitido, urlDeMidiaPermitida } from './midia';

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

describe('destinoDeRedirecionamentoPermitido — quem escolhe e o Twilio, nao quem mandou', () => {
  it('aceita o S3 real, que foi o que quebrou em producao', () => {
    // A allowlist fechada recusava isto e o PDF legitimo voltava com
    // "Redirecionamento para fora do Twilio".
    for (const u of [
      'https://s3-external-1.amazonaws.com/media.twiliocdn.com/AC1/abc',
      'https://s3.us-east-1.amazonaws.com/media.twiliocdn.com/AC1/abc',
      'https://media.twiliocdn.com/AC1/abc',
    ]) {
      expect(destinoDeRedirecionamentoPermitido(u)).toBe(true);
    }
  });

  it('continua barrando a propria maquina e as redes internas', () => {
    for (const u of [
      'https://localhost/x',
      'https://algo.localhost/x',
      'https://127.0.0.1/x',
      'https://0.0.0.0/x',
      'https://10.1.2.3/x',
      'https://192.168.0.1/x',
      'https://172.16.0.1/x',
      'https://172.31.255.1/x',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/x',
    ]) {
      expect(destinoDeRedirecionamentoPermitido(u)).toBe(false);
    }
  });

  it('172.15 e 172.32 NAO sao rede privada — o intervalo e 16 a 31', () => {
    expect(destinoDeRedirecionamentoPermitido('https://172.15.0.1/x')).toBe(true);
    expect(destinoDeRedirecionamentoPermitido('https://172.32.0.1/x')).toBe(true);
  });

  it('http e lixo continuam fora', () => {
    expect(destinoDeRedirecionamentoPermitido('http://s3.amazonaws.com/x')).toBe(false);
    expect(destinoDeRedirecionamentoPermitido('nao é url')).toBe(false);
  });

  it('o PRIMEIRO salto continua fechado — a URL dele vem do webhook', () => {
    expect(urlDeMidiaPermitida('https://s3-external-1.amazonaws.com/x')).toBe(false);
  });
});
