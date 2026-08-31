import { describe, expect, it } from 'vitest';
import { crc16ccitt, parsePix, parseTlv } from './pix';

/**
 * Payload BR Code sem o CRC. O CRC dos testes e calculado com a funcao
 * `crc16ccitt` — o que so e legitimo porque ela e verificada de forma
 * INDEPENDENTE contra o vetor canonico do algoritmo, no primeiro teste.
 */
const SEM_CRC =
  '00020126360014BR.GOV.BCB.PIX0114+55619999999995204000053039865406123.45' +
  '5802BR5913Fulano de Tal6008BRASILIA62070503***6304';

function comCrc(payload: string): string {
  return payload + crc16ccitt(payload).toString(16).toUpperCase().padStart(4, '0');
}

describe('crc16ccitt', () => {
  it('bate com o vetor canonico do CRC-16/CCITT-FALSE', () => {
    // Sem esta ancora, todo teste de PIX abaixo seria circular: eu estaria
    // conferindo a funcao contra ela mesma.
    expect(crc16ccitt('123456789').toString(16).toUpperCase()).toBe('29B1');
  });

  it('muda quando um caractere muda', () => {
    expect(crc16ccitt('123456789')).not.toBe(crc16ccitt('123456780'));
  });
});

describe('parseTlv', () => {
  it('le tag, tamanho e valor em sequencia', () => {
    expect(parseTlv('0002015802BR')).toEqual([
      { tag: '00', value: '01' },
      { tag: '58', value: 'BR' },
    ]);
  });

  it('para no que conseguiu ler quando o payload esta truncado', () => {
    // Um e-mail mal formatado nao pode derrubar o parser inteiro.
    expect(parseTlv('0002015820BR')).toEqual([{ tag: '00', value: '01' }]);
  });
});

describe('parsePix', () => {
  it('extrai chave, valor, beneficiario e confirma o CRC', () => {
    const resultado = parsePix(`Pague por PIX:\n${comCrc(SEM_CRC)}\n`);

    expect(resultado?.crcValid).toBe(true);
    expect(resultado?.key).toBe('+5561999999999');
    expect(resultado?.amountCents).toBe(12345);
    expect(resultado?.merchantName).toBe('Fulano de Tal');
    expect(resultado?.merchantCity).toBe('BRASILIA');
  });

  it('funciona com o payload quebrado em varias linhas pelo cliente de e-mail', () => {
    const codigo = comCrc(SEM_CRC);
    const quebrado = `PIX:\n${codigo.slice(0, 40)}\n${codigo.slice(40, 90)}\n${codigo.slice(90)}\n`;
    expect(parsePix(quebrado)?.crcValid).toBe(true);
  });

  it('preserva o espaco DENTRO do nome do beneficiario', () => {
    // Tirar todo espaco em branco conserta a quebra de linha e quebra o
    // nome, que e um campo legitimo com espacos. O CRC e quem decide qual
    // normalizacao esta certa.
    expect(parsePix(comCrc(SEM_CRC))?.merchantName).toBe('Fulano de Tal');
  });

  it('marca crcValid falso quando o codigo veio adulterado — sem descartar', () => {
    const adulterado = comCrc(SEM_CRC).replace('123.45', '999.45');
    const resultado = parsePix(adulterado);
    expect(resultado).not.toBeNull();
    expect(resultado?.crcValid).toBe(false);
  });

  it('devolve valor null quando o QR nao fixa valor', () => {
    // "Valor a combinar" nao e R$ 0,00. A tag 54 simplesmente nao aparece.
    const semValor = SEM_CRC.replace('5406123.45', '');
    expect(semValor).not.toContain('123.45');
    expect(parsePix(comCrc(semValor))?.amountCents).toBeNull();
  });

  it('devolve null quando nao ha nada com forma de PIX', () => {
    expect(parsePix('Bom dia, segue o contrato em anexo.')).toBeNull();
  });
});
