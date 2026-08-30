import { describe, expect, it } from 'vitest';
import {
  isAutoSubmitted,
  isBulkMail,
  isNoReplyAddress,
  isVipSender,
  pareceCobranca,
  prefilter,
} from './prefilter';
import type { MailboxContext, TriageInput } from './types';

function entrada(over: Partial<TriageInput> = {}): TriageInput {
  return {
    id: 'item-1',
    fromEmail: 'alguem@fornecedor.com',
    fromName: 'Alguem',
    subject: 'Assunto qualquer',
    snippet: 'trecho',
    receivedAt: new Date('2026-08-30T10:00:00Z'),
    hasAttachments: false,
    isDirectRecipient: true,
    recipientCount: 1,
    ...over,
  };
}

function contexto(over: Partial<MailboxContext> = {}): MailboxContext {
  return {
    calibration: 'BALANCED',
    vipSenders: [],
    urgentKeywords: [],
    accountEmail: 'eu@meunegocio.com',
    ...over,
  };
}

describe('isVipSender', () => {
  it('casa endereco exato, ignorando caixa', () => {
    expect(isVipSender('Cliente@Grande.com', ['cliente@grande.com'])).toBe(true);
  });

  it('casa por dominio quando a entrada nao tem arroba', () => {
    expect(isVipSender('qualquer@clientegrande.com', ['clientegrande.com'])).toBe(true);
    expect(isVipSender('qualquer@outro.com', ['clientegrande.com'])).toBe(false);
  });

  it('aceita entrada de dominio escrita com arroba na frente', () => {
    expect(isVipSender('joao@empresa.com', ['@empresa.com'])).toBe(true);
  });

  it('extrai o endereco de um cabecalho com nome de exibicao', () => {
    expect(isVipSender('Joao Silva <joao@empresa.com>', ['joao@empresa.com'])).toBe(true);
  });

  it('nao casa dominio parcial', () => {
    // "empresa.com" nao pode casar "naoempresa.com".
    expect(isVipSender('x@naoempresa.com', ['empresa.com'])).toBe(false);
  });

  it('lida com lista vazia e remetente ausente', () => {
    expect(isVipSender('a@b.com', [])).toBe(false);
    expect(isVipSender(null, ['a@b.com'])).toBe(false);
  });
});

describe('isBulkMail', () => {
  it('reconhece List-Unsubscribe e List-Id', () => {
    expect(isBulkMail(entrada({ headers: { listUnsubscribe: '<mailto:x@y.com>' } }))).toBe(true);
    expect(isBulkMail(entrada({ headers: { listId: '<lista.exemplo.com>' } }))).toBe(true);
  });

  it('reconhece Precedence de difusao', () => {
    for (const valor of ['bulk', 'list', 'junk', 'BULK']) {
      expect(isBulkMail(entrada({ headers: { precedence: valor } }))).toBe(true);
    }
  });

  it('nao acusa difusao sem cabecalho nenhum', () => {
    expect(isBulkMail(entrada())).toBe(false);
    expect(isBulkMail(entrada({ headers: { precedence: 'normal' } }))).toBe(false);
  });
});

describe('isAutoSubmitted', () => {
  it('trata "no" como nao-automatico, conforme a RFC 3834', () => {
    expect(isAutoSubmitted(entrada({ headers: { autoSubmitted: 'no' } }))).toBe(false);
    expect(isAutoSubmitted(entrada({ headers: { autoSubmitted: 'auto-replied' } }))).toBe(true);
    expect(isAutoSubmitted(entrada({ headers: { autoSubmitted: 'auto-generated' } }))).toBe(true);
  });
});

describe('isNoReplyAddress', () => {
  it('reconhece as variacoes comuns, em ingles e portugues', () => {
    for (const email of [
      'noreply@x.com',
      'no-reply@x.com',
      'no_reply@x.com',
      'donotreply@x.com',
      'nao-responda@x.com.br',
      'NoReply@X.com',
    ]) {
      expect(isNoReplyAddress(email)).toBe(true);
    }
  });

  it('nao confunde com endereco legitimo que contem "no"', () => {
    expect(isNoReplyAddress('nogueira@empresa.com')).toBe(false);
    expect(isNoReplyAddress('financeiro@empresa.com')).toBe(false);
  });
});

