/**
 * Notas que esperam o extrato. Ver docs/10-financeiro.md
 *
 * O problema: você pagou algo no cartão. Aquilo **vai** aparecer na fatura,
 * então mandar pelo WhatsApp como lançamento criaria dois registros para um
 * pagamento só — a conciliação casa lançamento com cobrança de e-mail, não
 * lançamento com lançamento, e ninguém avisaria.
 *
 * Mas o extrato nunca vai saber **para que foi** nem **de qual negócio**.
 * Essa é a parte que só você tem, e ela é perecível: daqui a três semanas
 * "PIX 12/08 R$ 1.200" não diz nada.
 *
 * A nota guarda o significado agora e cola na linha certa quando a
 * importação acontecer. Não cria dinheiro; anota o que o banco confirmou.
 */

export interface NotaEsperando {
  id: string;
  /** Sempre positivo: o sinal vem da direção. */
  amountCents: number;
  direcao: 'ENTRADA' | 'SAIDA';
  quando: Date;
  descricao?: string;
  business?: string;
  category?: string;
}

export interface LinhaDoExtrato {
  id: string;
  /** Assinado, como veio do banco. */
  amountCents: number;
  postedAt: Date;
}

export interface Colagem {
  lancamentoId: string;
  notaId: string;
  business?: string;
  category?: string;
  descricao?: string;
}

/**
 * Quantos dias de folga entre a nota e a linha.
 *
 * Compra no cartão cai na fatura dias depois; PIX cai na hora. Sete dias
 * cobrem o caso lento sem transformar a janela num convite ao acaso.
 */
export const JANELA_DIAS = 7;

function mesmoValor(nota: NotaEsperando, linha: LinhaDoExtrato): boolean {
  const sinalCerto = nota.direcao === 'SAIDA' ? linha.amountCents < 0 : linha.amountCents > 0;
  return sinalCerto && Math.abs(linha.amountCents) === nota.amountCents;
}

function dentroDaJanela(nota: NotaEsperando, linha: LinhaDoExtrato, dias: number): boolean {
  const distancia = Math.abs(linha.postedAt.getTime() - nota.quando.getTime());
  return distancia <= dias * 864e5;
}

/**
 * Quais notas colam em quais linhas.
 *
 * **Só o casamento inequívoco cola**: uma nota que serve para uma linha só,
 * e uma linha que serve para uma nota só. Duas compras de R$ 89,90 na mesma
 * semana não deixam ninguém decidir qual é qual — e colar a errada poria o
 * negócio errado num lançamento, em silêncio. Empate fica esperando, que é
 * o estado em que a nota já estava: não se perde nada, e a tela mostra.
 */
export function casarNotas(
  notas: NotaEsperando[],
  linhas: LinhaDoExtrato[],
  dias = JANELA_DIAS,
): Colagem[] {
  const candidatas = new Map<string, string[]>();
  const inversa = new Map<string, string[]>();

  for (const nota of notas) {
    for (const linha of linhas) {
      if (!mesmoValor(nota, linha) || !dentroDaJanela(nota, linha, dias)) continue;
      candidatas.set(nota.id, [...(candidatas.get(nota.id) ?? []), linha.id]);
      inversa.set(linha.id, [...(inversa.get(linha.id) ?? []), nota.id]);
    }
  }

  const colagens: Colagem[] = [];
  for (const nota of notas) {
    const linhasDaNota = candidatas.get(nota.id) ?? [];
    if (linhasDaNota.length !== 1) continue;

    const linhaId = linhasDaNota[0]!;
    // A outra ponta também precisa ser única: se duas notas disputam a mesma
    // linha, escolher uma seria sorteio com cara de decisão.
    if ((inversa.get(linhaId) ?? []).length !== 1) continue;

    colagens.push({
      lancamentoId: linhaId,
      notaId: nota.id,
      business: nota.business,
      category: nota.category,
      descricao: nota.descricao,
    });
  }

  return colagens;
}

/** A anotação que fica no lançamento, para "de onde saiu isto?" meses depois. */
export function textoDaColagem(descricao: string | undefined, quando: Date): string {
  const dia = quando.toISOString().slice(0, 10).split('-').reverse().slice(0, 2).join('/');
  return descricao
    ? `Nota de ${dia} pelo WhatsApp: ${descricao}`
    : `Nota de ${dia} pelo WhatsApp`;
}
