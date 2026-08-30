import { describe, expect, it } from 'vitest';
import {
  buildVoiceProfile,
  countWords,
  detectFormality,
  detectLanguage,
  detectSignature,
  extractAuthoredText,
  extractClosing,
  extractGreeting,
  isUsableSample,
  type SentMessageSample,
} from './extract';

function amostra(over: Partial<SentMessageSample> & { id: string; body: string }): SentMessageSample {
  return {
    subject: 'Re: assunto',
    sentAt: new Date('2026-08-30T10:00:00Z'),
    recipientCount: 1,
    ...over,
  };
}

describe('extractAuthoredText — separar o que o usuario escreveu', () => {
  it('corta no "Em ... escreveu:" do Gmail em portugues', () => {
    const corpo = [
      'Oi Camila,',
      '',
      'Pode ser na quinta às 14h. Confirmo o link até amanhã.',
      '',
      'Em 29 de agosto de 2026 10:00, Camila <camila@x.com> escreveu:',
      '> Podemos marcar essa semana?',
    ].join('\n');

    const autoral = extractAuthoredText(corpo);
    expect(autoral).toContain('Pode ser na quinta');
    expect(autoral).not.toContain('Podemos marcar essa semana');
    expect(autoral).not.toContain('escreveu:');
  });

  it('corta no "On ... wrote:" do Gmail em ingles', () => {
    const corpo = 'Sure, works for me.\n\nOn Aug 29, 2026, John <j@x.com> wrote:\n> Are you free?';
    expect(extractAuthoredText(corpo)).toBe('Sure, works for me.');
  });

  it('corta no cabecalho de encaminhamento do Outlook em portugues', () => {
    const corpo = 'Segue abaixo para sua análise, por favor confirme.\n\nDe: Fulano <f@x.com>\nEnviada em: 29/08/2026\nPara: eu@y.com';
    const autoral = extractAuthoredText(corpo);
    expect(autoral).toBe('Segue abaixo para sua análise, por favor confirme.');
  });

  it('corta na linha de sublinhados do Outlook', () => {
    const corpo = `Confirmo o recebimento e retorno amanhã.\n\n${'_'.repeat(32)}\nDe: alguem`;
    expect(extractAuthoredText(corpo)).toBe('Confirmo o recebimento e retorno amanhã.');
  });

  it('remove linhas citadas com ">"', () => {
    const corpo = 'Minha resposta aqui.\n> texto citado\n>> citado aninhado\nOutra linha minha.';
    const autoral = extractAuthoredText(corpo);
    expect(autoral).toContain('Minha resposta aqui.');
    expect(autoral).toContain('Outra linha minha.');
    expect(autoral).not.toContain('citado');
  });

  it('usa o marcador que aparece PRIMEIRO quando ha varios', () => {
    const corpo = 'Texto meu.\n\nOn X wrote:\n> a\n\nDe: outro\n';
    expect(extractAuthoredText(corpo)).toBe('Texto meu.');
  });

  it('devolve o texto inteiro quando nao ha citacao', () => {
    expect(extractAuthoredText('Só o meu texto, sem citação.')).toBe('Só o meu texto, sem citação.');
  });
});

describe('isUsableSample — filtrar o que nao ensina nada', () => {
  it('descarta encaminhamento pelo assunto', () => {
    // Sem isso o perfil aprende a voz de quem escreveu o original.
    for (const assunto of ['Enc: contrato', 'Fwd: proposta', 'FW: nota', 'Encaminhada: x']) {
      const veredito = isUsableSample(
        amostra({ id: 'a', subject: assunto, body: 'texto longo o suficiente para passar do mínimo de palavras aqui' }),
      );
      expect(veredito.usable).toBe(false);
      expect(veredito.reason).toContain('Encaminhamento');
    }
  });

  it('descarta resposta curta demais', () => {
    // "ok", "recebido, obrigado" dominam a pasta Enviados em volume e
    // envenenariam o perfil.
    const veredito = isUsableSample(amostra({ id: 'a', body: 'ok, obrigado' }));
    expect(veredito.usable).toBe(false);
    expect(veredito.reason).toContain('curto demais');
  });

  it('descarta mensagem que so tem citacao', () => {
    const veredito = isUsableSample(
      amostra({ id: 'a', body: 'On X wrote:\n> uma mensagem original bem longa que nao e minha' }),
    );
    expect(veredito.usable).toBe(false);
  });

  it('aceita resposta autoral de tamanho util', () => {
    const veredito = isUsableSample(
      amostra({
        id: 'a',
        body: 'Oi João, pode ser na quinta às 14h. Vou preparar a apresentação e mando antes.',
      }),
    );
    expect(veredito.usable).toBe(true);
  });
});

