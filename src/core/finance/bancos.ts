/**
 * Codigo COMPE (Bacen) → nome do banco, como as pessoas chamam.
 *
 * O OFX e o PDF identificam a conta por codigo e numero. "Conta banco 0260
 * 0001/667683447-8" e verdadeiro e inutil: ninguem sabe de cabeca que 0260
 * e o Nubank. O nome e o que torna a conta reconhecivel na tela.
 *
 * Lista curta de proposito — os bancos que aparecem em extrato de PF e PJ
 * no Brasil. Codigo desconhecido volta undefined, e a tela mostra o codigo.
 */
const BANCOS: Record<string, string> = {
  '001': 'Banco do Brasil',
  '033': 'Santander',
  '041': 'Banrisul',
  '070': 'BRB',
  '077': 'Inter',
  '104': 'Caixa',
  '208': 'BTG Pactual',
  '212': 'Banco Original',
  '237': 'Bradesco',
  '260': 'Nubank',
  '290': 'PagBank',
  '323': 'Mercado Pago',
  '336': 'C6 Bank',
  '341': 'Itaú',
  '380': 'PicPay',
  '389': 'Mercantil do Brasil',
  '403': 'Cora',
  '422': 'Safra',
  '450': 'Fitbank',
  '461': 'Asaas',
  '536': 'Neon',
  '623': 'Pan',
  '633': 'Rendimento',
  '637': 'Sofisa',
  '655': 'Banco Votorantim',
  '707': 'Daycoval',
  '745': 'Citibank',
  '748': 'Sicredi',
  '756': 'Sicoob',
};

/** Aceita "0260", "260", "260 " e devolve o nome, ou undefined. */
export function nomeDoBanco(codigo: string | null | undefined): string | undefined {
  if (!codigo) return undefined;
  const digitos = codigo.trim().replace(/\D/g, '');
  if (!digitos) return undefined;
  return BANCOS[digitos.padStart(3, '0').slice(-3)];
}

/** Nome para mostrar: instituicao gravada, senao o banco pelo codigo, senao o codigo. */
export function nomeDaInstituicao(conta: {
  institution?: string | null;
  bankId?: string | null;
}): string | undefined {
  return conta.institution?.trim() || nomeDoBanco(conta.bankId) || conta.bankId?.trim() || undefined;
}
