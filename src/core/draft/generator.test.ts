import { describe, expect, it, vi } from 'vitest';
import * as generatorModule from './generator';
import { checkDraftPreconditions, generateDraft, type DraftModel, type VoiceProfileGate } from './generator';
import * as persistModule from './persist';
import { buildDraftSystemPrompt, buildDraftUserPrompt, MAX_THREAD_CHARS } from './prompt';
import type { VoiceForDraft } from './compose';
import type { DraftInput, DraftMailboxContext } from './types';
import { GOOGLE_SCOPES } from '@/lib/connectors/google';
import { MICROSOFT_SCOPES } from '@/lib/connectors/microsoft';

const VOZ: VoiceForDraft = {
  greetings: [{ text: 'Oi Camila,', count: 5 }],
  closings: [{ text: 'Abraço,', count: 6 }],
  signature: 'Victor Sasaki\nBrand.co',
  language: 'pt-BR',
  formality: 'informal',
  medianWordCount: 21,
  traits: ['Escreve mensagens curtas e diretas'],
  userNotes: null,
};

const PERFIL: VoiceProfileGate = {
  voz: VOZ,
  userApproved: true,
  derivedAt: new Date('2026-08-30T10:00:00Z'),
};

const CONTEXTO: DraftMailboxContext = {
  accountEmail: 'victor@brand.co',
  businessName: 'Brand.co',
  role: 'sócio',
  objective: 'fechar palestras e treinamentos',
};

const ENTRADA: DraftInput = {
  id: 'item-1',
  fromEmail: 'marina@cliente.com',
  fromName: 'Marina Costa',
  subject: 'Palestra em outubro',
  body: 'Oi Victor, você tem disponibilidade para uma palestra em outubro?',
  receivedAt: new Date('2026-08-30T10:00:00Z'),
};

describe('checkDraftPreconditions — a trava que sustenta a fase 5C', () => {
  it('recusa quando a caixa nao tem perfil de voz', () => {
    const recusa = checkDraftPreconditions(ENTRADA, null, true);
    expect(recusa?.refusal).toBe('SEM_PERFIL_DE_VOZ');
  });

  it('recusa quando o perfil existe mas voce NAO validou', () => {
    // Sem esta recusa a fase 5C inteira teria sido decorativa: a validação
    // é o único sinal de que o perfil representa você.
    const recusa = checkDraftPreconditions(ENTRADA, { ...PERFIL, userApproved: false }, true);
    expect(recusa?.refusal).toBe('PERFIL_NAO_VALIDADO');
    expect(recusa?.message).toContain('/voz');
  });

  it('recusa quando a mensagem original nao tem corpo', () => {
    // Responder sem ler o que foi perguntado produziria texto genérico.
    const recusa = checkDraftPreconditions({ ...ENTRADA, body: '   ' }, PERFIL, true);
    expect(recusa?.refusal).toBe('SEM_CORPO');
  });

  it('recusa sem chave de API, dizendo que aqui nao ha camada local', () => {
    const recusa = checkDraftPreconditions(ENTRADA, PERFIL, false);
    expect(recusa?.refusal).toBe('SEM_CHAVE_DE_API');
  });

  it('libera quando tudo esta no lugar', () => {
    expect(checkDraftPreconditions(ENTRADA, PERFIL, true)).toBeNull();
  });
});

describe('buildDraftSystemPrompt', () => {
  it('manda o modelo NAO escrever saudacao, despedida nem assinatura', () => {
    // Elas são compostas localmente, para sair exatas.
    const prompt = buildDraftSystemPrompt(CONTEXTO, VOZ);
    expect(prompt).toContain('NÃO escreva saudação');
    expect(prompt).toContain('NÃO escreva despedida');
    expect(prompt).toContain('NÃO escreva assinatura');
  });

  it('leva o perfil de voz e o contexto do negocio daquela caixa', () => {
    const prompt = buildDraftSystemPrompt(CONTEXTO, VOZ);
    expect(prompt).toContain('pt-BR');
    expect(prompt).toContain('21 palavras');
    expect(prompt).toContain('Brand.co');
    expect(prompt).toContain('sócio');
    expect(prompt).toContain('fechar palestras e treinamentos');
    expect(prompt).toContain('Escreve mensagens curtas e diretas');
  });

  it('a correcao que VOCE escreveu sobre o perfil entra e vem por ultimo', () => {
    const prompt = buildDraftSystemPrompt(CONTEXTO, {
      ...VOZ,
      userNotes: "nunca uso 'Prezados' aqui",
    });
    expect(prompt).toContain("nunca uso 'Prezados' aqui");
    expect(prompt.indexOf("nunca uso")).toBeGreaterThan(prompt.indexOf('Registro:'));
  });

  it('proibe inventar fato, numero, data e compromisso', () => {
    const prompt = buildDraftSystemPrompt(CONTEXTO, VOZ);
    expect(prompt).toContain('Não invente fato');
    expect(prompt).toContain('Não envia nada');
  });

  it('nao vaza o perfil de OUTRA caixa', () => {
    // Responder um cliente da Unitedcom com a voz do e-mail pessoal seria
    // o pior erro possivel de um sistema multi-negocio.
    const prompt = buildDraftSystemPrompt(CONTEXTO, VOZ);
    expect(prompt).not.toContain('Unitedcom');
    expect(prompt).not.toContain('Pessoais');
  });
});