describe('extractGreeting', () => {
  it('reconhece saudacoes comuns em portugues', () => {
    expect(extractGreeting('Oi Camila,\n\nTudo certo.')).toBe('Oi Camila,');
    expect(extractGreeting('Bom dia,\n\nSegue.')).toBe('Bom dia,');
    expect(extractGreeting('Prezados,\n\nSegue.')).toBe('Prezados,');
  });

  it('nao confunde primeira frase longa com saudacao', () => {
    expect(
      extractGreeting('Conforme conversamos ontem sobre o contrato, seguem os pontos.'),
    ).toBeNull();
  });

  it('devolve null quando a mensagem comeca direto no assunto', () => {
    expect(extractGreeting('Segue o orçamento revisado em anexo.')).toBeNull();
  });
});

describe('extractClosing', () => {
  it('reconhece despedidas no fim da mensagem', () => {
    expect(extractClosing('Texto.\n\nAbraço,\nVictor')).toBe('Abraço,');
    expect(extractClosing('Texto.\n\nAtenciosamente,')).toBe('Atenciosamente,');
    expect(extractClosing('Texto.\n\nValeu!')).toBe('Valeu!');
  });

  it('nao pega despedida que aparece no meio do texto', () => {
    // "obrigado" no meio de uma frase nao e despedida.
    const texto = 'Muito obrigado pelo retorno rápido, isso ajudou bastante no fechamento do trimestre.';
    expect(extractClosing(texto)).toBeNull();
  });

  it('devolve null quando nao ha despedida', () => {
    expect(extractClosing('Segue o arquivo.')).toBeNull();
  });
});

describe('detectSignature — por repeticao, nao por regra', () => {
  it('detecta o bloco final repetido em varias mensagens', () => {
    // Pouca gente usa o separador "--"; todo mundo repete o mesmo bloco.
    const assinatura = 'Victor Sasaki\nDiretor — Consultoria Alfa';
    const amostras = [
      `Segue a proposta revisada.\n\n${assinatura}`,
      `Confirmo a reunião de quinta.\n\n${assinatura}`,
      `Obrigado pelo retorno.\n\n${assinatura}`,
    ];
    expect(detectSignature(amostras)).toBe(assinatura);
  });

  it('nao inventa assinatura com poucas amostras', () => {
    expect(detectSignature(['a\nb'], 3)).toBeNull();
  });

  it('nao trata texto variavel como assinatura', () => {
    const amostras = [
      'Primeira mensagem completamente diferente aqui.',
      'Segunda mensagem com outro conteúdo distinto.',
      'Terceira mensagem sem nada em comum com as outras.',
    ];
    expect(detectSignature(amostras)).toBeNull();
  });
});

describe('detectFormality', () => {
  it('reconhece registro formal', () => {
    expect(
      detectFormality(['Prezados, venho por meio desta solicitar.', 'Prezado João, atenciosamente.']),
    ).toBe('formal');
  });

  it('reconhece registro informal', () => {
    expect(detectFormality(['E aí, beleza? valeu', 'Oi! abraço'])).toBe('informal');
  });

  it('devolve neutro quando nao ha sinal claro', () => {
    expect(detectFormality(['Segue o arquivo solicitado.', 'Confirmo o recebimento.'])).toBe('neutro');
  });

  it('devolve null sem amostra', () => {
    expect(detectFormality([])).toBeNull();
  });
});

