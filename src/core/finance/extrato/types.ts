/**
 * Tipos do extrato bancario, independentes de formato e de banco.
 *
 * OFX e CSV chegam muito diferentes e saem daqui iguais: e o que permite
 * que a conciliacao, as regras e o painel nao saibam de onde a linha veio.
 * Ver docs/10-financeiro.md
 */

export type TipoConta = 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' | 'CASH' | 'INVESTMENT' | 'OTHER';

/** Uma linha do extrato, ja normalizada. */
export interface LancamentoBruto {
  /** Instante do lancamento. Dia inteiro quando o banco nao da hora. */
  postedAt: Date;
  /** ASSINADO, em centavos. Negativo e saida. */
  amountCents: number;
  /** Como o banco mandou. */
  description: string;
  /** Identidade dada pelo banco (FITID do OFX). Ausente no CSV. */
  fitId?: string;
  /** Tipo declarado pelo banco (TRNTYPE), quando houver. So informativo. */
  tipoBanco?: string;
}

/** Identificacao da conta, quando o arquivo traz. */
export interface ContaDoArquivo {
  bankId?: string;
  accountId?: string;
  kind?: TipoConta;
  currency?: string;
  /** Saldo informado, em centavos, e quando. */
  balanceCents?: number;
  balanceAt?: Date;
}

export interface ExtratoLido {
  formato: 'OFX' | 'CSV';
  conta: ContaDoArquivo;
  periodStart?: Date;
  periodEnd?: Date;
  lancamentos: LancamentoBruto[];
  /** O que nao deu para ler, em linguagem de gente. */
  avisos: string[];
}
