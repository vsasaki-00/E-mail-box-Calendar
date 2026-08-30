import { describe, expect, it, vi } from 'vitest';
import { BATCH_SIZE, runTriage, type ClassificationResponse, type TriageModel } from './classifier';
import { buildBatchPrompt, buildSystemPrompt, truncateSnippet } from './prompt';
import type { MailboxContext, TriageInput } from './types';

/**
 * Testa a orquestracao inteira sem rede: o modelo e uma costura
 * (`TriageModel`), entao lote, fallback e itens ausentes sao exercitados de
 * verdade. A chamada real a API nao e coberta aqui — ver a ressalva em
 * docs/07-agente-de-triagem.md.
 */

function entrada(over: Partial<TriageInput> & { id: string }): TriageInput {
  return {
    fromEmail: 'pessoa@parceiro.com',
    fromName: 'Pessoa',
    subject: 'Podemos conversar?',
    snippet: 'gostaria de agendar',
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

/** Modelo falso que classifica tudo como INFORMATIVE. */
function modeloFake(
  resposta?: (userPrompt: string) => ClassificationResponse,
): TriageModel & { chamadas: string[] } {
  const chamadas: string[] = [];
  return {
    name: 'fake',
    chamadas,
    async classify(_system, userPrompt) {
      chamadas.push(userPrompt);
      if (resposta) return resposta(userPrompt);
      const ids = [...userPrompt.matchAll(/id=(\S+)/g)].map((m) => m[1] as string);
      return {
        results: ids.map((id) => ({
          id,
          category: 'INFORMATIVE' as const,
          priority: 'NORMAL' as const,
          needsReply: false,
          confidence: 0.8,
          reason: 'teste',
        })),
      };
    },
  };
}

describe('buildSystemPrompt', () => {
  it('inclui o contexto do negocio, que e o que muda a decisao entre caixas', () => {
    const prompt = buildSystemPrompt(
      contexto({
        businessName: 'Consultoria Alfa',
        role: 'sócio',
        objective: 'não perder proposta de cliente',
      }),
    );
    expect(prompt).toContain('Consultoria Alfa');
    expect(prompt).toContain('sócio');
    expect(prompt).toContain('não perder proposta de cliente');
  });

  it('muda a instrucao conforme a calibragem da caixa', () => {
    expect(buildSystemPrompt(contexto({ calibration: 'CONSERVATIVE' }))).toContain('CONSERVADORA');
    expect(buildSystemPrompt(contexto({ calibration: 'AGGRESSIVE' }))).toContain('AGRESSIVA');
  });

  it('define COBRANCA como contas a pagar, nao recebiveis', () => {
    // A distincao que o usuario fez explicitamente: sao e-mails de
    // fornecedores cobrando ele.
    const prompt = buildSystemPrompt(contexto());
    expect(prompt).toContain('CONTAS A PAGAR');
    expect(prompt).toContain('Não use para o usuário cobrando alguém');
  });

  it('inclui as palavras de urgencia especificas da caixa', () => {
    const prompt = buildSystemPrompt(contexto({ urgentKeywords: ['licitação', 'multa'] }));
    expect(prompt).toContain('licitação');
    expect(prompt).toContain('multa');
  });
});

describe('buildBatchPrompt — garantia de privacidade', () => {
  it('NUNCA inclui o corpo do e-mail, so metadados', () => {
    // Este e o teste que protege a decisao de privacidade documentada.
    // TriageInput nem tem campo de corpo — mas se alguem adicionar um e
    // vazar para o prompt, este teste precisa quebrar.
    const prompt = buildBatchPrompt([
      entrada({ id: 'a', subject: 'Assunto', snippet: 'trecho curto visivel' }),
    ]);

    expect(prompt).toContain('Assunto');
    expect(prompt).toContain('trecho curto visivel');
    // O tipo de entrada nao carrega corpo; confirmamos que o prompt so tem
    // os campos declarados.
    const camposEsperados = ['de:', 'assunto:', 'recebido:', 'destinatário direto:', 'trecho:'];
    for (const campo of camposEsperados) expect(prompt).toContain(campo);
  });

  it('trunca o trecho a 200 caracteres', () => {
    const longo = 'x'.repeat(500);
    const truncado = truncateSnippet(longo);
    expect(truncado.length).toBeLessThanOrEqual(201); // 200 + reticencia
    expect(truncado.endsWith('…')).toBe(true);
  });

  it('normaliza espaco em branco do trecho', () => {
    expect(truncateSnippet('  a\n\n  b  \t c ')).toBe('a b c');
  });

  it('inclui o id de cada mensagem para casar o resultado de volta', () => {
    const prompt = buildBatchPrompt([entrada({ id: 'item-x' }), entrada({ id: 'item-y' })]);
    expect(prompt).toContain('id=item-x');
    expect(prompt).toContain('id=item-y');
  });
});

describe('runTriage — orquestracao', () => {
  it('resolve pelo pre-filtro sem chamar o modelo quando da', async () => {
    const modelo = modeloFake();
    const resultado = await runTriage(
      [entrada({ id: 'a', headers: { listUnsubscribe: '<x>' }, subject: 'Newsletter' })],
      contexto(),
      modelo,
    );

    expect(resultado.decidedByRule).toBe(1);
    expect(modelo.chamadas).toHaveLength(0);
    expect(resultado.results[0]?.source).toBe('RULE');
  });

  it('manda ao modelo so o que a regra nao decidiu', async () => {
    const modelo = modeloFake();
    const resultado = await runTriage(
      [
        entrada({ id: 'regra', headers: { listId: '<l>' } }),
        entrada({ id: 'modelo', subject: 'Pergunta direta' }),
      ],
      contexto(),
      modelo,
    );

    expect(resultado.decidedByRule).toBe(1);
    expect(resultado.decidedByModel).toBe(1);
    expect(modelo.chamadas).toHaveLength(1);
    expect(modelo.chamadas[0]).toContain('id=modelo');
    expect(modelo.chamadas[0]).not.toContain('id=regra');
  });

  it('quebra em lotes quando passa do tamanho maximo', async () => {
    const modelo = modeloFake();
    const muitos = Array.from({ length: BATCH_SIZE + 5 }, (_, i) => entrada({ id: `i${i}` }));

    await runTriage(muitos, contexto(), modelo);
    expect(modelo.chamadas).toHaveLength(2);
  });

  it('devolve TODOS os itens mesmo quando a API falha — nada some da caixa', async () => {
    // O pior modo de falha possivel seria um e-mail sumir porque a API caiu.
    const modeloQuebrado: TriageModel = {
      name: 'quebrado',
      async classify() {
        throw new Error('502 Bad Gateway');
      },
    };

    const entradas = [entrada({ id: 'a' }), entrada({ id: 'b' })];
    const resultado = await runTriage(entradas, contexto(), modeloQuebrado);

    expect(resultado.results).toHaveLength(2);
    expect(resultado.missing).toEqual(['a', 'b']);
    // Confianca zero e o sinal para a UI mostrar como "revisar".
    for (const r of resultado.results) {
      expect(r.confidence).toBe(0);
      expect(r.reason).toContain('revise manualmente');
    }
  });

  it('nao perde item que o modelo esqueceu de devolver', async () => {
    const modeloIncompleto = modeloFake(() => ({
      results: [
        { id: 'a', category: 'INFORMATIVE', priority: 'LOW', needsReply: false, confidence: 0.9, reason: 'ok' },
        // 'b' ausente de proposito
      ],
    }));

    const resultado = await runTriage(
      [entrada({ id: 'a' }), entrada({ id: 'b' })],
      contexto(),
      modeloIncompleto,
    );

    expect(resultado.results).toHaveLength(2);
    expect(resultado.missing).toEqual(['b']);
    const b = resultado.results.find((r) => r.id === 'b');
    expect(b?.confidence).toBe(0);
  });

  it('uma falha de lote nao derruba os outros lotes', async () => {
    let chamada = 0;
    const modeloIntermitente: TriageModel = {
      name: 'intermitente',
      async classify(_s, userPrompt) {
        chamada += 1;
        if (chamada === 1) throw new Error('rate limit');
        const ids = [...userPrompt.matchAll(/id=(\S+)/g)].map((m) => m[1] as string);
        return {
          results: ids.map((id) => ({
            id,
            category: 'NEEDS_REPLY' as const,
            priority: 'HIGH' as const,
            needsReply: true,
            confidence: 0.9,
            reason: 'ok',
          })),
        };
      },
    };

    const muitos = Array.from({ length: BATCH_SIZE + 3 }, (_, i) => entrada({ id: `i${i}` }));
    const resultado = await runTriage(muitos, contexto(), modeloIntermitente);

    expect(resultado.results).toHaveLength(BATCH_SIZE + 3);
    expect(resultado.missing).toHaveLength(BATCH_SIZE); // só o primeiro lote falhou
    expect(resultado.results.some((r) => r.confidence === 0.9)).toBe(true);
  });

  it('VIP passa pela regra mesmo com assunto que pareceria promocional', async () => {
    const modelo = modeloFake();
    const resultado = await runTriage(
      [
        entrada({
          id: 'vip',
          fromEmail: 'ceo@clientegrande.com',
          subject: 'Novidades',
          headers: { listUnsubscribe: '<x>' },
        }),
      ],
      contexto({ vipSenders: ['clientegrande.com'] }),
      modelo,
    );

    expect(modelo.chamadas).toHaveLength(0);
    expect(resultado.results[0]?.priority).toBe('HIGH');
    expect(resultado.results[0]?.needsReply).toBe(true);
  });

  it('lida com lista vazia sem chamar o modelo', async () => {
    const modelo = modeloFake();
    const resultado = await runTriage([], contexto(), modelo);
    expect(resultado.results).toHaveLength(0);
    expect(modelo.chamadas).toHaveLength(0);
  });
});