describe('buildDraftUserPrompt', () => {
  it('corta o corpo no limite', () => {
    const prompt = buildDraftUserPrompt({ ...ENTRADA, body: 'x'.repeat(30000) });
    expect(prompt.length).toBeLessThan(MAX_THREAD_CHARS + 400);
  });

  it('marca a sua instrucao como tendo precedencia', () => {
    const prompt = buildDraftUserPrompt({ ...ENTRADA, direction: 'recuse, agenda cheia' });
    expect(prompt).toContain('recuse, agenda cheia');
    expect(prompt).toContain('Tem precedência');
  });

  it('nao inventa bloco de instrucao quando voce nao deu nenhuma', () => {
    expect(buildDraftUserPrompt(ENTRADA)).not.toContain('instrução-do-usuário');
  });
});

describe('generateDraft', () => {
  const modelo = (body: string, subject = 'Palestra em outubro'): DraftModel => ({
    name: 'fake',
    draft: vi.fn(async () => ({ body, subject, reason: 'confirmou disponibilidade' })),
  });

  it('compoe o texto final com a sua saudacao, despedida e assinatura', async () => {
    const r = await generateDraft(ENTRADA, CONTEXTO, PERFIL, modelo('Tenho sim, outubro está livre.'));

    expect(r.bodyComposed).toBe(
      'Oi Marina,\n\nTenho sim, outubro está livre.\n\nAbraço,\nVictor Sasaki\nBrand.co',
    );
    // O miolo cru fica guardado separado, para medir o quanto voce edita.
    expect(r.bodyGenerated).toBe('Tenho sim, outubro está livre.');
  });

  it('prefixa Re: no assunto sem duplicar', async () => {
    const um = await generateDraft(ENTRADA, CONTEXTO, PERFIL, modelo('ok'));
    expect(um.subject).toBe('Re: Palestra em outubro');

    const dois = await generateDraft(
      { ...ENTRADA, subject: 'Re: Palestra em outubro' },
      CONTEXTO,
      PERFIL,
      modelo('ok'),
    );
    expect(dois.subject).toBe('Re: Palestra em outubro');
  });

  it('falha de API vira erro no resultado, nao excecao', async () => {
    const quebrado: DraftModel = {
      name: 'quebrado',
      draft: vi.fn(async () => {
        throw new Error('529 overloaded');
      }),
    };
    const r = await generateDraft(ENTRADA, CONTEXTO, PERFIL, quebrado);
    expect(r.error).toContain('529');
    expect(r.bodyComposed).toBe('');
  });
});

describe('a fase 5D nao envia e-mail', () => {
  it('nao existe nenhuma funcao de envio nos modulos de rascunho', () => {
    // Guarda deliberada. Nao e um envio desligado por flag — e a ausencia
    // da capacidade. Se alguem (eu inclusive) adicionar um `sendDraft`, este
    // teste quebra e obriga a decisao a ser explicita.
    const nomes = [...Object.keys(generatorModule), ...Object.keys(persistModule)];
    const suspeitos = nomes.filter((n) => /send|enviar|dispatch|deliver|smtp/i.test(n));
    expect(suspeitos).toEqual([]);
  });

  it('os escopos OAuth continuam somente-leitura — a segunda barreira', () => {
    // Barreira independente do codigo: mesmo que alguem escrevesse um
    // envio, o token nao teria permissao. Se um escopo de envio entrar
    // aqui, este teste quebra antes de qualquer usuario descobrir.
    for (const escopo of GOOGLE_SCOPES) {
      expect(escopo).not.toMatch(/\.send|gmail\.modify|gmail\.compose|mail\.google\.com/i);
    }
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/gmail.readonly');

    for (const escopo of MICROSOFT_SCOPES) {
      expect(escopo).not.toMatch(/Mail\.Send|Mail\.ReadWrite/i);
    }
    expect(MICROSOFT_SCOPES).toContain('Mail.Read');
  });
});
