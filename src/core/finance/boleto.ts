/**
 * Leitura deterministica de linha digitavel de boleto.
 *
 * Ver docs/07-agente-de-triagem.md (fase 5B). Este arquivo existe por um
 * motivo que vale repetir: **um modelo de linguagem nao pode ser a fonte da
 * linha digitavel**. Ele pode trocar um digito, e o resultado e um pagamento
 * feito para o lugar errado — irreversivel, do lado do dinheiro.
 *
 * A linha digitavel carrega digito verificador e, no caso de titulo,
 * carrega tambem o proprio valor e o proprio vencimento. Quando ela esta
 * presente e valida, valor e vencimento saem DELA, nao do modelo.
 */

export type BoletoKind = 'TITULO' | 'ARRECADACAO';

export interface BoletoParsed {
  kind: BoletoKind;
  /** So digitos, como aparece para digitar (47 ou 48). */
  digitableLine: string;
  /** Codigo de barras reconstruido (44 digitos). */
  barcode: string;
  /** Banco emissor, so para titulo. */
  bankCode?: string;
  /** Valor em centavos. `null` quando o boleto nao traz valor. */
  amountCents: number | null;
  /** Vencimento, so para titulo e so quando o fator e valido. */
  dueDate: Date | null;
  /**
   * DVs dos campos da linha digitavel (modulo 10). Protegem banco, moeda e
   * todo o campo livre — e sao a defesa real contra erro de digitacao/OCR.
   */
  fieldChecksumValid: boolean;
  /**
   * DV geral do codigo de barras (modulo 11). E o UNICO que protege o campo
   * 5, onde moram o valor e o fator de vencimento — por isso ele importa
   * tanto aqui.
   *
   * RESSALVA: nao foi possivel validar esta implementacao contra um boleto
   * real neste ambiente (sem rede para buscar referencia e sem boleto em
   * maos). Ela segue a especificacao FEBRABAN, mas trate um `false` como
   * "confira no e-mail original", nunca como "descarte a cobranca" — e por
   * isso que `findBoletos` devolve os invalidos em vez de filtrar.
   */
  generalChecksumValid: boolean;
  /** Os dois acima. Valor e vencimento so sao confiaveis quando verdadeiro. */
  checksumValid: boolean;
}

// ---------------------------------------------------------------------------
// Digitos verificadores
// ---------------------------------------------------------------------------

