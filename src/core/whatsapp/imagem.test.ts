import { describe, expect, it } from 'vitest';
import {
  interpretarLeitura,
  lerComprovanteDeImagem,
  MAX_BYTES_IMAGEM,
  TETO_SEM_DV,
  type LeituraDoModelo,
} from './imagem';

const AGORA = new Date('2026-09-03T12:00:00Z');

// Linha digitavel valida (a mesma do PDF exercitado): R$ 1.740,80, vence 10/09.
const LINHA_BOA = '34191790010104351004791020150008484410000174080';

const leitura = (over: Partial<LeituraDoModelo> = {}): LeituraDoModelo => ({
  ehComprovante: true,
  amountCents: 89900,
  direcao: 'SAIDA',
  contraparte: 'Mercado Central',
  data: '2026-09-01',
  linhaDigitavel: null,
  motivo: 'Cupom fiscal com total de R$ 899,00',
  ...over,
});

describe('interpretarLeitura — sem digito verificador e palpite declarado', () => {
  it('le valor, direcao, contraparte e data', () => {
    const r = interpretarLeitura(leitura(), AGORA);
    expect(r.amountCents).toBe(89900);
    expect(r.direcao).toBe('SAIDA');
    expect(r.descricao).toBe('Mercado Central');
    expect(r.data?.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('a confianca NUNCA chega perto de 1 sem DV', () => {
    // Foto lida por modelo e a fonte mais fraca deste app. Declarar isso e o
    // que faz o dono conferir em vez de confirmar no automatico.
    expect(interpretarLeitura(leitura(), AGORA).confianca).toBe(TETO_SEM_DV);
    expect(TETO_SEM_DV).toBeLessThan(0.8);
  });

  it('comprovante de RECEBIMENTO nao vira saida — inverteria o caixa', () => {
    expect(interpretarLeitura(leitura({ direcao: 'ENTRADA' }), AGORA).direcao).toBe('ENTRADA');
  });

  it('imagem que nao e documento financeiro e recusada', () => {
    const r = interpretarLeitura(leitura({ ehComprovante: false }), AGORA);
    expect(r.amountCents).toBeUndefined();
    expect(r.confianca).toBe(0);
  });

  it('sem valor, nao inventa', () => {
    const r = interpretarLeitura(leitura({ amountCents: null }), AGORA);
    expect(r.amountCents).toBeUndefined();
    expect(r.motivo).toBeTruthy();
  });

  it('valor absurdo do modelo nao chega ao banco', () => {
    // Mesma trava do texto: acima do que o Int aceita, a gravacao estouraria
    // e o webhook devolveria 500.
    const r = interpretarLeitura(leitura({ amountCents: 717262299560894000 }), AGORA);
    expect(r.amountCents).toBeUndefined();
  });

  it('data ilegivel nao vira data', () => {
    for (const d of [null, 'ontem', '01/09/2026', '']) {
      expect(interpretarLeitura(leitura({ data: d }), AGORA).data).toBeUndefined();
    }
  });
});

describe('quando ha linha digitavel, quem manda e a aritmetica', () => {
  it('DV que fecha SOBREPÕE o valor que o modelo leu', () => {
    // O modelo pode ler 899,00 numa foto tremida; o codigo diz 1.740,80 e o
    // digito verificador prova. Confiar no modelo aqui seria jogar fora a
    // unica verificacao real que este app tem.
    const r = interpretarLeitura(leitura({ linhaDigitavel: LINHA_BOA, amountCents: 89900 }), AGORA);
    expect(r.amountCents).toBe(174080);
    expect(r.dvConfere).toBe(true);
    expect(r.confianca).toBeGreaterThan(0.9);
    expect(r.descricao).toContain('Boleto');
  });

  it('aceita a linha com pontuacao, como aparece no papel', () => {
    const comPontos = '34191.79001 01043.510047 91020.150008 4 84410000174080';
    expect(interpretarLeitura(leitura({ linhaDigitavel: comPontos }), AGORA).dvConfere).toBe(true);
  });

  it('boleto e sempre SAIDA, mesmo se o modelo disser outra coisa', () => {
    expect(interpretarLeitura(leitura({ linhaDigitavel: LINHA_BOA, direcao: 'ENTRADA' }), AGORA).direcao).toBe('SAIDA');
  });

  it('linha curta demais nao e tratada como codigo', () => {
    const r = interpretarLeitura(leitura({ linhaDigitavel: '1234' }), AGORA);
    expect(r.dvConfere).toBeUndefined();
    expect(r.confianca).toBe(TETO_SEM_DV);
  });

  it('DV que NAO fecha nao ganha confianca alta', () => {
    const quebrada = LINHA_BOA.slice(0, -1) + '9';
    const r = interpretarLeitura(leitura({ linhaDigitavel: quebrada }), AGORA);
    if (r.dvConfere !== undefined) expect(r.dvConfere).toBe(false);
    expect(r.confianca).toBeLessThanOrEqual(TETO_SEM_DV);
  });
});

describe('travas ANTES de gastar uma chamada de modelo', () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it('formato que a API nao aceita nem tenta', async () => {
    for (const t of ['image/bmp', 'application/pdf', 'audio/ogg', '', undefined]) {
      const r = await lerComprovanteDeImagem(bytes, t);
      expect(r.confianca).toBe(0);
      expect(r.motivo).toMatch(/formato|Não sei ler/i);
    }
  });

  it('aceita o content-type com parametro, como os provedores mandam', async () => {
    // "image/jpeg; charset=binary" nao pode ser tratado como formato estranho.
    const r = await lerComprovanteDeImagem(new Uint8Array(), 'image/jpeg; charset=binary');
    expect(r.motivo).toBe('Imagem vazia.');
  });

  it('imagem vazia e imagem grande demais param aqui', async () => {
    expect((await lerComprovanteDeImagem(new Uint8Array(), 'image/jpeg')).motivo).toBe('Imagem vazia.');
    const gorda = new Uint8Array(MAX_BYTES_IMAGEM + 1);
    expect((await lerComprovanteDeImagem(gorda, 'image/png')).motivo).toMatch(/grande demais/);
  });
});
