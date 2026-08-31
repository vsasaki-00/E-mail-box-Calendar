import { describe, expect, it, vi } from 'vitest';
import {
  buildBillBatchPrompt,
  extractDeterministic,
  MAX_BODY_CHARS,
  mergeExtraction,
  MODEL_ONLY_CONFIDENCE_CAP,
  runBillExtraction,
  type BillModel,
  type ExtractionResponse,
} from './extractor';
import { crc16ccitt } from './pix';
import type { BillInput } from './types';

const HOJE = new Date('2022-06-01T12:00:00Z');
const LINHA = '34191.79001 01043.510047 91020.150008 8 89950000015000';

function entrada(over: Partial<BillInput> & { id: string; body: string }): BillInput {
  return {
    fromEmail: 'financeiro@fornecedor.com.br',
    fromName: 'Fornecedor S/A',
    subject: 'Fatura de agosto',
    receivedAt: new Date('2022-05-10T10:00:00Z'),
    hasAttachments: true,
    ...over,
  };
}

function modeloFalso(results: ExtractionResponse['results']): BillModel {
  return { name: 'fake', extract: vi.fn(async () => ({ results })) };
}

const doModelo = (over: Partial<ExtractionResponse['results'][number]> = {}) => ({
  id: 'a',
  payee: 'Fornecedor S/A',
  kind: 'FATURA' as const,
  amountCents: null,
  dueDate: null,
  isPayable: true,
  confidence: 0.9,
  reason: 'lido do corpo',
  ...over,
});

describe('mergeExtraction — quem manda em valor e vencimento', () => {
  it('o instrumento de pagamento vence o modelo', () => {
    // O ponto inegociavel da fase: o modelo pode trocar um digito, e do lado
    // do dinheiro isso e irreversivel.
    const input = entrada({ id: 'a', body: `Segue:\n${LINHA}` });
    const resultado = mergeExtraction(
      input,
      extractDeterministic(input, HOJE),
      doModelo({ amountCents: 999999, dueDate: '2030-01-01' }),
    );

    expect(resultado.amountCents).toBe(15000);
    expect(resultado.dueDate?.toISOString().slice(0, 10)).toBe('2022-05-24');
    expect(resultado.source).toBe('INSTRUMENT');
    expect(resultado.digitableLine).toBe('34191790010104351004791020150008889950000015000');
  });

  it('o texto rotulado vence o modelo quando nao ha instrumento', () => {
    const input = entrada({ id: 'a', body: 'Valor total: R$ 450,00\nVencimento: 20/06/2022' });
    const resultado = mergeExtraction(
      input,
      extractDeterministic(input, HOJE),
      doModelo({ amountCents: 999999 }),
    );

    expect(resultado.amountCents).toBe(45000);
    expect(resultado.source).toBe('TEXT');
  });

  it('limita a confianca quando so o modelo viu o dado', () => {
    // Um painel de contas a pagar nao pode parecer certo sobre um numero
    // que ninguem conferiu.
    const input = entrada({ id: 'a', body: 'Sua assinatura será renovada em breve.' });
    const resultado = mergeExtraction(
      input,
      extractDeterministic(input, HOJE),
      doModelo({ amountCents: 8990, dueDate: '2022-06-20', confidence: 0.99 }),
    );

    expect(resultado.amountCents).toBe(8990);
    expect(resultado.source).toBe('MODEL');
    expect(resultado.confidence).toBeLessThanOrEqual(MODEL_ONLY_CONFIDENCE_CAP);
    expect(resultado.warnings.join(' ')).toContain('não foi confirmado');
  });

  it('USA o instrumento mesmo com o DV geral falhando — so rebaixa a confianca', () => {
    // Decisao deliberada, e a mais importante deste arquivo. O DV geral
    // (modulo 11) nao pode ser verificado neste ambiente. Se ele fosse a
    // porta de entrada e minha implementacao estivesse errada, todo boleto
    // real cairia calado para o modelo e o painel PARECERIA funcionar.
    const input = entrada({ id: 'a', body: `Segue:\n${LINHA}` });
    const resultado = mergeExtraction(input, extractDeterministic(input, HOJE), null);

    expect(resultado.source).toBe('INSTRUMENT');
    expect(resultado.amountCents).toBe(15000);
    expect(resultado.confidence).toBe(0.75);
    expect(resultado.confidence).toBeLessThan(0.95);
  });

  it('NAO usa o instrumento quando os DVs de campo falham', () => {
    // Esses sim sao verificados contra uma linha real. Digito trocado
    // dentro do campo 1 (banco/moeda/campo livre).
    const input = entrada({ id: 'a', body: '34191790110104351004791020150008889950000015000' });
    const resultado = mergeExtraction(input, extractDeterministic(input, HOJE), null);

    expect(resultado.source).not.toBe('INSTRUMENT');
    expect(resultado.warnings.join(' ')).toContain('não fecha o dígito verificador dos campos');
  });

  it('documenta a lacuna: o VALOR nao e protegido por nenhum DV de campo', () => {
    // Campo 5 (fator de vencimento + valor) nao tem DV proprio — so o DV
    // geral o cobre. Trocar um digito do valor passa batido pelos tres
    // modulo 10. E exatamente por isso que o aviso do DV geral existe, e
    // por isso que o painel manda conferir no e-mail original.
    const valorAdulterado = '34191790010104351004791020150008889950000015001';
    const input = entrada({ id: 'a', body: valorAdulterado });
    const achados = extractDeterministic(input, HOJE);

    expect(achados.boleto?.fieldChecksumValid).toBe(true);
    expect(achados.boleto?.amountCents).toBe(15001);
  });

  it('avisa quando o DV geral nao fecha, sem esconder a cobranca', () => {
    const input = entrada({ id: 'a', body: `Segue:\n${LINHA}` });
    const resultado = mergeExtraction(input, extractDeterministic(input, HOJE), null);

    expect(resultado.digitableLine).not.toBeNull();
    expect(resultado.warnings.join(' ')).toContain('dígito verificador');
  });

  it('funciona sem o modelo — o instrumento sozinho ja da o essencial', () => {
    const input = entrada({ id: 'a', body: `Segue:\n${LINHA}` });
    const resultado = mergeExtraction(input, extractDeterministic(input, HOJE), null);

    expect(resultado.amountCents).toBe(15000);
    expect(resultado.payee).toBe('Fornecedor S/A');
    expect(resultado.warnings.join(' ')).toContain('sem o modelo');
  });

  it('reconhece o PIX e usa o beneficiario do proprio codigo', () => {
    const semCrc =
      '00020126360014BR.GOV.BCB.PIX0114+55619999999995204000053039865406123.45' +
      '5802BR5913Fulano de Tal6008BRASILIA62070503***6304';
    const codigo = semCrc + crc16ccitt(semCrc).toString(16).toUpperCase().padStart(4, '0');
    const input = entrada({ id: 'a', body: `Pague por PIX:\n${codigo}`, fromName: null });

    const resultado = mergeExtraction(input, extractDeterministic(input, HOJE), null);
    expect(resultado.kind).toBe('PIX');
    expect(resultado.amountCents).toBe(12345);
    expect(resultado.payee).toBe('Fulano de Tal');
    expect(resultado.pixKey).toBe('+5561999999999');
  });

  it('assume que e cobranca quando nao ha modelo para dizer o contrario', () => {
    // Aparecer a mais e recuperavel; sumir nao e.
    const input = entrada({ id: 'a', body: 'Recibo de pagamento.' });
    expect(mergeExtraction(input, extractDeterministic(input, HOJE), null).isPayable).toBe(true);
  });

  it('marca como nao-pagavel quando o modelo reconhece um recibo', () => {
    const input = entrada({ id: 'a', body: 'Recibo do pagamento de R$ 150,00 recebido.' });
    const resultado = mergeExtraction(
      input,
      extractDeterministic(input, HOJE),
      doModelo({ isPayable: false }),
    );
    expect(resultado.isPayable).toBe(false);
  });
});