/** Modulo 10 (FEBRABAN): pesos 2,1 da direita para a esquerda. */
export function mod10(digitos: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = digitos.length - 1; i >= 0; i -= 1) {
    const produto = Number(digitos[i]) * peso;
    // Produto de dois digitos entra como a soma dos seus digitos.
    soma += produto > 9 ? produto - 9 : produto;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

/**
 * Modulo 11 do DV geral do codigo de barras: pesos 2..9 ciclicos.
 *
 * Resto 0, 1 ou 10 vira DV 1 — regra da FEBRABAN, e a fonte classica de
 * implementacao errada.
 */
export function mod11Barcode(digitos: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = digitos.length - 1; i >= 0; i -= 1) {
    soma += Number(digitos[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

// ---------------------------------------------------------------------------
// Fator de vencimento
// ---------------------------------------------------------------------------

const DIA_MS = 86_400_000;
/** Base historica do fator de vencimento. */
const BASE_ANTIGA = Date.UTC(1997, 9, 7);
/**
 * O fator estourou em 9999 (21/02/2025) e recomecou em 1000 no dia
 * seguinte. Ignorar isso faz todo boleto novo virar uma data de 1999.
 */
const BASE_NOVA = Date.UTC(2025, 1, 22);
const FATOR_REINICIO = 1000;

/**
 * Converte o fator de vencimento em data.
 *
 * Como as duas bases produzem candidatos validos, escolhe pela unica coisa
 * que distingue: plausibilidade. Um boleto que chega hoje na sua caixa nao
 * vence em 1999.
 */
export function dueDateFromFator(fator: number, hoje = new Date()): Date | null {
  if (!Number.isInteger(fator) || fator <= 0 || fator > 9999) return null;

  const candidatos: Date[] = [new Date(BASE_ANTIGA + fator * DIA_MS)];
  if (fator >= FATOR_REINICIO) {
    candidatos.push(new Date(BASE_NOVA + (fator - FATOR_REINICIO) * DIA_MS));
  }

  // Escolhe o candidato mais proximo de hoje. Um boleto que chegou na sua
  // caixa vence perto de agora; a alternativa esta sempre a mais de duas
  // decadas de distancia, entao a escolha nunca e apertada.
  let melhor = candidatos[0] ?? null;
  for (const candidato of candidatos.slice(1)) {
    const distancia = Math.abs(candidato.getTime() - hoje.getTime());
    const atual = melhor ? Math.abs(melhor.getTime() - hoje.getTime()) : Infinity;
    if (distancia < atual) melhor = candidato;
  }
  return melhor;
}

// ---------------------------------------------------------------------------
// Titulo (47 digitos)
// ---------------------------------------------------------------------------

function parseTitulo(linha: string, hoje: Date): BoletoParsed {
  const campo1 = linha.slice(0, 9);
  const dv1 = Number(linha[9]);
  const campo2 = linha.slice(10, 20);
  const dv2 = Number(linha[20]);
  const campo3 = linha.slice(21, 31);
  const dv3 = Number(linha[31]);
  const dvGeral = Number(linha[32]);
  const fator = Number(linha.slice(33, 37));
  const valor = linha.slice(37, 47);

  // Codigo de barras: banco+moeda, DV geral, fator, valor, e o campo livre
  // remontado a partir dos tres campos da linha digitavel.
  const barcode =
    campo1.slice(0, 4) + String(dvGeral) + linha.slice(33, 47) + campo1.slice(4) + campo2 + campo3;

  const semDv = barcode.slice(0, 4) + barcode.slice(5);
  const fieldChecksumValid = mod10(campo1) === dv1 && mod10(campo2) === dv2 && mod10(campo3) === dv3;
  const generalChecksumValid = mod11Barcode(semDv) === dvGeral;

  const centavos = Number(valor);

  return {
    kind: 'TITULO',
    digitableLine: linha,
    barcode,
    bankCode: linha.slice(0, 3),
    // Valor zerado significa "boleto sem valor definido" (o pagador
    // informa), nao "R$ 0,00" — devolver 0 mentiria para o painel.
    amountCents: centavos > 0 ? centavos : null,
    dueDate: dueDateFromFator(fator, hoje),
    fieldChecksumValid,
    generalChecksumValid,
    checksumValid: fieldChecksumValid && generalChecksumValid,
  };
}

// ---------------------------------------------------------------------------
// Arrecadacao / convenio (48 digitos, comeca com 8)
// ---------------------------------------------------------------------------

function parseArrecadacao(linha: string): BoletoParsed {
  // Quatro blocos de 11 digitos + DV. O tipo de DV depende do indicador de
  // valor na terceira posicao do codigo de barras.
  const indicador = linha[2];
  const usaMod11 = indicador === '8' || indicador === '9';

  let blocosValidos = true;
  let barcode = '';
  for (let i = 0; i < 4; i += 1) {
    const bloco = linha.slice(i * 12, i * 12 + 11);
    const dv = Number(linha[i * 12 + 11]);
    barcode += bloco;
    const esperado = usaMod11 ? mod11Bloco(bloco) : mod10(bloco);
    if (esperado !== dv) blocosValidos = false;
  }

  // Valor efetivo em Real: indicadores 6 e 8. Os outros dois sao "valor
  // referencia" (quantidade de moeda), que nao e reais — tratar como
  // dinheiro seria erro grave num painel de contas a pagar.
  const valorEfetivo = indicador === '6' || indicador === '8';
  const centavos = Number(barcode.slice(4, 15));

  return {
    kind: 'ARRECADACAO',
    digitableLine: linha,
    barcode,
    amountCents: valorEfetivo && centavos > 0 ? centavos : null,
    // Arrecadacao nao carrega vencimento no codigo. Fica para o modelo, e
    // com confianca menor — declarado, nao escondido.
    dueDate: null,
    // Na arrecadacao os DVs de bloco cobrem os 44 digitos, valor incluso —
    // nao ha a lacuna do campo 5 que existe no titulo.
    fieldChecksumValid: blocosValidos,
    generalChecksumValid: blocosValidos,
    checksumValid: blocosValidos,
  };
}

/** Modulo 11 de bloco de arrecadacao: pesos 2..9, resto 0/1 vira DV 0. */
function mod11Bloco(digitos: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = digitos.length - 1; i >= 0; i -= 1) {
    soma += Number(digitos[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = 11 - resto;
  return dv === 10 || dv === 11 ? 0 : dv;
}

// ---------------------------------------------------------------------------
// Localizacao no texto
// ---------------------------------------------------------------------------

/**
 * Sequencias longas de digitos que podem ser linha digitavel.
 *
 * A linha vem formatada de mil maneiras ("00190.00009 01234.567895 ...",
 * com pontos, espacos e quebras). O padrao aceita separadores e depois
 * conta os digitos.
 */
const CANDIDATO = /[0-9][0-9.\s-]{44,80}[0-9]/g;

/**
 * Acha as linhas digitaveis de um texto, validadas mas **nunca filtradas**.
 *
 * Uma linha que nao fecha o DV e informacao, nao lixo: significa texto
 * corrompido na extracao, OCR ruim ou boleto adulterado. Descartar em
 * silencio faria a cobranca sumir do painel — exatamente o modo de falha
 * que a fase 5B existe para evitar.
 *
 * A ordenacao coloca as validas primeiro; quem consome usa a primeira e
 * mostra o aviso quando `checksumValid` e falso.
 */
export function findBoletos(texto: string, hoje = new Date()): BoletoParsed[] {
  const porLinha = new Map<string, BoletoParsed>();

  for (const bruto of texto.match(CANDIDATO) ?? []) {
    const digitos = bruto.replace(/\D/g, '');

    // Uma sequencia maior pode conter a linha; testa as janelas de 47 e 48.
    for (const tamanho of [47, 48]) {
      for (let i = 0; i + tamanho <= digitos.length; i += 1) {
        const linha = digitos.slice(i, i + tamanho);
        if (porLinha.has(linha)) continue;

        const ehArrecadacao = linha.startsWith('8');
        if (tamanho === 48 && !ehArrecadacao) continue;
        if (tamanho === 47 && ehArrecadacao) continue;

        porLinha.set(linha, ehArrecadacao ? parseArrecadacao(linha) : parseTitulo(linha, hoje));
      }
    }
  }

  const achados = [...porLinha.values()];

  // Quando ha varias janelas possiveis dentro de uma sequencia longa, so as
  // validas sao janelas de verdade — as outras sao deslocamentos por acaso.
  const validas = achados.filter((b) => b.checksumValid);
  if (validas.length > 0) return validas;

  const camposOk = achados.filter((b) => b.fieldChecksumValid);
  if (camposOk.length > 0) return camposOk;

  // Nada validou: devolve no maximo um palpite, para a UI poder dizer
  // "achei algo com cara de linha digitavel que nao confere".
  return achados.slice(0, 1);
}