describe('detectLanguage', () => {
  it('distingue portugues de ingles', () => {
    expect(detectLanguage(['Não consigo hoje, mas você pode amanhã para que eu confirme'])).toBe('pt-BR');
    expect(detectLanguage(['The meeting with you and the team would be for this week'])).toBe('en');
  });

  it('devolve null sem sinal', () => {
    expect(detectLanguage(['12345 ...'])).toBeNull();
  });

  it('reconhece e-mail curto de negocio sem as palavras mais obvias', () => {
    // O caso que quebrou na primeira versao: nenhum "que/não/para/com".
    expect(detectLanguage(['Pode ser na quinta às 14h. Segue conforme combinado.'])).toBe('pt-BR');
  });

  it('nao se confunde com palavras ambiguas entre os dois idiomas', () => {
    // "do" e "no" existem nos dois idiomas e ficaram fora da lista de
    // propósito; um texto so com elas nao decide nada.
    expect(detectLanguage(['do no a o'])).toBeNull();
  });
});

describe('buildVoiceProfile — integracao', () => {
  const assinatura = 'Victor Sasaki\nConsultoria Alfa';

  function corpus(): SentMessageSample[] {
    return [
      amostra({
        id: '1',
        body: `Oi Camila,\n\nPode ser na quinta às 14h. Preparo a apresentação e mando antes.\n\nAbraço,\n${assinatura}`,
      }),
      amostra({
        id: '2',
        body: `Oi João,\n\nRecebi a proposta e vou revisar até sexta. Qualquer coisa te aviso.\n\nAbraço,\n${assinatura}`,
      }),
      amostra({
        id: '3',
        body: `Oi Marina,\n\nSegue o contrato ajustado conforme conversamos na reunião.\n\nAbraço,\n${assinatura}`,
      }),
      // Ruido que precisa ser descartado:
      amostra({ id: '4', subject: 'Enc: nota fiscal', body: 'Segue abaixo o documento para conferência.' }),
      amostra({ id: '5', body: 'ok' }),
    ];
  }

  it('descarta o ruido e conta so as amostras autorais', () => {
    const perfil = buildVoiceProfile(corpus());
    expect(perfil.sampleCount).toBe(3);
    expect(perfil.rejected).toHaveLength(2);
    expect(perfil.rejected.map((r) => r.id).sort()).toEqual(['4', '5']);
  });

  it('extrai saudacao e despedida com contagem', () => {
    const perfil = buildVoiceProfile(corpus());
    expect(perfil.closings[0]?.text).toBe('Abraço,');
    expect(perfil.closings[0]?.count).toBe(3);
    expect(perfil.greetings.some((g) => g.text.startsWith('Oi'))).toBe(true);
  });

  it('detecta a assinatura repetida', () => {
    const perfil = buildVoiceProfile(corpus());
    expect(perfil.signature).toContain('Victor Sasaki');
  });

  it('calcula estatisticas de tamanho e detecta idioma', () => {
    const perfil = buildVoiceProfile(corpus());
    expect(perfil.avgWordCount).toBeGreaterThan(0);
    expect(perfil.medianWordCount).toBeGreaterThan(0);
    expect(perfil.language).toBe('pt-BR');
  });

  it('devolve perfil magro e honesto quando falta material, sem quebrar', () => {
    // A UI mostra "material insuficiente" em vez de fingir que aprendeu.
    const perfil = buildVoiceProfile([amostra({ id: '1', body: 'ok' })]);
    expect(perfil.sampleCount).toBe(0);
    expect(perfil.signature).toBeNull();
    expect(perfil.greetings).toHaveLength(0);
  });

  it('lida com corpus vazio', () => {
    const perfil = buildVoiceProfile([]);
    expect(perfil.sampleCount).toBe(0);
    expect(perfil.formality).toBeNull();
    expect(perfil.language).toBeNull();
  });

  it('anota quem escreve direto no assunto, sem saudacao', () => {
    const semSaudacao = Array.from({ length: 6 }, (_, i) =>
      amostra({
        id: `s${i}`,
        body: 'Segue o orçamento revisado conforme solicitado na reunião de ontem pela manhã.',
      }),
    );
    const perfil = buildVoiceProfile(semSaudacao);
    expect(perfil.traits).toContain('Costuma começar direto no assunto, sem saudação');
  });
});

describe('countWords', () => {
  it('conta palavras ignorando espaco extra', () => {
    expect(countWords('  uma   duas \n três ')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});
