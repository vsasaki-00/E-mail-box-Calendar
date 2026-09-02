import type { ExtratoLido, LancamentoBruto } from './types';

/**
 * Leitor de CSV de extrato bancario.
 *
 * Nao existe "o CSV do banco": cada um exporta de um jeito, e o mesmo banco
 * muda entre o app e o internet banking. O que este leitor faz e
 * DESCOBRIR o formato a partir do proprio arquivo — separador, cabecalho,
 * formato de numero e de data — em vez de exigir configuracao por banco.
 * Os formatos verificados nos testes:
 *
 * - `Data;Descrição;Valor` com `dd/mm/aaaa` e `1.234,56` (Itaú, Inter, Bradesco)
 * - `date,category,title,amount` com `aaaa-mm-dd` e `1234.56` (Nubank)
 * - colunas separadas `Crédito` e `Débito` (Bradesco, Santander)
 * - `Saldo` no fim da linha, que precisa ser IGNORADO (nao e lancamento)
 *
 * Toda linha que nao der para ler vira aviso, nunca silencio: extrato com
 * uma linha faltando e pior que extrato recusado, porque parece completo.
 */

interface Colunas {
  data: number;
  descricao: number[];
  valor?: number;
  credito?: number;
  debito?: number;
}

/** Cabecalhos que cada papel costuma ter. Comparacao sem acento, minuscula. */
const CABECALHOS = {
  data: ['data', 'date', 'data lancamento', 'data mov', 'data movimento', 'dt'],
  descricao: [
    'descricao',
    'description',
    'historico',
    'title',
    'lancamento',
    'memo',
    'detalhes',
    'estabelecimento',
    'nome',
  ],
  valor: ['valor', 'amount', 'value', 'valor (r$)', 'vlr'],
  credito: ['credito', 'credit', 'entrada', 'entradas', 'deposito'],
  debito: ['debito', 'debit', 'saida', 'saidas', 'retirada'],
  ignorar: ['saldo', 'balance', 'categoria', 'category', 'documento', 'docto', 'id', 'identificador'],
} as const;

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Escolhe o separador que produz o maior numero CONSISTENTE de colunas. */
export function detectarSeparador(linhas: string[]): string {
  const candidatos = [';', ',', '\t', '|'];
  let melhor = ';';
  let melhorPontuacao = -1;

  for (const sep of candidatos) {
    const contagens = linhas.slice(0, 20).map((l) => dividirLinha(l, sep).length);
    if (contagens.length === 0) continue;
    const moda = contagens
      .sort((a, b) => a - b)
      .reduce<{ valor: number; vezes: number }>(
        (acc, n, i, arr) => {
          const vezes = arr.filter((x) => x === n).length;
          return vezes > acc.vezes ? { valor: n, vezes } : acc;
        },
        { valor: 1, vezes: 0 },
      );
    // Duas colunas e o minimo para ser um extrato; mais consistencia e
    // mais colunas ganham.
    const pontuacao = moda.valor < 2 ? -1 : moda.vezes * 10 + moda.valor;
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhor = sep;
    }
  }
  return melhor;
}

