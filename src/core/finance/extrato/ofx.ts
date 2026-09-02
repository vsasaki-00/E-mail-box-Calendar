import type { ContaDoArquivo, ExtratoLido, LancamentoBruto, TipoConta } from './types';

/**
 * Leitor de OFX.
 *
 * Todo banco brasileiro exporta OFX, e quase nenhum exporta OFX igual ao
 * outro. As diferencas que este leitor absorve:
 *
 * - **SGML (1.x) x XML (2.x)**. No 1.x nao ha tag de fechamento de campo:
 *   `<MEMO>texto` termina no proximo `<`. No 2.x ha `</MEMO>`. O
 *   tokenizador trata os dois do mesmo jeito: `<TAG>` seguido de texto e um
 *   campo; `</TAG>` fecha um agregado.
 * - **Decimal com virgula**. O padrao e ponto, e ha banco que manda
 *   `-1234,56` mesmo assim.
 * - **Data com ou sem hora e fuso**: `20260815`, `20260815120000`,
 *   `20260815120000[-3:BRT]`. Sem fuso, assume-se Brasilia — e um extrato
 *   de banco brasileiro.
 * - **Cartao de credito** usa `<CCACCTFROM>` no lugar de `<BANKACCTFROM>`,
 *   e nao tem `<BANKID>`.
 *
 * O que ele NAO faz: validar assinatura, seguir `<SIGNONMSGSRSV1>`, tratar
 * investimentos (`<INVSTMTRS>`). Extrato de investimento entra como
 * "sem lancamentos, com aviso" em vez de explodir.
 */

const FUSO_PADRAO_MINUTOS = -3 * 60;

interface Token {
  tag: string;
  fechamento: boolean;
  valor: string;
}

/** Quebra o corpo em tokens `<TAG>valor` e `</TAG>`. */
function tokenizar(corpo: string): Token[] {
  const tokens: Token[] = [];
  // Cada pedaco comeca em `<`. O primeiro pedaco (antes do primeiro `<`) e
  // cabecalho SGML ou vazio, e cai fora.
  const pedacos = corpo.split('<').slice(1);
  for (const pedaco of pedacos) {
    const fim = pedaco.indexOf('>');
    if (fim < 0) continue;
    const nome = pedaco.slice(0, fim).trim();
    const valor = pedaco.slice(fim + 1);
    if (nome.startsWith('?') || nome.startsWith('!')) continue;
    const fechamento = nome.startsWith('/');
    tokens.push({
      tag: (fechamento ? nome.slice(1) : nome).toUpperCase(),
      fechamento,
      valor: desescapar(valor.trim()),
    });
  }
  return tokens;
}

function desescapar(texto: string): string {
  return texto
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** `20260815120000[-3:BRT]` → Date. Sem hora, meio-dia local: cai no dia certo em qualquer fuso razoavel. */
export function lerDataOfx(bruta: string): Date | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?(?:\.\d+)?(?:\[([+-]?\d{1,2})(?::\w+)?\])?/.exec(
    bruta.trim(),
  );
  if (!m) return undefined;

  const [, ano, mes, dia, hh, mm, ss, fuso] = m;
  const temHora = hh !== undefined;
  const offsetMin = fuso !== undefined ? Number(fuso) * 60 : FUSO_PADRAO_MINUTOS;

  const hora = temHora ? Number(hh) : 12;
  const minuto = temHora ? Number(mm) : 0;
  const segundo = temHora ? Number(ss) : 0;

  const utc = Date.UTC(Number(ano), Number(mes) - 1, Number(dia), hora, minuto, segundo);
  const data = new Date(utc - offsetMin * 60_000);
  return Number.isNaN(data.getTime()) ? undefined : data;
}

/** `-1234.56`, `-1234,56`, `1.234,56` → centavos assinados. */
export function lerValorOfx(bruto: string): number | undefined {
  let texto = bruto.trim().replace(/\s/g, '');
  if (!texto) return undefined;

  // Os dois separadores presentes: o ULTIMO e o decimal.
  const ultimaVirgula = texto.lastIndexOf(',');
  const ultimoPonto = texto.lastIndexOf('.');
  if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
    texto =
      ultimaVirgula > ultimoPonto
        ? texto.replace(/\./g, '').replace(',', '.')
        : texto.replace(/,/g, '');
  } else if (ultimaVirgula >= 0) {
    texto = texto.replace(',', '.');
  }

  const numero = Number(texto);
  if (!Number.isFinite(numero)) return undefined;
  return Math.round(numero * 100);
}

function tipoContaDe(acctType: string | undefined, ehCartao: boolean): TipoConta {
  if (ehCartao) return 'CREDIT_CARD';
  switch ((acctType ?? '').toUpperCase()) {
    case 'CHECKING':
      return 'CHECKING';
    case 'SAVINGS':
      return 'SAVINGS';
    case 'MONEYMRKT':
    case 'CREDITLINE':
      return 'OTHER';
    default:
      return 'CHECKING';
  }
}

