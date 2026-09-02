import type { ExtratoLido, LancamentoBruto } from './types';

/**
 * Extrato de conta do Nubank em PDF — o formato que o app exporta.
 *
 * Verificado contra um extrato real de 26 paginas. O que o texto extraido
 * tem de traicoeiro, e que este leitor absorve:
 *
 * - O cabecalho (titular, CNPJ, agencia/conta, periodo) e o rodape
 *   (atendimento, ouvidoria, "Extrato gerado dia", numero da pagina)
 *   REPETEM em toda pagina — inclusive NO MEIO de um lancamento que quebrou
 *   de uma pagina para outra. O buffer de descricao sobrevive ao ruido.
 * - Nao ha coluna de sinal. O sinal vem do CONTEXTO: os lancamentos abaixo
 *   de "Total de entradas" sao creditos; abaixo de "Total de saidas",
 *   debitos. Um dia pode ter os dois blocos, em qualquer ordem.
 * - O valor as vezes vem numa linha propria, as vezes no fim da linha da
 *   descricao. Uma descricao pode ocupar tres linhas (nome, banco/agencia,
 *   numero da conta).
 * - "Saldo do dia" fecha o dia e NAO e lancamento.
 *
 * Sem FITID: a deduplicacao e por impressao digital, como no CSV.
 */

const MESES: Record<string, number> = {
  JAN: 0, FEV: 1, MAR: 2, ABR: 3, MAI: 4, JUN: 5, JUL: 6, AGO: 7, SET: 8, OUT: 9, NOV: 10, DEZ: 11,
};
const MESES_LONGOS: Record<string, number> = {
  JANEIRO: 0, FEVEREIRO: 1, MARÇO: 2, MARCO: 2, ABRIL: 3, MAIO: 4, JUNHO: 5, JULHO: 6,
  AGOSTO: 7, SETEMBRO: 8, OUTUBRO: 9, NOVEMBRO: 10, DEZEMBRO: 11,
};

const VALOR = String.raw`\d{1,3}(?:\.\d{3})*,\d{2}`;
const RE_DIA = new RegExp(
  String.raw`^(\d{2}) (JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ) (\d{4})(?:\s+Total de (entradas|saídas|saidas)\s*([+-])\s*(${VALOR}))?\s*$`,
);
const RE_TOTAL = new RegExp(String.raw`^Total de (entradas|saídas|saidas)\s*([+-])\s*(${VALOR})\s*$`);
const RE_SALDO_DIA = new RegExp(String.raw`^Saldo do dia\s+-?${VALOR}\s*$`);
const RE_SO_VALOR = new RegExp(String.raw`^(${VALOR})\s*$`);
const RE_TERMINA_EM_VALOR = new RegExp(String.raw`^(.*\S)\s+(${VALOR})\s*$`);
const RE_PERIODO = /(\d{2}) DE ([A-ZÇ]+) DE (\d{4})\s+(\d{2}) DE ([A-ZÇ]+) DE (\d{4})/;
const RE_AGENCIA = /(\d{4})\s*CNPJ\s+Agência\s+Conta/;
const RE_CONTA = /^\d{5,}-\d$/;

/** Rodape e bloco juridico, iguais em todo extrato. */
const RUIDO = [
  /^Tem alguma dúvida\?/,
  /^metropolitanas\)/,
  /^Caso a solução fornecida/,
  /^disponíveis em nubank\.com\.br/,
  /^Extrato gerado dia/,
  /^\d+ de \d+$/,
];
const FIM = [/^O saldo líquido corresponde/, /^Não nos responsabilizamos/, /^Asseguramos a autenticidade/];

/** Codigo Bacen do Nu Pagamentos. */
const BANCO_NUBANK = '0260';

/** Meio-dia de Brasilia, como nos outros leitores: o dia certo em qualquer fuso. */
function dia(ano: number, mes: number, d: number): Date {
  return new Date(Date.UTC(ano, mes, d, 15, 0, 0));
}

function centavos(texto: string): number {
  return Math.round(Number(texto.replace(/\./g, '').replace(',', '.')) * 100);
}

export function pareceExtratoNubank(texto: string): boolean {
  return /Movimentações/.test(texto) && /Saldo do dia/.test(texto) && /nubank\.com\.br|Nu Pagamentos/i.test(texto);
}

