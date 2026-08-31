import { describe, expect, it } from 'vitest';
import {
  ACTION_SPECS,
  canBeRequestedByAgent,
  canBulk,
  checkActionPolicy,
  describeAction,
  isReversible,
  specFor,
  type ActionKind,
} from './policy';

const TODAS = Object.keys(ACTION_SPECS) as ActionKind[];

describe('o catálogo do que o app sabe fazer', () => {
  it('NÃO existe nenhuma ação de excluir', () => {
    // A ausência é deliberada. Arquivar resolve o mesmo problema e volta
    // atrás; apagar é o único erro que você nunca descobre, porque a
    // evidência do erro vai junto. Se alguém adicionar DELETE, este teste
    // quebra e obriga a decisão a ser explícita.
    const suspeitas = TODAS.filter((k) => /delete|apagar|remove_message|trash|purge/i.test(k));
    expect(suspeitas).toEqual([]);
  });

  it('toda ação reversível declara qual é a inversa (ou é neutra)', () => {
    for (const kind of TODAS) {
      const spec = specFor(kind);
      if (spec.risk === 'REVERSIBLE' && spec.inverse === null) {
        // Só "talvez" pode ser reversível sem inversa: voltar dele é
        // escolher aceitar ou recusar, não desfazer.
        expect(kind).toBe('EVENT_TENTATIVE');
      }
    }
  });

  it('as inversas são simétricas', () => {
    for (const kind of TODAS) {
      const inversa = specFor(kind).inverse;
      if (!inversa || kind === 'EVENT_ACCEPT' || kind === 'EVENT_DECLINE') continue;
      expect(specFor(inversa).inverse).toBe(kind);
    }
  });

  it('enviar e criar evento são as irreversíveis', () => {
    expect(isReversible('SEND_REPLY')).toBe(false);
    expect(isReversible('EVENT_CREATE')).toBe(false);
    expect(isReversible('ARCHIVE')).toBe(true);
  });
});

describe('canBulk', () => {
  it('nenhuma ação irreversível entra em lote', () => {
    // Mesmo que alguém marque allowBulk por engano, o risco manda.
    for (const kind of TODAS) {
      if (!isReversible(kind)) expect(canBulk(kind)).toBe(false);
    }
  });

  it('arquivar e marcar lido entram', () => {
    expect(canBulk('ARCHIVE')).toBe(true);
    expect(canBulk('MARK_READ')).toBe(true);
  });

  it('responder convite não entra em lote', () => {
    // Aceitar 20 convites de uma vez é como acabar com a agenda sem olhar.
    expect(canBulk('EVENT_ACCEPT')).toBe(false);
  });
});

describe('canBeRequestedByAgent — a linha entre trabalhar por mim e falar por mim', () => {
  it('o agente pode pedir o que é reversível', () => {
    expect(canBeRequestedByAgent('ARCHIVE')).toBe(true);
    expect(canBeRequestedByAgent('MARK_READ')).toBe(true);
  });

  it('o agente NUNCA pode pedir envio nem criação de evento', () => {
    // São as ações que outras pessoas recebem.
    expect(canBeRequestedByAgent('SEND_REPLY')).toBe(false);
    expect(canBeRequestedByAgent('EVENT_CREATE')).toBe(false);
  });
});