export function lerOfx(conteudo: string): ExtratoLido {
  const tokens = tokenizar(conteudo);
  const avisos: string[] = [];
  const lancamentos: LancamentoBruto[] = [];
  const conta: ContaDoArquivo = {};

  let periodStart: Date | undefined;
  let periodEnd: Date | undefined;

  // Contexto: em qual agregado estamos. So os que importam.
  let dentroDeTransacao = false;
  let dentroDeCartao = false;
  let dentroDeBanco = false;
  let dentroDeSaldo = false;
  let viuInvestimento = false;

  let atual: Partial<LancamentoBruto> & { memo?: string; name?: string } = {};
  let acctType: string | undefined;

  const fecharTransacao = () => {
    if (!atual.postedAt || atual.amountCents === undefined) {
      avisos.push('Um lançamento sem data ou valor foi ignorado.');
    } else {
      // Bancos mandam NAME ou MEMO; alguns os dois, com MEMO mais completo.
      const descricao = [atual.name, atual.memo]
        .filter((p): p is string => Boolean(p))
        .filter((p, i, arr) => arr.indexOf(p) === i)
        .join(' ')
        .trim();
      lancamentos.push({
        postedAt: atual.postedAt,
        amountCents: atual.amountCents,
        description: descricao || '(sem descrição)',
        fitId: atual.fitId,
        tipoBanco: atual.tipoBanco,
      });
    }
    atual = {};
  };

  for (const token of tokens) {
    const { tag, fechamento, valor } = token;

    if (fechamento) {
      if (tag === 'STMTTRN' && dentroDeTransacao) {
        dentroDeTransacao = false;
        fecharTransacao();
      } else if (tag === 'CCACCTFROM') dentroDeCartao = false;
      else if (tag === 'BANKACCTFROM') dentroDeBanco = false;
      else if (tag === 'LEDGERBAL') dentroDeSaldo = false;
      continue;
    }

    switch (tag) {
      case 'STMTTRN':
        // SGML sem fechamento: uma STMTTRN nova fecha a anterior.
        if (dentroDeTransacao) fecharTransacao();
        dentroDeTransacao = true;
        continue;
      case 'CCACCTFROM':
        dentroDeCartao = true;
        conta.kind = 'CREDIT_CARD';
        continue;
      case 'BANKACCTFROM':
        dentroDeBanco = true;
        continue;
      case 'LEDGERBAL':
        dentroDeSaldo = true;
        continue;
      case 'INVSTMTRS':
        viuInvestimento = true;
        continue;
      case 'CURDEF':
        if (valor) conta.currency = valor.toUpperCase();
        continue;
      case 'DTSTART':
        periodStart = lerDataOfx(valor);
        continue;
      case 'DTEND':
        periodEnd = lerDataOfx(valor);
        continue;
    }

    if (dentroDeTransacao) {
      switch (tag) {
        case 'TRNTYPE':
          atual.tipoBanco = valor;
          break;
        case 'DTPOSTED':
          atual.postedAt = lerDataOfx(valor);
          break;
        case 'TRNAMT':
          atual.amountCents = lerValorOfx(valor);
          break;
        case 'FITID':
          atual.fitId = valor || undefined;
          break;
        case 'NAME':
          atual.name = valor;
          break;
        case 'MEMO':
          atual.memo = valor;
          break;
      }
      continue;
    }

    if (dentroDeBanco || dentroDeCartao) {
      switch (tag) {
        case 'BANKID':
          conta.bankId = valor;
          break;
        case 'ACCTID':
          conta.accountId = valor;
          break;
        case 'ACCTTYPE':
          acctType = valor;
          break;
      }
      continue;
    }

    if (dentroDeSaldo) {
      if (tag === 'BALAMT') conta.balanceCents = lerValorOfx(valor);
      else if (tag === 'DTASOF') conta.balanceAt = lerDataOfx(valor);
    }
  }

  // SGML pode terminar sem fechar a ultima transacao.
  if (dentroDeTransacao) fecharTransacao();

  conta.kind = tipoContaDe(acctType, conta.kind === 'CREDIT_CARD');

  if (viuInvestimento && lancamentos.length === 0) {
    avisos.push(
      'Este OFX é de investimento (INVSTMTRS), que ainda não é lido. Nenhum lançamento entrou.',
    );
  }
  if (lancamentos.length === 0 && !viuInvestimento) {
    avisos.push('Nenhum lançamento (<STMTTRN>) encontrado no arquivo.');
  }
  if (lancamentos.some((l) => !l.fitId)) {
    avisos.push(
      'Alguns lançamentos vieram sem FITID; a deduplicação deles usa data+valor+descrição.',
    );
  }

  return { formato: 'OFX', conta, periodStart, periodEnd, lancamentos, avisos };
}

/** Parece OFX? Basta o cabecalho ou a tag raiz. */
export function pareceOfx(inicio: string): boolean {
  const cabeca = inicio.slice(0, 2048).toUpperCase();
  return cabeca.includes('OFXHEADER') || cabeca.includes('<OFX>') || cabeca.includes('<OFX ');
}
