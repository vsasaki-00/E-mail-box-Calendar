import { describe, expect, it } from 'vitest';
import { bestBodyText, htmlToText, stripRawHeaders } from './body-text';

describe('stripRawHeaders — o corpo cru que o IMAP devolve', () => {
  it('corta os cabecalhos RFC822 e devolve so o corpo', () => {
    // Sem isso o perfil de voz do IMAP aprenderia cabecalhos de e-mail.
    const cru = [
      'Return-Path: <eu@dominio.com>',
      'Subject: Re: proposta',
      'From: Eu <eu@dominio.com>',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'Oi Camila,',
      '',
      'Pode ser na quinta.',
    ].join('\n');

    expect(stripRawHeaders(cru)).toBe('Oi Camila,\n\nPode ser na quinta.');
  });

  it('funciona com CRLF, que e o que vem do protocolo', () => {
    const cru = 'Date: hoje\r\nSubject: teste\r\nFrom: a@b.com\r\n\r\nCorpo da mensagem.';
    expect(stripRawHeaders(cru)).toBe('Corpo da mensagem.');
  });

  it('NAO corta texto normal que tenha linha em branco', () => {
    // O risco oposto: perder o primeiro parágrafo de uma mensagem comum.
    const normal = 'Oi João,\n\nSegue o contrato revisado.';
    expect(stripRawHeaders(normal)).toBe(normal);
  });

  it('NAO corta corpo que comeca com frase terminando em dois-pontos', () => {
    // Falso positivo real, encontrado em teste: "Resumo:" casa o formato de
    // cabecalho. Exigir o BLOCO inteiro (>= 3 linhas, todas cabecalho) e o
    // que resolve — uma linha so nao e bloco de cabecalho.
    const texto = 'Resumo: fechamos o contrato ontem.\n\nDetalhes abaixo.';
    expect(stripRawHeaders(texto)).toBe(texto);
  });

  it('NAO corta bloco curto demais para ser cabecalho de verdade', () => {
    const texto = 'Assunto: reuniao\nData: quinta\n\nCorpo.';
    // So duas linhas: mensagem RFC822 real sempre tem mais.
    expect(stripRawHeaders(texto)).toBe(texto);
  });

  it('NAO corta quando uma das linhas do bloco nao e cabecalho', () => {
    const texto = 'Subject: x\nFrom: a@b.com\nisto aqui e texto solto\n\nCorpo.';
    expect(stripRawHeaders(texto)).toBe(texto);
  });

  it('aceita continuacao dobrada de cabecalho (linha comecando com espaco)', () => {
    // RFC 5322 permite quebrar um cabecalho longo em varias linhas.
    const cru = 'Subject: assunto muito longo\n  que continua aqui\nFrom: a@b.com\nDate: hoje\n\nCorpo real.';
    expect(stripRawHeaders(cru)).toBe('Corpo real.');
  });

  it('devolve o texto intacto quando nao ha linha em branco', () => {
    const texto = 'Subject: so cabecalho sem corpo';
    expect(stripRawHeaders(texto)).toBe(texto);
  });
});

describe('htmlToText — o corpo que o Microsoft devolve', () => {
  it('remove tags e preserva as quebras de linha', () => {
    // As quebras importam: o extrator usa primeira e ultima linha para
    // achar saudacao e despedida.
    const html = '<div>Oi Camila,</div><div><br></div><div>Pode ser na quinta.</div><div>Abraço,</div>';
    const texto = htmlToText(html);
    expect(texto.split('\n')[0]).toBe('Oi Camila,');
    expect(texto).toContain('Pode ser na quinta.');
    expect(texto.trimEnd().endsWith('Abraço,')).toBe(true);
    expect(texto).not.toContain('<');
  });

  it('remove style e script inteiros, nao so as tags', () => {
    const html = '<style>.x{color:red}</style><p>Texto real</p><script>var a=1;</script>';
    const texto = htmlToText(html);
    expect(texto).toBe('Texto real');
    expect(texto).not.toContain('color');
    expect(texto).not.toContain('var a');
  });

  it('decodifica as entidades comuns', () => {
    expect(htmlToText('<p>a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;</p>')).toBe(
      'a & b < c > d "e" \'f\'',
    );
    expect(htmlToText('<p>espaço&nbsp;duro</p>')).toBe('espaço duro');
  });

  it('decodifica entidades numericas', () => {
    expect(htmlToText('<p>&#65;&#66;</p>')).toBe('AB');
  });

  it('trata <br> nas variacoes que aparecem de verdade', () => {
    expect(htmlToText('a<br>b<br/>c<br />d')).toBe('a\nb\nc\nd');
  });

  it('colapsa sequencias de linhas vazias do HTML de e-mail', () => {
    const texto = htmlToText('<div>a</div><div></div><div></div><div></div><div>b</div>');
    expect(texto).toBe('a\n\nb');
  });
});

describe('bestBodyText', () => {
  it('prefere text/plano ao HTML', () => {
    // O texto plano e o que o autor digitou; o HTML carrega formatacao que
    // o cliente de e-mail injetou por cima.
    expect(bestBodyText({ text: 'texto puro', html: '<p>versão html</p>' })).toBe('texto puro');
  });

  it('cai para o HTML quando nao ha texto plano (caso Microsoft)', () => {
    expect(bestBodyText({ text: null, html: '<p>só html</p>' })).toBe('só html');
  });

  it('aplica a remocao de cabecalho no texto plano (caso IMAP)', () => {
    const cru = 'Date: hoje\nSubject: x\nFrom: a@b.com\n\nCorpo de verdade.';
    expect(bestBodyText({ text: cru })).toBe('Corpo de verdade.');
  });

  it('devolve vazio quando nao ha corpo nenhum', () => {
    expect(bestBodyText({})).toBe('');
    expect(bestBodyText({ text: '   ', html: null })).toBe('');
  });
});