describe('checkActionPolicy', () => {
  const base = {
    kind: 'ARCHIVE' as ActionKind,
    connectionWriteEnabled: true,
    connectorCanWrite: true,
    actor: 'USER' as const,
    stage: 'EXECUTE' as const,
    explicitlyConfirmed: false,
  };

  it('libera uma ação reversível numa caixa autorizada', () => {
    expect(checkActionPolicy(base).allowed).toBe(true);
  });

  it('recusa quando a caixa não autorizou escrita', () => {
    // O consentimento é por caixa: ligar escrita em todas de uma vez seria
    // usar uma permissão que o usuário não deu.
    const check = checkActionPolicy({ ...base, connectionWriteEnabled: false });
    expect(check.refusal).toBe('ESCRITA_NAO_AUTORIZADA');
    expect(check.message).toContain('/conexoes');
  });

  it('recusa quando o conector não sabe escrever', () => {
    expect(checkActionPolicy({ ...base, connectorCanWrite: false }).refusal).toBe(
      'CONECTOR_NAO_SUPORTA',
    );
  });

  it('recusa ação irreversível sem confirmação explícita', () => {
    expect(
      checkActionPolicy({ ...base, kind: 'SEND_REPLY', explicitlyConfirmed: false }).refusal,
    ).toBe('IRREVERSIVEL_SEM_CONFIRMACAO');
  });

  it('libera a irreversível quando você confirma explicitamente', () => {
    expect(
      checkActionPolicy({
        ...base,
        kind: 'SEND_REPLY',
        explicitlyConfirmed: true,
        draftApproved: true,
      }).allowed,
    ).toBe(true);
  });

  it('recusa o AGENTE pedindo envio, mesmo confirmado', () => {
    // A confirmação não transfere autoria: quem pede envio é você.
    expect(
      checkActionPolicy({
        ...base,
        kind: 'SEND_REPLY',
        actor: 'AGENT',
        explicitlyConfirmed: true,
      }).refusal,
    ).toBe('AGENTE_NAO_PODE_PEDIR');
  });

  it('recusa enviar rascunho que você ainda não aprovou', () => {
    // A trava da fase 5D continua valendo depois que a escrita existe.
    const check = checkActionPolicy({
      ...base,
      kind: 'SEND_REPLY',
      explicitlyConfirmed: true,
      draftApproved: false,
    });
    expect(check.refusal).toBe('RASCUNHO_NAO_APROVADO');
    expect(check.message).toContain('/rascunhos');
  });

  it('a caixa não autorizada recusa ANTES de qualquer outra checagem', () => {
    // A ordem importa: a mensagem que o usuário vê tem que ser a acionável.
    const check = checkActionPolicy({
      ...base,
      kind: 'SEND_REPLY',
      connectionWriteEnabled: false,
      actor: 'AGENT',
    });
    expect(check.refusal).toBe('ESCRITA_NAO_AUTORIZADA');
  });
});

describe('describeAction', () => {
  it('diz em português o que vai acontecer', () => {
    expect(describeAction('ARCHIVE', { subject: 'Fatura' })).toContain('não é apagado');
    expect(describeAction('ADD_LABEL', { labelName: 'Financeiro' })).toContain('Financeiro');
  });

  it('avisa que criar e mover evento notificam os convidados', () => {
    expect(describeAction('EVENT_CREATE', { subject: 'Reunião' })).toContain('convidados');
    expect(describeAction('EVENT_MOVE', { newStart: 'quinta 14h' })).toContain('convidados');
  });

  it('a descrição de envio diz que não tem volta', () => {
    const texto = describeAction('SEND_REPLY', { to: 'marina@x.com', subject: 'Re: proposta' });
    expect(texto).toContain('marina@x.com');
    expect(texto).toContain('Não tem volta');
  });

  it('toda ação tem descrição — nenhuma cai em texto vazio', () => {
    for (const kind of TODAS) {
      expect(describeAction(kind).length).toBeGreaterThan(10);
    }
  });
});

describe('stage — enfileirar não é executar', () => {
  const base = {
    kind: 'SEND_REPLY' as ActionKind,
    connectionWriteEnabled: true,
    connectorCanWrite: true,
    actor: 'USER' as const,
  };

  it('ENFILEIRAR ação irreversível é permitido sem confirmação', () => {
    // É o propósito da fila. Exigir confirmação já no pedido impediria a
    // ação de chegar na tela onde você a confirmaria.
    expect(checkActionPolicy({ ...base, stage: 'REQUEST' }).allowed).toBe(true);
  });

  it('EXECUTAR a mesma ação sem confirmação é recusado', () => {
    expect(checkActionPolicy({ ...base, stage: 'EXECUTE' }).refusal).toBe(
      'IRREVERSIVEL_SEM_CONFIRMACAO',
    );
  });

  it('o agente continua não podendo NEM enfileirar um envio', () => {
    // A trava de autoria vale nas duas etapas: se o agente pudesse
    // enfileirar, bastaria um clique distraído para o envio sair.
    expect(checkActionPolicy({ ...base, stage: 'REQUEST', actor: 'AGENT' }).refusal).toBe(
      'AGENTE_NAO_PODE_PEDIR',
    );
  });
});
