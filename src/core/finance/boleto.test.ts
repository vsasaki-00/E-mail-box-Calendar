import { describe, expect, it } from 'vitest';
import { dueDateFromFator, findBoletos, mod10, mod11Barcode } from './boleto';

/**
 * Linha digitavel real de titulo (Itau, R$ 150,00, fator 8995).
 *
 * Os TRES digitos verificadores de campo fecham nela, o que e a prova de
 * que o parsing dos campos esta certo — cada um cobre uma parte diferente
 * da linha.
 */
const LINHA_TITULO = '34191790010104351004791020150008889950000015000';

describe('mod10 — DV dos campos da linha digitavel', () => {
  it('confere os tres campos de uma linha real', () => {
    expect(mod10('341917900')).toBe(1);
    expect(mod10('0104351004')).toBe(7);
    expect(mod10('9102015000')).toBe(8);
  });

  it('muda quando um digito muda (senao nao protegeria de nada)', () => {
    expect(mod10('341917901')).not.toBe(mod10('341917900'));
  });
});

describe('mod11Barcode — DV geral', () => {
  it('nunca devolve 0, 10 ou 11 (regra FEBRABAN)', () => {
    // A regra de mapear esses tres para 1 e a fonte classica de bug.
    for (let i = 0; i < 200; i += 1) {
      const digitos = String(i).padStart(43, '7');
      const dv = mod11Barcode(digitos);
      expect(dv).toBeGreaterThanOrEqual(1);
      expect(dv).toBeLessThanOrEqual(9);
    }
  });
});

describe('dueDateFromFator — o fator que estourou em 2025', () => {
  it('lê o ciclo antigo quando é ele que fica perto de hoje', () => {
    // Fator 8995 = 24/05/2022 na base historica de 07/10/1997.
    const data = dueDateFromFator(8995, new Date('2022-06-01'));
    expect(data?.toISOString().slice(0, 10)).toBe('2022-05-24');
  });

  it('lê o ciclo novo, que reiniciou em 1000 no dia 22/02/2025', () => {
    // Sem esta regra, TODO boleto emitido depois de 2025 viraria uma data
    // do fim dos anos 1990 — e o painel diria "vencido há 27 anos".
    expect(dueDateFromFator(1000, new Date('2025-03-01'))?.toISOString().slice(0, 10)).toBe(
      '2025-02-22',
    );
    expect(dueDateFromFator(1500, new Date('2026-08-31'))?.toISOString().slice(0, 10)).toBe(
      '2026-07-07',
    );
  });

  it('escolhe o candidato mais proximo de hoje quando os dois ciclos servem', () => {
    // Em 2026 um fator 8995 so pode ser o boleto de 2022, nunca 2047.
    expect(dueDateFromFator(8995, new Date('2026-08-31'))?.toISOString().slice(0, 10)).toBe(
      '2022-05-24',
    );
  });

  it('rejeita fator fora da faixa', () => {
    expect(dueDateFromFator(0)).toBeNull();
    expect(dueDateFromFator(10000)).toBeNull();
    expect(dueDateFromFator(1.5)).toBeNull();
  });
});

describe('findBoletos — titulo', () => {
  it('acha a linha no meio do corpo, com pontos e espacos', () => {
    const corpo = `Olá,\n\nSegue o boleto de agosto:\n\n34191.79001 01043.510047 91020.150008 8 89950000015000\n\nAtenciosamente.`;
    const [boleto] = findBoletos(corpo, new Date('2022-06-01'));

    expect(boleto?.kind).toBe('TITULO');
    expect(boleto?.digitableLine).toBe(LINHA_TITULO);
    expect(boleto?.bankCode).toBe('341');
    expect(boleto?.fieldChecksumValid).toBe(true);
  });

  it('tira valor e vencimento da PROPRIA linha, nao do texto', () => {
    // Este e o ponto inteiro da fase: valor e vencimento vindos do
    // instrumento de pagamento não dependem de nenhum modelo acertar.
    const [boleto] = findBoletos(LINHA_TITULO, new Date('2022-06-01'));
    expect(boleto?.amountCents).toBe(15000);
    expect(boleto?.dueDate?.toISOString().slice(0, 10)).toBe('2022-05-24');
  });

  it('marca valor null quando o boleto nao tem valor definido', () => {
    // Boleto "em branco" existe: quem paga informa o valor. Devolver 0
    // colocaria uma cobranca de R$ 0,00 no painel.
    const semValor = LINHA_TITULO.slice(0, 37) + '0000000000';
    const [boleto] = findBoletos(semValor, new Date('2022-06-01'));
    expect(boleto?.amountCents).toBeNull();
  });

  it('NAO descarta a linha que falha no DV — devolve marcada', () => {
    // Descartar em silencio faria a cobranca sumir do painel, que e o pior
    // modo de falha desta fase.
    const corrompida = '34191790010104351004791020150008889950000015001';
    const [boleto] = findBoletos(corrompida, new Date('2022-06-01'));
    expect(boleto).toBeDefined();
    expect(boleto?.checksumValid).toBe(false);
  });

  it('devolve vazio quando nao ha nada com cara de linha digitavel', () => {
    expect(findBoletos('Reunião confirmada para quinta, abraço.')).toEqual([]);
  });

  it('nao confunde numero longo qualquer com boleto valido', () => {
    const texto = 'Protocolo 1234567890123456789012345678901234567890123456789';
    expect(findBoletos(texto).filter((b) => b.checksumValid)).toEqual([]);
  });
});