describe('pareceCobranca', () => {
  it('reconhece termos de cobranca em portugues, com e sem acento', () => {
    expect(pareceCobranca(entrada({ subject: 'Seu boleto vence amanha' }))).toBe(true);
    expect(pareceCobranca(entrada({ subject: 'Fatura de agosto disponivel' }))).toBe(true);
    expect(pareceCobranca(entrada({ subject: 'Linha digitável para pagamento' }))).toBe(true);
    expect(pareceCobranca(entrada({ snippet: 'segue a nota fiscal em anexo' }))).toBe(true);
  });

  it('reconhece cobranca de assinatura', () => {
    expect(pareceCobranca(entrada({ subject: 'Sua assinatura renovada' }))).toBe(true);
    expect(pareceCobranca(entrada({ subject: 'Mensalidade do plano' }))).toBe(true);
  });

  it('nao dispara em assunto comum', () => {
    expect(pareceCobranca(entrada({ subject: 'Reuniao de segunda', snippet: 'podemos as 14h?' }))).toBe(
      false,
    );
  });
});

describe('prefilter — precedencia das regras', () => {
  it('VIP vence envio em massa: cliente importante nunca vira promocional', () => {
    // O caso que quebraria a confianca: cliente que manda por ferramenta com
    // List-Unsubscribe sendo rebaixado a newsletter.
    const resultado = prefilter(
      entrada({
        fromEmail: 'diretor@clientegrande.com',
        headers: { listUnsubscribe: '<mailto:sair@ferramenta.com>' },
      }),
      contexto({ vipSenders: ['clientegrande.com'] }),
    );

    expect(resultado?.category).toBe('NEEDS_REPLY');
    expect(resultado?.priority).toBe('HIGH');
    expect(resultado?.needsReply).toBe(true);
  });

  it('classifica envio em massa como PROMOCIONAL, nunca como SPAM', () => {
    // Newsletter que o usuario assinou nao e spam. Marcar como spam treina
    // o usuario a desconfiar da triagem inteira.
    const resultado = prefilter(
      entrada({ subject: 'Novidades da semana', headers: { listUnsubscribe: '<x>' } }),
      contexto(),
    );
    expect(resultado?.category).toBe('PROMOTIONAL');
    expect(resultado?.needsReply).toBe(false);
  });

  it('deixa cobranca com List-Unsubscribe passar para o modelo', () => {
    // Cobranca de assinatura costuma vir por ferramenta de disparo. Se a
    // regra a descartasse como promocional, o painel financeiro perderia.
    const resultado = prefilter(
      entrada({ subject: 'Sua fatura de agosto venceu', headers: { listUnsubscribe: '<x>' } }),
      contexto(),
    );
    expect(resultado).toBeNull();
  });

  it('deixa cobranca de no-reply passar para o modelo', () => {
    const resultado = prefilter(
      entrada({ fromEmail: 'noreply@fornecedor.com', subject: 'Boleto disponivel' }),
      contexto(),
    );
    expect(resultado).toBeNull();
  });

  it('classifica no-reply sem indicio de cobranca como informativo', () => {
    const resultado = prefilter(
      entrada({ fromEmail: 'noreply@app.com', subject: 'Seu login em um novo dispositivo' }),
      contexto(),
    );
    expect(resultado?.category).toBe('INFORMATIVE');
    expect(resultado?.needsReply).toBe(false);
  });

  it('classifica auto-resposta como informativo de baixa prioridade', () => {
    const resultado = prefilter(
      entrada({ subject: 'Ausente do escritorio', headers: { autoSubmitted: 'auto-replied' } }),
      contexto(),
    );
    expect(resultado?.category).toBe('INFORMATIVE');
    expect(resultado?.priority).toBe('LOW');
  });

  it('devolve null para e-mail comum, deixando o modelo decidir', () => {
    expect(
      prefilter(
        entrada({ fromEmail: 'joao@parceiro.com', subject: 'Podemos conversar amanha?' }),
        contexto(),
      ),
    ).toBeNull();
  });

  it('marca toda decisao deterministica com source RULE e alta confianca', () => {
    const resultado = prefilter(entrada({ headers: { listId: '<l>' } }), contexto());
    expect(resultado?.source).toBe('RULE');
    expect(resultado?.confidence).toBeGreaterThan(0.9);
  });
});
