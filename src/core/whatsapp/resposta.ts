import { formatarValor } from '@/core/finance/format';

/**
 * O que o Meridiano responde no WhatsApp. Ver docs/11-whatsapp.md
 *
 * Uma resposta automática só se justifica se disser algo que a pessoa não
 * sabia. "Recebido ✓" não é isso — é ruído com cara de educação. Então a
 * resposta carrega três coisas, nessa ordem de importância:
 *
 *  1. **O que eu entendi.** Fecha o laço na hora: se o parser leu 1,20 em
 *     vez de 1.200, você descobre agora, e não semanas depois no painel.
 *  2. **Parece repetido?** É o único momento em que dá para avisar ANTES do
 *     dinheiro sair de novo. Pagar duas vezes é o erro caro que este app
 *     tem como evitar, e ninguém mais tem os dados para ver.
 *  3. **O que vence logo.** A informação que só este app tem, chegando
 *     justamente quando você está decidindo gastar.
 *
 * Curta de propósito: é WhatsApp no meio do dia, não relatório.
 */

export interface ParecidoAnterior {
  quando: Date;
  descricao: string;
}

export interface ContextoResposta {
  /** Nulo quando o parser não achou valor — o caso mais importante de avisar. */
  amountCents?: number;
  direcao?: 'ENTRADA' | 'SAIDA';
  descricao?: string;
  data?: Date;
  /** Baixa confiança muda o tom: proposta vira palpite declarado. */
  confianca: number;
  /** Lançamento existente com o mesmo valor, por perto. */
  parecido?: ParecidoAnterior;
  /** Cobranças a vencer nos próximos dias, do painel financeiro. */
  aVencer?: { quantas: number; totalCents: number; dias: number };
  /** Outras propostas ainda esperando confirmação. */
  outrasPendentes: number;
  /** Por que não deu para ler, quando não deu. */
  motivoFalha?: string;
}

/** `15/08` — dia e mês bastam numa conversa sobre esta semana. */
function diaMes(data: Date, timeZone: string): string {
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', timeZone });
}

/**
 * A mensagem de volta.
 *
 * Devolve `undefined` quando não há nada honesto a dizer — silêncio é
 * melhor que uma linha vazia de conteúdo.
 */
export function montarResposta(ctx: ContextoResposta, timeZone = 'America/Sao_Paulo'): string | undefined {
  const linhas: string[] = [];

  if (ctx.amountCents === undefined || ctx.amountCents <= 0) {
    // O caso que MAIS precisa de resposta: sem ela, você acha que deu certo
    // e a despesa some. Vem com exemplo, porque "formato inválido" sem
    // exemplo é só uma reclamação.
    linhas.push('Não consegui ler um valor.');
    // O motivo só entra quando acrescenta algo. "Não achei um valor" depois
    // de "não consegui ler um valor" é a mesma frase duas vezes.
    if (ctx.motivoFalha) linhas.push(ctx.motivoFalha);
    linhas.push('');
    linhas.push('Tente assim: *paguei o fornecedor XYZ, 1.200*');
    return linhas.join('\n');
  }

  const sinal = ctx.direcao === 'ENTRADA' ? 'entrada' : 'saída';
  const partes = [formatarValor(ctx.amountCents)];
  if (ctx.descricao) partes.push(ctx.descricao);
  if (ctx.data) partes.push(diaMes(ctx.data, timeZone));

  linhas.push(`Entendi: ${sinal} de ${partes.join(' · ')}`);

  // Confiança baixa não pode ser escondida: a proposta é palpite, e dizer
  // isso é o que permite você olhar com atenção em vez de confirmar no
  // automático.
  if (ctx.confianca < 0.6) {
    linhas.push('_Leitura incerta — confira os campos._');
  }

  if (ctx.parecido) {
    linhas.push('');
    linhas.push(
      `⚠️ Parecido com *${ctx.parecido.descricao}* de ${diaMes(ctx.parecido.quando, timeZone)}, mesmo valor. Veja se não é o mesmo pagamento.`,
    );
  }

  if (ctx.aVencer && ctx.aVencer.quantas > 0) {
    linhas.push('');
    const c = ctx.aVencer.quantas;
    linhas.push(
      `A vencer em ${ctx.aVencer.dias} dias: ${formatarValor(ctx.aVencer.totalCents)} em ${c} ${c === 1 ? 'cobrança' : 'cobranças'}.`,
    );
  }

  linhas.push('');
  const p = ctx.outrasPendentes;
  linhas.push(
    p > 0
      ? `Confirme no painel — ${p === 1 ? 'há mais 1 esperando' : `há mais ${p} esperando`}. Nada foi lançado ainda.`
      : 'Confirme no painel. Nada foi lançado ainda.',
  );

  return linhas.join('\n');
}
