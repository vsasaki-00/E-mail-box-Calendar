import { describe, expect, it } from 'vitest';
import { buildGoogleAuthUrl, createPkcePair, mapGoogleError, GOOGLE_SCOPES } from './google';
import { buildMicrosoftAuthUrl, mapMicrosoftError } from './microsoft';
import { domainFromEmail, guessConfigForDomain, APPLE_PRESET } from './imap-caldav';
import { allConnectors, getConnector } from './registry';

const googleConnector = getConnector('GOOGLE');
const microsoftConnector = getConnector('MICROSOFT');
const imapCaldavConnector = getConnector('IMAP_CALDAV');

describe('registry', () => {
  it('resolve um conector para cada provedor do schema', () => {
    for (const provider of ['GOOGLE', 'MICROSOFT', 'APPLE', 'IMAP_CALDAV'] as const) {
      expect(getConnector(provider).provider).toBe(provider);
    }
  });

  it('mantem todos os conectores somente leitura na fase 1', () => {
    // Pedir escopo de escrita "para talvez usar depois" e exatamente o que a
    // politica de seguranca proibe. Ver docs/04-seguranca.md
    for (const connector of allConnectors()) {
      expect(connector.capabilities.write).toBe(false);
    }
  });

  it('da intervalo de polling maior a quem nao tem push nativo', () => {
    for (const connector of allConnectors()) {
      if (!connector.capabilities.push) {
        expect(connector.capabilities.pollIntervalSeconds).toBeGreaterThan(300);
      }
    }
  });
});

describe('PKCE', () => {
  it('gera verifier e challenge distintos a cada chamada', () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(a.verifier);
    // base64url: sem +, / ou = para poder ir na query string sem escapar.
    expect(a.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('buildGoogleAuthUrl', () => {
  const url = new URL(
    buildGoogleAuthUrl({
      clientId: 'cliente',
      redirectUri: 'http://localhost:3000/api/auth/google/callback',
      state: 'estado-aleatorio',
      codeChallenge: 'desafio',
    }),
  );

  it('pede apenas escopos de leitura', () => {
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SCOPES.join(' '));
    expect(url.searchParams.get('scope')).not.toContain('modify');
  });

  it('usa PKCE com S256', () => {
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('desafio');
  });

  it('garante refresh_token com access_type offline e consent', () => {
    // Sem isso o Google so devolve refresh_token na primeira autorizacao.
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });
});

describe('buildMicrosoftAuthUrl', () => {
  it('usa tenant common por padrao, aceitando conta pessoal e corporativa', () => {
    const url = buildMicrosoftAuthUrl({
      clientId: 'cliente',
      redirectUri: 'http://localhost:3000/api/auth/microsoft/callback',
      state: 'estado',
      codeChallenge: 'desafio',
    });
    expect(url).toContain('/common/oauth2/v2.0/authorize');
  });

  it('pede offline_access para conseguir renovar o token', () => {
    const url = new URL(
      buildMicrosoftAuthUrl({
        clientId: 'cliente',
        redirectUri: 'http://localhost:3000/cb',
        state: 'estado',
        codeChallenge: 'desafio',
        tenant: 'contoso',
      }),
    );
    expect(url.searchParams.get('scope')).toContain('offline_access');
    expect(url.pathname).toContain('/contoso/');
  });
});

describe('mapeamento de erro dos provedores', () => {
  it('traduz 410 do Google para cursor expirado, nao para falha', () => {
    expect(mapGoogleError(410).code).toBe('CURSOR_EXPIRED');
    expect(mapMicrosoftError(410).code).toBe('CURSOR_EXPIRED');
  });

  it('traduz 401 para reautenticacao', () => {
    expect(mapGoogleError(401).code).toBe('AUTH_EXPIRED');
    expect(mapMicrosoftError(401).code).toBe('AUTH_EXPIRED');
  });

  it('propaga o Retry-After do rate limit', () => {
    expect(mapMicrosoftError(429, '90').retryAfterSeconds).toBe(90);
    expect(mapGoogleError(429, null).retryAfterSeconds).toBe(30);
  });

  it('trata 5xx como transitorio e 4xx desconhecido como permanente', () => {
    expect(mapGoogleError(503).code).toBe('TRANSIENT');
    expect(mapGoogleError(400).code).toBe('PERMANENT');
  });
});

describe('autodiscovery IMAP/CalDAV', () => {
  it('reconhece os dominios do iCloud e aplica o preset da Apple', () => {
    for (const dominio of ['icloud.com', 'me.com', 'MAC.COM']) {
      expect(guessConfigForDomain(dominio)).toEqual(APPLE_PRESET);
    }
  });

  it('adivinha por convencao em dominios desconhecidos', () => {
    const config = guessConfigForDomain('meudominio.com.br');
    expect(config.imapHost).toBe('imap.meudominio.com.br');
    expect(config.imapSecure).toBe(true);
    expect(config.caldavUrl).toContain('/.well-known/caldav');
  });

  it('extrai o dominio de enderecos com arroba no nome', () => {
    expect(domainFromEmail('nome"@"estranho@Exemplo.COM')).toBe('exemplo.com');
    expect(() => domainFromEmail('sem-arroba')).toThrow();
  });
});

describe('capacidade de anexo — declarada, não assumida', () => {
  it('Google e Microsoft declaram que sabem baixar anexo', () => {
    // O painel financeiro consulta a capacidade e só tenta onde ela é
    // verdadeira; o núcleo não ramifica por provedor.
    expect(googleConnector.capabilities.attachments).toBe(true);
    expect(typeof googleConnector.fetchAttachments).toBe('function');
    expect(microsoftConnector.capabilities.attachments).toBe(true);
    expect(typeof microsoftConnector.fetchAttachments).toBe('function');
  });

  it('IMAP/CalDAV declara FALSE — e é honesto sobre por quê', () => {
    // O protocolo sabe baixar parte de mensagem, mas este conector nunca
    // foi validado contra servidor real. Declarar false faz o painel
    // simplesmente não tentar, em vez de tentar e falhar em silêncio.
    expect(imapCaldavConnector.capabilities.attachments).toBe(false);
  });

  it('nenhum conector ganhou capacidade de ESCRITA junto', () => {
    // Anexo é leitura. Se algum passar a declarar write:true, é fase 4 e
    // exige consentimento OAuth novo — este teste obriga a decisão a ser
    // explícita.
    for (const conector of [googleConnector, microsoftConnector, imapCaldavConnector]) {
      expect(conector.capabilities.write).toBe(false);
    }
  });
});
