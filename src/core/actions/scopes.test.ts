import { describe, expect, it } from 'vitest';
import { evaluateWriteGrant } from './scopes';
import { GOOGLE_WRITE_SCOPES } from '@/lib/connectors/google';

describe('evaluateWriteGrant — o que o provedor CONCEDEU, não o que pedimos', () => {
  const GOOGLE_COMPLETO = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  it('libera quando todos os escopos de escrita vieram', () => {
    expect(evaluateWriteGrant('GOOGLE', GOOGLE_COMPLETO).enabled).toBe(true);
  });

  it('NÃO libera quando o usuário desmarcou uma permissão', () => {
    // O erro clássico: confiar no que foi pedido. O Google deixa desmarcar
    // permissões na tela de consentimento e o fluxo continua com sucesso —
    // o app acharia que pode escrever e falharia na hora de executar.
    const semEnvio = GOOGLE_COMPLETO.filter((e) => !e.endsWith('gmail.send'));
    const grant = evaluateWriteGrant('GOOGLE', semEnvio);

    expect(grant.enabled).toBe(false);
    expect(grant.missing).toContain('https://www.googleapis.com/auth/gmail.send');
  });

  it('sem informação de escopo, a resposta é NÃO', () => {
    // Presumir autorização quando o provedor não disse nada inverteria o
    // ônus na direção errada.
    expect(evaluateWriteGrant('GOOGLE', undefined).enabled).toBe(false);
    expect(evaluateWriteGrant('GOOGLE', []).enabled).toBe(false);
  });

  it('só leitura continua sendo só leitura', () => {
    expect(
      evaluateWriteGrant('GOOGLE', [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/calendar.readonly',
      ]).enabled,
    ).toBe(false);
  });

  it('aceita a forma que o Microsoft devolve (URI completa e caixa variável)', () => {
    // Graph devolve "https://graph.microsoft.com/Mail.ReadWrite". Comparar
    // sem normalizar viraria um "não autorizado" que é só diferença de
    // caixa.
    const grant = evaluateWriteGrant('MICROSOFT', [
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/Mail.Send',
      'https://graph.microsoft.com/Calendars.ReadWrite',
      'https://graph.microsoft.com/User.Read',
    ]);
    expect(grant.enabled).toBe(true);
  });

  it('aceita também a forma curta do Microsoft', () => {
    expect(
      evaluateWriteGrant('MICROSOFT', ['Mail.ReadWrite', 'Mail.Send', 'Calendars.ReadWrite'])
        .enabled,
    ).toBe(true);
  });

  it('faltando um marcador, recusa e diz qual', () => {
    // Falhar depois que você confirma é pior do que recusar antes.
    const grant = evaluateWriteGrant('MICROSOFT', ['Mail.ReadWrite', 'Mail.Send']);
    expect(grant.enabled).toBe(false);
    expect(grant.missing).toEqual(['calendars.readwrite']);
  });
});

describe('reconectar em leitura reflete a perda da escrita', () => {
  /**
   * O caso real: quatro caixas ficaram com `writeEnabled` verdadeiro depois
   * de autorizar escrita. Reconectar em modo leitura revoga a escrita NO
   * PROVEDOR — se a flag continuasse ligada, a tela diria "escrita
   * autorizada" com um token que nao escreve, e a acao so falharia na hora
   * de executar, depois de voce confirmar.
   */
  it('escopos de leitura devolvem enabled=false', () => {
    const leitura = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ];
    expect(evaluateWriteGrant('GOOGLE', leitura).enabled).toBe(false);
  });

  it('o conjunto de ESCRITA atual continua habilitando a escrita', () => {
    // Guarda o conserto do calendar.readonly: acrescentar um escopo de
    // leitura ao conjunto de escrita nao pode desabilitar a escrita.
    expect(evaluateWriteGrant('GOOGLE', [...GOOGLE_WRITE_SCOPES]).enabled).toBe(true);
  });

  it('sem informacao de escopo, nao decide nada', () => {
    // O callback so aplica o resultado quando `grantedScopes` existe; aqui
    // fica registrado por que o padrao e false.
    expect(evaluateWriteGrant('GOOGLE', undefined).enabled).toBe(false);
  });
});