/** Divide respeitando aspas: `"1.234,56"` e `"Loja, Ltda"`. */
export function dividirLinha(linha: string, sep: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let entreAspas = false;

  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (c === '"') {
      if (entreAspas && linha[i + 1] === '"') {
        atual += '"';
        i += 1;
      } else {
        entreAspas = !entreAspas;
      }
    } else if (c === sep && !entreAspas) {
      campos.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

/** `dd/mm/aaaa`, `dd/mm/aa`, `aaaa-mm-dd`, `dd-mm-aaaa` → Date ao meio-dia de Brasilia. */
export function lerDataCsv(bruta: string): Date | undefined {
  const texto = bruta.trim();
  let ano: number;
  let mes: number;
  let dia: number;

  let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\s.*)?$/.exec(texto);
  if (m) {
    dia = Number(m[1]);
    mes = Number(m[2]);
    ano = Number(m[3]);
    if (ano < 100) ano += 2000;
  } else {
    m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(texto);
    if (!m) return undefined;
    ano = Number(m[1]);
    mes = Number(m[2]);
    dia = Number(m[3]);
  }

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return undefined;
  // Meio-dia em Brasilia (UTC-3) = 15:00Z: cai no dia certo em qualquer
  // fuso entre -11 e +8, que cobre onde este app vai ser aberto.
  const data = new Date(Date.UTC(ano, mes - 1, dia, 15, 0, 0));
  return Number.isNaN(data.getTime()) ? undefined : data;
}

/** `1.234,56`, `1234.56`, `-R$ 1.234,56`, `(1.234,56)` → centavos assinados. */
export function lerValorCsv(bruto: string): number | undefined {
  let texto = bruto.trim();
  if (!texto) return undefined;

  // Parenteses = negativo, convencao contabil.
  let negativo = false;
  if (/^\(.*\)$/.test(texto)) {
    negativo = true;
    texto = texto.slice(1, -1);
  }
  // Sinal, moeda, espacos.
  texto = texto.replace(/R\$|BRL|\s/gi, '');
  if (texto.startsWith('-')) {
    negativo = !negativo;
    texto = texto.slice(1);
  } else if (texto.startsWith('+')) {
    texto = texto.slice(1);
  }
  // Sinal no fim: `1.234,56-` (Santander).
  if (texto.endsWith('-')) {
    negativo = !negativo;
    texto = texto.slice(0, -1);
  }
  if (texto.endsWith('D')) {
    negativo = true;
    texto = texto.slice(0, -1);
  } else if (texto.endsWith('C')) {
    texto = texto.slice(0, -1);
  }

  const ultimaVirgula = texto.lastIndexOf(',');
  const ultimoPonto = texto.lastIndexOf('.');
  if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
    texto =
      ultimaVirgula > ultimoPonto
        ? texto.replace(/\./g, '').replace(',', '.')
        : texto.replace(/,/g, '');
  } else if (ultimaVirgula >= 0) {
    // So virgula: decimal se tem 1-2 digitos depois, senao e milhar.
    const depois = texto.length - ultimaVirgula - 1;
    texto = depois <= 2 ? texto.replace(',', '.') : texto.replace(/,/g, '');
  } else if (ultimoPonto >= 0) {
    // So ponto: `1.234` e milhar brasileiro; `12.5` e decimal.
    const depois = texto.length - ultimoPonto - 1;
    if (depois === 3 && (texto.match(/\./g) ?? []).length >= 1 && !/^\d{1,3}\.\d{3}$/.test(texto)) {
      texto = texto.replace(/\./g, '');
    } else if (depois === 3 && /^\d{1,3}\.\d{3}$/.test(texto)) {
      texto = texto.replace(/\./g, '');
    }
  }

  if (!/^\d+(\.\d+)?$/.test(texto)) return undefined;
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return undefined;
  return Math.round(numero * 100) * (negativo ? -1 : 1);
}

function classificarCabecalho(celulas: string[]): Colunas | undefined {
  const nomes = celulas.map(semAcento);
  const achar = (lista: readonly string[]) =>
    nomes.findIndex((n) => lista.some((c) => n === c || n.startsWith(c + ' ') || n.startsWith(c + '(')));

  const data = achar(CABECALHOS.data);
  if (data < 0) return undefined;

  const descricao = nomes
    .map((n, i) => (CABECALHOS.descricao.some((c) => n === c || n.startsWith(c)) ? i : -1))
    .filter((i) => i >= 0);

  const valor = achar(CABECALHOS.valor);
  const credito = achar(CABECALHOS.credito);
  const debito = achar(CABECALHOS.debito);

  if (valor < 0 && credito < 0 && debito < 0) return undefined;
  if (descricao.length === 0) return undefined;

  return {
    data,
    descricao,
    valor: valor >= 0 ? valor : undefined,
    credito: credito >= 0 ? credito : undefined,
    debito: debito >= 0 ? debito : undefined,
  };
}

/**
 * Sem cabecalho reconhecivel, tenta por FORMA: a coluna que parece data,
 * a que parece numero, e o resto e descricao.
 */
