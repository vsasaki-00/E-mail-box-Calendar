import { describe, expect, it } from 'vitest';
import { CABECALHOS_TWIML, twimlMensagem, twimlVazio } from './twiml';

describe('twimlVazio', () => {
  it('e TwiML valido e vazio — "recebi, nao tenho o que responder"', () => {
    expect(twimlVazio()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  it('a nota vai num comentario, DENTRO do Response', () => {
    expect(twimlVazio('registradas=1')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><!-- registradas=1 --></Response>',
    );
  });

  it('nao deixa a nota quebrar o comentario', () => {
    // `--` fecha comentario antes da hora; um `-` no fim gera `--->`.
    expect(twimlVazio('a--b')).not.toContain('--b');
    expect(twimlVazio('termina em -')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><!-- termina em --></Response>',
    );
    expect(twimlVazio('<script>')).not.toContain('<script>');
    expect(twimlVazio('a & b')).not.toContain('&');
  });

  it('nota longa e cortada, para a resposta nao virar payload', () => {
    const xml = twimlVazio('x'.repeat(500));
    expect(xml.length).toBeLessThan(300);
  });

  it('nota so de lixo nao deixa comentario vazio na resposta', () => {
    expect(twimlVazio('---')).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(twimlVazio('   ')).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  it('o content-type e o que o Twilio aceita — nao application/json', () => {
    expect(CABECALHOS_TWIML['content-type']).toBe('text/xml; charset=utf-8');
  });
});

describe('twimlMensagem', () => {
  it('devolve a resposta dentro de um Message', () => {
    expect(twimlMensagem('oi')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>oi</Message></Response>',
    );
  });

  it('escapa o que veio da mensagem do usuario — senao um & quebra o XML', () => {
    const xml = twimlMensagem('fornecedor A & B <teste>');
    expect(xml).toContain('fornecedor A &amp; B &lt;teste&gt;');
    expect(xml).not.toContain('& B');
  });

  it('quebra de linha sobrevive — a resposta tem varias linhas', () => {
    expect(twimlMensagem('linha 1\nlinha 2')).toContain('linha 1\nlinha 2');
  });

  it('aceita a nota de diagnostico junto', () => {
    expect(twimlMensagem('oi', 'registrada')).toContain('<!-- registrada --><Message>');
  });
});