describe('runBillExtraction — orquestracao', () => {
  it('falha de API NAO apaga a extracao deterministica', () => {
    // Diferenca deliberada em relacao a triagem: aqui o item nao vira
    // "revise manualmente" — o boleto continua com valor e vencimento.
    const quebrado: BillModel = {
      name: 'quebrado',
      extract: vi.fn(async () => {
        throw new Error('502 do provedor');
      }),
    };

    return runBillExtraction([entrada({ id: 'a', body: LINHA })], quebrado, HOJE).then((r) => {
      expect(r.extractions[0]?.amountCents).toBe(15000);
      expect(r.extractions[0]?.source).toBe('INSTRUMENT');
      expect(r.modelFailures).toEqual(['a']);
    });
  });

  it('roda sem modelo nenhum (sem API key configurada)', async () => {
    const r = await runBillExtraction([entrada({ id: 'a', body: LINHA })], null, HOJE);
    expect(r.extractions[0]?.amountCents).toBe(15000);
    expect(r.withInstrument).toBe(1);
  });

  it('item que o modelo esqueceu de devolver nao se perde', async () => {
    const r = await runBillExtraction(
      [entrada({ id: 'a', body: LINHA }), entrada({ id: 'b', body: 'Valor total: R$ 10,00' })],
      modeloFalso([doModelo({ id: 'a' })]),
      HOJE,
    );

    expect(r.extractions).toHaveLength(2);
    expect(r.modelFailures).toEqual(['b']);
    expect(r.extractions[1]?.amountCents).toBe(1000);
  });
});

describe('buildBillBatchPrompt', () => {
  it('corta o corpo no limite, para nao mandar rodape de fatura inteiro', () => {
    const prompt = buildBillBatchPrompt([entrada({ id: 'a', body: 'x'.repeat(20000) })]);
    expect(prompt.length).toBeLessThan(MAX_BODY_CHARS + 500);
  });

  it('leva remetente, assunto e data — o modelo precisa deles para o ano', () => {
    const prompt = buildBillBatchPrompt([entrada({ id: 'a', body: 'corpo' })]);
    expect(prompt).toContain('Fornecedor S/A');
    expect(prompt).toContain('Fatura de agosto');
    expect(prompt).toContain('2022-05-10');
  });
});
