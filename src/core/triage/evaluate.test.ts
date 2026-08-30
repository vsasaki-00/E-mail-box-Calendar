import { describe, expect, it } from 'vitest';
import {
  deriveLabel,
  evaluateTriage,
  meetsAcceptanceCriteria,
  type GroundTruthLabel,
  type ObservedBehavior,
} from './evaluate';
import type { TriageResult } from './types';

function comportamento(over: Partial<ObservedBehavior> & { id: string }): ObservedBehavior {
  return {
    wasRepliedTo: false,
    wasRead: false,
    wasArchivedOrDeleted: false,
    wasInSpamFolder: false,
    ...over,
  };
}

function predicao(over: Partial<TriageResult> & { id: string }): TriageResult {
  return {
    category: 'INFORMATIVE',
    priority: 'NORMAL',
    needsReply: false,
    confidence: 0.8,
    reason: 'teste',
    source: 'MODEL',
    ...over,
  };
}

describe('deriveLabel — gabarito derivado do comportamento', () => {
  it('resposta enviada e o sinal mais forte de "precisava resposta"', () => {
    const label = deriveLabel(comportamento({ id: 'a', wasRepliedTo: true, wasRead: true }));
    expect(label.needsReply).toBe(true);
    expect(label.category).toBe('NEEDS_REPLY');
  });

  it('deriva prioridade da velocidade da resposta', () => {
    expect(deriveLabel(comportamento({ id: 'a', wasRepliedTo: true, hoursToReply: 1 })).priority).toBe(
      'URGENT',
    );
    expect(deriveLabel(comportamento({ id: 'b', wasRepliedTo: true, hoursToReply: 12 })).priority).toBe(
      'HIGH',
    );
    expect(deriveLabel(comportamento({ id: 'c', wasRepliedTo: true, hoursToReply: 100 })).priority).toBe(
      'NORMAL',
    );
  });

  it('nao inventa prioridade quando nao sabe quanto tempo levou', () => {
    const label = deriveLabel(comportamento({ id: 'a', wasRepliedTo: true, hoursToReply: null }));
    expect(label.needsReply).toBe(true);
    expect(label.priority).toBeNull();
  });

  it('pasta de spam do provedor e gabarito direto', () => {
    const label = deriveLabel(comportamento({ id: 'a', wasInSpamFolder: true }));
    expect(label.category).toBe('SPAM');
    expect(label.needsReply).toBe(false);
  });

  it('arquivado sem abrir e descartavel com alta confianca', () => {
    const label = deriveLabel(
      comportamento({ id: 'a', wasArchivedOrDeleted: true, wasRead: false }),
    );
    expect(label.category).toBe('DISPOSABLE');
  });

  it('lido e arquivado sem responder afirma so o que sustenta', () => {
    // Sabemos que nao precisava de resposta. NAO sabemos se era informativo,
    // promocional ou cobranca ja paga — entao categoria fica nula.
    const label = deriveLabel(comportamento({ id: 'a', wasRead: true, wasArchivedOrDeleted: true }));
    expect(label.needsReply).toBe(false);
    expect(label.category).toBeNull();
  });

  it('item ainda na caixa sem resposta e ambiguo, e fica nulo', () => {
    // Pode ser pendencia real ou item ignorado. Chutar aqui produziria uma
    // metrica bonita e falsa.
    const label = deriveLabel(comportamento({ id: 'a', wasRead: true }));
    expect(label.needsReply).toBeNull();
    expect(label.category).toBeNull();
  });

  it('spam vence resposta: item na pasta de spam nao vira NEEDS_REPLY', () => {
    const label = deriveLabel(
      comportamento({ id: 'a', wasInSpamFolder: true, wasRepliedTo: true }),
    );
    expect(label.category).toBe('SPAM');
  });
});