export function lerExtratoNubankPdf(texto: string): ExtratoLido {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim());
  const lancamentos: LancamentoBruto[] = [];
  const avisos: string[] = [];
  const conta: ExtratoLido['conta'] = { bankId: BANCO_NUBANK, kind: 'CHECKING', currency: 'BRL' };
  let periodStart: Date | undefined;
  let periodEnd: Date | undefined;

  // --- Cabecalho: tudo ate "Movimentações". As mesmas linhas voltam em
  // cada pagina, entao viram um conjunto de ruido a ignorar dali em diante.
  const inicioMov = linhas.findIndex((l) => /^Movimentações/.test(l));
  if (inicioMov < 0) {
    return { formato: 'PDF', conta, lancamentos, avisos: ['Não achei a seção "Movimentações" no PDF.'] };
  }
  const cabecalho = new Set<string>();
  for (let i = 0; i < inicioMov; i += 1) {
    const l = linhas[i]!;
    if (!l) continue;
    const per = RE_PERIODO.exec(l);
    if (per) {
      const m1 = MESES_LONGOS[per[2]!];
      const m2 = MESES_LONGOS[per[5]!];
      if (m1 !== undefined && m2 !== undefined) {
        periodStart = dia(Number(per[3]), m1, Number(per[1]));
        periodEnd = dia(Number(per[6]), m2, Number(per[4]));
      }
      cabecalho.add(l);
      continue;
    }
    const ag = RE_AGENCIA.exec(l);
    if (ag) {
      cabecalho.add(l);
      const prox = linhas[i + 1] ?? '';
      if (RE_CONTA.test(prox)) conta.accountId = `${ag[1]}/${prox}`;
      continue;
    }
    if (/^Saldo final do período/.test(l)) {
      const prox = /R\$\s*(-?[\d.]+,\d{2})/.exec(linhas[i + 1] ?? '');
      if (prox && conta.balanceCents === undefined) conta.balanceCents = centavos(prox[1]!);
      continue;
    }
    // Titular, CNPJ, "VALORES EM R$": repetem por pagina.
    if (i < 6) cabecalho.add(l);
  }
  if (periodEnd && conta.balanceCents !== undefined) conta.balanceAt = periodEnd;

  // --- Movimentacoes: maquina de estados.
  let diaAtual: Date | undefined;
  let sinal: 1 | -1 | undefined;
  let buffer: string[] = [];
  let descartadas = 0;
  let reanexadas = 0;

  // Texto que sobrou sem valor num ponto de corte (dia, total, saldo). O
  // caso real: a quebra de pagina cai DEPOIS do valor e ANTES do fim da
  // descricao — o rabo (banco, agencia, conta) chega orfao. O valor ja foi
  // gravado; so a descricao ficou truncada. Se o ultimo lancamento e do
  // mesmo dia e o rabo nao parece comeco de lancamento, e dele.
  const soltar = () => {
    if (buffer.length === 0) return;
    const rabo = buffer.join(' ').replace(/\s+/g, ' ').trim();
    buffer = [];
    const ultimo = lancamentos[lancamentos.length - 1];
    const pareceInicio = /^(Transferência|Pagamento|Crédito|Débito|Compra|Estorno|Rendimento)/i.test(rabo);
    if (ultimo && diaAtual && ultimo.postedAt.getTime() === diaAtual.getTime() && !pareceInicio) {
      ultimo.description = `${ultimo.description} ${rabo}`.trim();
      reanexadas += 1;
      return;
    }
    descartadas += 1;
  };

  const emitir = (valorTexto: string, prefixo?: string) => {
    const descricao = [...buffer, prefixo ?? ''].join(' ').replace(/\s+/g, ' ').trim();
    buffer = [];
    if (!diaAtual || !sinal) {
      descartadas += 1;
      return;
    }
    lancamentos.push({
      postedAt: diaAtual,
      amountCents: sinal * centavos(valorTexto),
      description: descricao || '(sem descrição)',
      tipoBanco: sinal > 0 ? 'CREDIT' : 'DEBIT',
    });
  };

  for (let i = inicioMov + 1; i < linhas.length; i += 1) {
    const l = linhas[i]!;
    if (!l) continue;
    if (FIM.some((re) => re.test(l))) break;
    if (cabecalho.has(l) || RUIDO.some((re) => re.test(l))) continue;
    // Numero da conta logo abaixo da linha de agencia repete por pagina.
    if (RE_CONTA.test(l) && conta.accountId?.endsWith(l)) continue;

    const d = RE_DIA.exec(l);
    if (d) {
      soltar();
      diaAtual = dia(Number(d[3]), MESES[d[2]!]!, Number(d[1]));
      sinal = d[4] ? (d[5] === '-' ? -1 : 1) : undefined;
      continue;
    }
    const t = RE_TOTAL.exec(l);
    if (t) {
      soltar();
      sinal = t[2] === '-' ? -1 : 1;
      continue;
    }
    if (RE_SALDO_DIA.test(l)) {
      soltar();
      continue;
    }
    const so = RE_SO_VALOR.exec(l);
    if (so) {
      emitir(so[1]!);
      continue;
    }
    const fim = RE_TERMINA_EM_VALOR.exec(l);
    if (fim) {
      emitir(fim[2]!, fim[1]);
      continue;
    }
    buffer.push(l);
  }

  if (descartadas > 0) {
    avisos.push(`${descartadas} trecho(s) de texto sem valor foram ignorados.`);
  }
  if (reanexadas > 0) {
    avisos.push(
      `${reanexadas} descrição(ões) estavam partidas por quebra de página e foram remontadas.`,
    );
  }
  if (lancamentos.length === 0) {
    avisos.push('Nenhum lançamento reconhecido entre "Movimentações" e o fim do extrato.');
  }

  return { formato: 'PDF', conta, periodStart, periodEnd, lancamentos, avisos };
}