function inferirColunas(linhas: string[][]): Colunas | undefined {
  const amostra = linhas.slice(0, 10);
  if (amostra.length === 0) return undefined;
  const largura = Math.max(...amostra.map((l) => l.length));

  const pareceData = (i: number) => amostra.every((l) => l[i] === undefined || l[i] === '' || lerDataCsv(l[i]!));
  const pareceNumero = (i: number) =>
    amostra.every((l) => l[i] === undefined || l[i] === '' || lerValorCsv(l[i]!) !== undefined) &&
    amostra.some((l) => l[i] && lerValorCsv(l[i]!) !== undefined && !lerDataCsv(l[i]!));

  let data = -1;
  const numeros: number[] = [];
  for (let i = 0; i < largura; i += 1) {
    if (data < 0 && pareceData(i)) data = i;
    else if (pareceNumero(i)) numeros.push(i);
  }
  if (data < 0 || numeros.length === 0) return undefined;

  // Primeiro numero e o valor; um segundo costuma ser o saldo, que se ignora.
  const valor = numeros[0]!;
  const descricao = Array.from({ length: largura }, (_, i) => i).filter(
    (i) => i !== data && !numeros.includes(i),
  );
  if (descricao.length === 0) return undefined;
  return { data, descricao, valor };
}

export function lerCsv(conteudo: string): ExtratoLido {
  const avisos: string[] = [];
  const lancamentos: LancamentoBruto[] = [];

  const linhas = conteudo
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (linhas.length === 0) {
    return { formato: 'CSV', conta: {}, lancamentos, avisos: ['Arquivo vazio.'] };
  }

  const sep = detectarSeparador(linhas);
  const tabela = linhas.map((l) => dividirLinha(l, sep));

  // Cabecalho pode nao estar na primeira linha (bancos poem titulo, conta,
  // periodo antes). Procura nas 10 primeiras.
  let colunas: Colunas | undefined;
  let inicio = 0;
  for (let i = 0; i < Math.min(10, tabela.length); i += 1) {
    const c = classificarCabecalho(tabela[i]!);
    if (c) {
      colunas = c;
      inicio = i + 1;
      break;
    }
  }
  if (!colunas) {
    colunas = inferirColunas(tabela);
    inicio = 0;
    if (colunas) avisos.push('Sem cabeçalho reconhecível; colunas inferidas pela forma dos dados.');
  }
  if (!colunas) {
    return {
      formato: 'CSV',
      conta: {},
      lancamentos,
      avisos: [
        'Não encontrei colunas de data, descrição e valor. ' +
          'Cabeçalhos aceitos: Data, Descrição/Histórico, Valor (ou Crédito e Débito).',
      ],
    };
  }

  let ilegiveis = 0;
  for (let i = inicio; i < tabela.length; i += 1) {
    const celulas = tabela[i]!;
    const dataBruta = celulas[colunas.data] ?? '';
    const postedAt = lerDataCsv(dataBruta);
    if (!postedAt) {
      // Linha de rodape ("Saldo final", "Total") ou de titulo: nao e erro,
      // mas contamos para o aviso.
      if (celulas.some((c) => c)) ilegiveis += 1;
      continue;
    }

    let amountCents: number | undefined;
    if (colunas.valor !== undefined) {
      amountCents = lerValorCsv(celulas[colunas.valor] ?? '');
    }
    if (amountCents === undefined && (colunas.credito !== undefined || colunas.debito !== undefined)) {
      const cred = colunas.credito !== undefined ? lerValorCsv(celulas[colunas.credito] ?? '') : undefined;
      const deb = colunas.debito !== undefined ? lerValorCsv(celulas[colunas.debito] ?? '') : undefined;
      if (cred !== undefined && cred !== 0) amountCents = Math.abs(cred);
      else if (deb !== undefined && deb !== 0) amountCents = -Math.abs(deb);
      else if (cred === 0 || deb === 0) amountCents = 0;
    }
    if (amountCents === undefined) {
      ilegiveis += 1;
      continue;
    }

    const description = colunas.descricao
      .map((c) => celulas[c] ?? '')
      .filter(Boolean)
      .join(' ')
      .trim();

    lancamentos.push({
      postedAt,
      amountCents,
      description: description || '(sem descrição)',
    });
  }

  if (ilegiveis > 0) {
    avisos.push(`${ilegiveis} linha(s) não puderam ser lidas como lançamento e ficaram de fora.`);
  }
  if (lancamentos.length === 0) avisos.push('Nenhum lançamento legível no arquivo.');

  const datas = lancamentos.map((l) => l.postedAt.getTime());
  return {
    formato: 'CSV',
    conta: {},
    periodStart: datas.length ? new Date(Math.min(...datas)) : undefined,
    periodEnd: datas.length ? new Date(Math.max(...datas)) : undefined,
    lancamentos,
    avisos,
  };
}
