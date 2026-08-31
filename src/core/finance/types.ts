/**
 * Tipos da extracao financeira (fase 5B).
 * Ver docs/07-agente-de-triagem.md.
 */

export type BillKind = 'BOLETO' | 'PIX' | 'FATURA' | 'ASSINATURA' | 'NOTA_FISCAL' | 'OUTRO';

export type BillSource = 'INSTRUMENT' | 'TEXT' | 'MODEL' | 'USER';

export type BillStatus = 'PENDING' | 'PAID' | 'IGNORED';

/**
 * O que a extracao ve.
 *
 * ATENCAO — mudanca deliberada de politica de privacidade em relacao a
 * triagem: aqui o CORPO entra. Nao ha como tirar vencimento e linha
 * digitavel de um assunto. Isso e exatamente a decisao "metadados na
 * triagem, corpo sob demanda": este e o sob demanda, e o escopo e estreito
 * — so mensagens que a 5A ja classificou como COBRANCA, nunca a caixa toda.
 */
export interface BillInput {
  /** Id do UnifiedItem. */
  id: string;
  fromEmail?: string | null;
  fromName?: string | null;
  subject?: string | null;
  body: string;
  receivedAt: Date;
  hasAttachments: boolean;
}

export interface BillExtraction {
  id: string;
  amountCents: number | null;
  currency: string;
  dueDate: Date | null;
  /** Quem esta cobrando. */
  payee: string | null;
  kind: BillKind;
  /** Linha digitavel do boleto, so digitos. */
  digitableLine: string | null;
  /** Payload completo do PIX copia e cola. */
  pixPayload: string | null;
  pixKey: string | null;
  /** 0..1 */
  confidence: number;
  /** De onde veio o dado principal (valor/vencimento). */
  source: BillSource;
  /**
   * Parece mesmo uma conta a pagar?
   *
   * Falso para recibo de pagamento ja feito, confirmacao de compra ou
   * cobranca que o proprio usuario emitiu. O painel SEPARA esses em vez de
   * esconder: um recibo classificado errado que some viraria uma conta que
   * voce acha que pagou.
   */
  isPayable: boolean;
  /** Uma frase explicando a extracao, para o usuario conferir. */
  reason: string;
  /**
   * Problemas que o usuario PRECISA ver: DV que nao fecha, valor ausente,
   * vencimento so estimado. Nunca motivo para descartar a cobranca.
   */
  warnings: string[];
}
