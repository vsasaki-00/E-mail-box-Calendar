import { describe, expect, it } from 'vitest';
import {
  buildClosing,
  buildGreeting,
  composeDraft,
  firstName,
  stripGreetingAndClosing,
  type VoiceForDraft,
} from './compose';

const VOZ: VoiceForDraft = {
  greetings: [
    { text: 'Oi Camila,', count: 5 },
    { text: 'Prezado João,', count: 1 },
  ],
  closings: [{ text: 'Abraço,', count: 6 }],
  signature: 'Victor Sasaki\nBrand.co',
  language: 'pt-BR',
  formality: 'informal',
  medianWordCount: 21,
  traits: ['Escreve mensagens curtas e diretas'],
  userNotes: null,
};

describe('firstName', () => {
  it('usa o primeiro nome de quem escreveu', () => {
    expect(firstName('Marina Costa', 'marina@x.com')).toBe('Marina');
  });

  it('deriva do e-mail quando nao ha nome', () => {
    expect(firstName(null, 'joao.silva@x.com')).toBe('Joao');
  });

  it('nao trata endereco de sistema como nome', () => {
    // "Oi Noreply," seria a coisa mais denunciadora possivel.
    expect(firstName(null, 'no-reply@x.com')).toBeNull();
    expect(firstName(null, 'financeiro@x.com')).toBeNull();
    expect(firstName(null, 'billing@x.com')).toBeNull();
  });

  it('nao usa o proprio e-mail como nome', () => {
    expect(firstName('contato@empresa.com', 'contato@empresa.com')).toBeNull();
  });
});

describe('buildGreeting — a SUA forma, com o nome de quem escreveu', () => {
  it('troca o nome mantendo a forma que voce usa', () => {
    expect(buildGreeting(VOZ, 'Marina')).toBe('Oi Marina,');
  });

  it('usa a saudacao mais frequente, nao a primeira da lista', () => {
    const invertida: VoiceForDraft = {
      ...VOZ,
      greetings: [
        { text: 'Oi Camila,', count: 1 },
        { text: 'Prezado João,', count: 9 },
      ],
    };
    expect(buildGreeting(invertida, 'Marina')).toBe('Prezado Marina,');
  });

  it('cai para a forma sem nome quando ela funciona sozinha', () => {
    expect(buildGreeting(VOZ, null)).toBe('Oi,');
  });

  it('nao saúda quando a forma exige nome e nao ha nome', () => {
    // "Prezado," sozinho fica pior do que nao saudar.
    const formal: VoiceForDraft = { ...VOZ, greetings: [{ text: 'Prezado João,', count: 3 }] };
    expect(buildGreeting(formal, null)).toBeNull();
  });

  it('devolve null quando o perfil nao tem saudacao', () => {
    expect(buildGreeting({ ...VOZ, greetings: [] }, 'Marina')).toBeNull();
  });
});

describe('stripGreetingAndClosing — defesa contra o modelo desobedecer', () => {
  it('tira a saudacao que o modelo escreveu mesmo mandado nao escrever', () => {
    // Sem isso o rascunho sai com "Oi Marina," duas vezes, e nada denuncia
    // mais uma resposta automatica.
    const miolo = 'Oi Marina,\n\nPode ser na quinta às 14h.';
    expect(stripGreetingAndClosing(miolo)).toBe('Pode ser na quinta às 14h.');
  });

  it('tira despedida e nome no fim', () => {
    const miolo = 'Pode ser na quinta às 14h.\n\nAbraço,\nVictor';
    expect(stripGreetingAndClosing(miolo)).toBe('Pode ser na quinta às 14h.');
  });

  it('NAO estraga um miolo que ja esta correto', () => {
    const miolo = 'Pode ser na quinta às 14h. Confirmo o link amanhã.';
    expect(stripGreetingAndClosing(miolo)).toBe(miolo);
  });

  it('nao corta frase que apenas COMECA com palavra de saudacao', () => {
    const miolo = 'Bom dia inteiro de reuniões na quinta, então prefiro sexta.';
    expect(stripGreetingAndClosing(miolo)).toBe(miolo);
  });
});

describe('composeDraft', () => {
  it('monta saudação + miolo + despedida + assinatura EXATA', () => {
    // A assinatura sai caractere por caractere do perfil, e nao uma
    // parafrase que o modelo achou parecida.
    const resultado = composeDraft('Pode ser na quinta às 14h.', VOZ, {
      fromName: 'Marina Costa',
      fromEmail: 'marina@x.com',
    });

    expect(resultado.text).toBe(
      'Oi Marina,\n\nPode ser na quinta às 14h.\n\nAbraço,\nVictor Sasaki\nBrand.co',
    );
  });

  it('nao duplica saudacao nem despedida quando o modelo as incluiu', () => {
    const resultado = composeDraft('Oi Marina,\n\nPode ser na quinta.\n\nAbraço,\nVictor', VOZ, {
      fromName: 'Marina Costa',
      fromEmail: 'marina@x.com',
    });

    expect(resultado.text.match(/Oi Marina,/g)).toHaveLength(1);
    expect(resultado.text.match(/Abraço,/g)).toHaveLength(1);
  });

  it('perfil magro produz rascunho magro, sem inventar as partes que faltam', () => {
    const magro: VoiceForDraft = {
      ...VOZ,
      greetings: [],
      closings: [],
      signature: null,
    };
    const resultado = composeDraft('Pode ser na quinta.', magro, { fromName: 'Marina' });

    expect(resultado.text).toBe('Pode ser na quinta.');
    expect(resultado.greeting).toBeNull();
    expect(resultado.signature).toBeNull();
  });

  it('usa a assinatura sozinha quando nao ha despedida', () => {
    const semDespedida: VoiceForDraft = { ...VOZ, closings: [] };
    const resultado = composeDraft('Pode ser na quinta.', semDespedida, { fromName: 'Marina' });
    expect(resultado.text.endsWith('Victor Sasaki\nBrand.co')).toBe(true);
  });
});