describe('evaluateTriage', () => {
  it('mede concordancia em "precisa resposta" e separa os dois tipos de erro', () => {
    const predicoes = [
      predicao({ id: 'a', needsReply: true }),
      predicao({ id: 'b', needsReply: false }),
      predicao({ id: 'c', needsReply: true }), // falso positivo
      predicao({ id: 'd', needsReply: false }), // falso negativo
    ];
    const gabaritos: GroundTruthLabel[] = [
      { id: 'a', needsReply: true, category: null, priority: null },
      { id: 'b', needsReply: false, category: null, priority: null },
      { id: 'c', needsReply: false, category: null, priority: null },
      { id: 'd', needsReply: true, category: null, priority: null },
    ];

    const report = evaluateTriage(predicoes, gabaritos);
    expect(report.needsReply.evaluated).toBe(4);
    expect(report.needsReply.agreed).toBe(2);
    expect(report.needsReply.accuracy).toBe(0.5);
    expect(report.needsReply.falsePositives).toEqual(['c']);
    expect(report.needsReply.falseNegatives).toEqual(['d']);
  });

  it('ignora predicoes sem gabarito em vez de conta-las como erro', () => {
    const report = evaluateTriage(
      [predicao({ id: 'a', needsReply: true }), predicao({ id: 'sem-gabarito' })],
      [{ id: 'a', needsReply: true, category: null, priority: null }],
    );
    expect(report.needsReply.evaluated).toBe(1);
    expect(report.needsReply.accuracy).toBe(1);
  });

  it('devolve acuracia nula, nao zero, quando nao ha caso avaliavel', () => {
    // Zero seria enganoso: significaria "errou tudo" em vez de "nao mediu".
    const report = evaluateTriage([predicao({ id: 'a' })], []);
    expect(report.needsReply.accuracy).toBeNull();
    expect(report.category.accuracy).toBeNull();
  });

  it('destaca o erro assimetrico: escondeu algo que o usuario respondeu', () => {
    const report = evaluateTriage(
      [
        predicao({ id: 'perigoso', category: 'SPAM' }),
        predicao({ id: 'tambem', category: 'DISPOSABLE' }),
        predicao({ id: 'ok', category: 'PROMOTIONAL' }),
      ],
      [
        { id: 'perigoso', needsReply: true, category: 'NEEDS_REPLY', priority: null },
        { id: 'tambem', needsReply: true, category: 'NEEDS_REPLY', priority: null },
        { id: 'ok', needsReply: false, category: 'DISPOSABLE', priority: null },
      ],
    );

    expect(report.dangerousMisses).toEqual(['perigoso', 'tambem']);
  });

  it('lista as discordancias de categoria com predito e real', () => {
    const report = evaluateTriage(
      [predicao({ id: 'a', category: 'PROMOTIONAL' })],
      [{ id: 'a', needsReply: null, category: 'COBRANCA', priority: null }],
    );
    expect(report.category.disagreements).toEqual([
      { id: 'a', predicted: 'PROMOTIONAL', actual: 'COBRANCA' },
    ]);
  });
});

describe('meetsAcceptanceCriteria', () => {
  it('reprova quando a acuracia fica abaixo do minimo', () => {
    const report = evaluateTriage(
      [
        predicao({ id: 'a', needsReply: true }),
        predicao({ id: 'b', needsReply: true }),
        predicao({ id: 'c', needsReply: true }),
      ],
      [
        { id: 'a', needsReply: true, category: null, priority: null },
        { id: 'b', needsReply: false, category: null, priority: null },
        { id: 'c', needsReply: false, category: null, priority: null },
      ],
    );
    const veredito = meetsAcceptanceCriteria(report);
    expect(veredito.passed).toBe(false);
    expect(veredito.reasons[0]).toContain('abaixo do mínimo');
  });

  it('reprova com QUALQUER item escondido que foi respondido, por mais alta que seja a acuracia', () => {
    // A barreira que nao negocia: 95% de acerto escondendo um e-mail de
    // cliente e pior que 85% que nunca esconde.
    const predicoes = Array.from({ length: 20 }, (_, i) =>
      predicao({ id: `ok${i}`, needsReply: false }),
    );
    const gabaritos: GroundTruthLabel[] = Array.from({ length: 20 }, (_, i) => ({
      id: `ok${i}`,
      needsReply: false,
      category: null,
      priority: null,
    }));

    predicoes.push(predicao({ id: 'escondido', category: 'SPAM', needsReply: false }));
    gabaritos.push({ id: 'escondido', needsReply: false, category: 'NEEDS_REPLY', priority: null });

    const report = evaluateTriage(predicoes, gabaritos);
    expect(report.needsReply.accuracy).toBe(1);

    const veredito = meetsAcceptanceCriteria(report);
    expect(veredito.passed).toBe(false);
    expect(veredito.reasons.some((r) => r.includes('não pode acontecer'))).toBe(true);
  });

  it('reprova quando nao houve historico suficiente para medir', () => {
    const veredito = meetsAcceptanceCriteria(evaluateTriage([], []));
    expect(veredito.passed).toBe(false);
    expect(veredito.reasons[0]).toContain('histórico insuficiente');
  });

  it('aprova quando a acuracia passa e nada foi escondido indevidamente', () => {
    const predicoes = Array.from({ length: 10 }, (_, i) =>
      predicao({ id: `i${i}`, needsReply: i < 5, category: i < 5 ? 'NEEDS_REPLY' : 'INFORMATIVE' }),
    );
    const gabaritos: GroundTruthLabel[] = Array.from({ length: 10 }, (_, i) => ({
      id: `i${i}`,
      needsReply: i < 5,
      category: null,
      priority: null,
    }));

    const veredito = meetsAcceptanceCriteria(evaluateTriage(predicoes, gabaritos));
    expect(veredito.passed).toBe(true);
    expect(veredito.reasons).toHaveLength(0);
  });
});
