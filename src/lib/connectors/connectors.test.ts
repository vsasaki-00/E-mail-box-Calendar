import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGoogleAuthUrl, createPkcePair, mapGoogleError, GOOGLE_SCOPES } from './google';
import { buildMicrosoftAuthUrl, mapMicrosoftError, MICROSOFT_SCOPES } from './microsoft';
import { detalheDoGraph } from './microsoft-errors';
import { detalheDoGoogle } from './google-errors';
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

  it('o escopo de LEITURA continua sendo o padrão de toda conexão nova', () => {
    // Fase 4 adicionou escrita, mas ela é um consentimento SEPARADO. Pedir
    // escopo de escrita "para talvez usar depois" continua sendo o que a
    // política de segurança proíbe. Ver docs/04-seguranca.md
    for (const escopo of GOOGLE_SCOPES) {
      expect(escopo).not.toMatch(/\.send|gmail\.modify|calendar\.events|mail\.google\.com/i);
    }
    for (const escopo of MICROSOFT_SCOPES) {
      expect(escopo).not.toMatch(/ReadWrite|Mail\.Send/i);
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
    // `consent` garante o refresh_token; `select_account` garante que a
    // segunda e a terceira caixa nao virem uma copia da primeira.
    expect(url.searchParams.get('prompt')).toBe('consent select_account');
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

  it('forca a escolha de conta, senao o SSO reusa a sessao corporativa', () => {
    const url = new URL(
      buildMicrosoftAuthUrl({
        clientId: 'cliente',
        redirectUri: 'http://localhost:3000/cb',
        state: 'estado',
        codeChallenge: 'desafio',
      }),
    );
    expect(url.searchParams.get('prompt')).toBe('select_account');
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

  it('IMAP/CalDAV continua sem escrever', () => {
    // Nunca foi validado contra servidor real; declarar escrita faria o app
    // tentar e falhar em silêncio numa caixa Apple.
    expect(imapCaldavConnector.capabilities.write).toBe(false);
  });
});

describe('fase 4 — escrita é do CONECTOR, permissão é da CONEXÃO', () => {
  it('Google e Microsoft sabem escrever e implementam as ações', () => {
    for (const conector of [googleConnector, microsoftConnector]) {
      expect(conector.capabilities.write).toBe(true);
      for (const metodo of [
        'archiveMessage',
        'unarchiveMessage',
        'setMessageRead',
        'setMessageLabel',
        'respondToEvent',
        'moveEvent',
        'createEvent',
        'sendReply',
      ] as const) {
        expect(typeof conector[metodo]).toBe('function');
      }
    }
  });

  it('NENHUM conector implementa exclusão', () => {
    // A ausência é a garantia. Arquivar resolve o mesmo problema e volta
    // atrás; apagar é o único erro que você nunca descobre.
    for (const conector of allConnectors()) {
      const nomes = Object.keys(conector);
      expect(nomes.filter((n) => /delete|trash|purge|destroy|erase/i.test(n))).toEqual([]);
    }
  });

  it('a conexão nasce SEM escrita, no schema', () => {
    // A trava real não é o catálogo de ações: é `writeEnabled` nascer falso
    // e só mudar depois de você reautorizar aquela caixa. Se o default
    // virar true, este teste quebra antes de qualquer caixa ser afetada.
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    expect(schema).toMatch(/writeEnabled\s+Boolean\s+@default\(false\)/);
  });
});

describe('detalhe do corpo de erro do provedor', () => {
  it('extrai code e message do Graph', () => {
    // Formato real do Graph. "Erro 400 no Graph" sozinho nao diagnostica
    // nada — foi o que apareceu no primeiro sync de uma caixa Outlook.
    const corpo = JSON.stringify({
      error: { code: 'ErrorInvalidUser', message: 'The requested user is invalid.' },
    });
    expect(detalheDoGraph(corpo)).toBe('ErrorInvalidUser: The requested user is invalid.');
  });

  it('extrai status e message do Google', () => {
    const corpo = JSON.stringify({
      error: { code: 400, message: 'Invalid pageToken', status: 'INVALID_ARGUMENT' },
    });
    expect(detalheDoGoogle(corpo)).toBe('INVALID_ARGUMENT: Invalid pageToken');
  });

  it('nao quebra com corpo vazio, HTML de gateway ou JSON estranho', () => {
    for (const extrator of [detalheDoGraph, detalheDoGoogle]) {
      expect(extrator(undefined)).toBeUndefined();
      expect(extrator('')).toBeUndefined();
      // Pagina de erro de proxy nao ajuda ninguem; melhor a mensagem generica.
      expect(extrator('<html><body>502 Bad Gateway</body></html>')).toBeUndefined();
      expect(extrator('{"algo":"sem campo error"}')).toBeUndefined();
    }
  });

  it('trunca mensagem muito longa em vez de encher a tela', () => {
    const corpo = JSON.stringify({ error: { code: 'X', message: 'y'.repeat(900) } });
    const saida = detalheDoGraph(corpo)!;
    expect(saida.length).toBeLessThanOrEqual(301);
    expect(saida.endsWith('…')).toBe(true);
  });

  it('anexa o detalhe a mensagem do erro mapeado', () => {
    const erro = mapMicrosoftError(
      400,
      null,
      JSON.stringify({ error: { code: 'ErrorInvalidIdMalformed', message: 'Id is malformed.' } }),
    );
    expect(erro.message).toContain('ErrorInvalidIdMalformed');
    // E continua classificando pelo status, nao pelo texto.
    expect(erro.code).toBe('PERMANENT');
  });
});
