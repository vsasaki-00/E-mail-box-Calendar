import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { contarSyncStatesVencidos, runSyncCycle } from '@/core/sync/engine';
import { runAutomationCycle } from '@/core/pipeline/run';

/**
 * Um ciclo de sincronização, disparado de fora. Ver docs/09-deploy.md
 *
 * Por que existe: o `pnpm worker` é um laço infinito, e na Vercel não há
 * processo que sobreviva entre requisições. O mesmo núcleo (`runSyncCycle`,
 * `runAutomationCycle`) roda aqui — o que muda é só quem chama o relógio.
 *
 * Autentica por segredo no header, não por cookie: quem chama é o cron da
 * Vercel, que não tem sessão. Por isso o middleware deixa `/api/cron` passar
 * — a porta é esta função, e ela recusa sem o segredo.
 */

// O ciclo fala com Gmail, Graph e Postgres; o padrão de 10s não basta.
// 60 é o TETO do plano Hobby — declarar mais que isso não é ignorado, é
// build recusado ("maxDuration must be between 1 and 60"). Verificado no
// deploy real deste projeto. No plano Pro pode subir para até 300.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Comparação em tempo constante, com o comprimento também escondido. */
function segredoConfere(recebido: string, esperado: string): boolean {
  const a = new TextEncoder().encode(recebido);
  const b = new TextEncoder().encode(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function autorizado(request: NextRequest, segredo: string): boolean {
  // A Vercel manda `Authorization: Bearer $CRON_SECRET` sozinha quando a
  // variável existe. O header próprio é para você disparar à mão (curl).
  const bearer = request.headers.get('authorization');
  if (bearer?.startsWith('Bearer ') && segredoConfere(bearer.slice(7), segredo)) {
    return true;
  }
  const proprio = request.headers.get('x-cron-secret');
  return proprio ? segredoConfere(proprio, segredo) : false;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const segredo = process.env.CRON_SECRET;

  // Sem segredo configurado a rota fica fechada. Liberar "porque não está
  // configurado" deixaria qualquer um na internet disparando sincronização.
  if (!segredo) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 503 });
  }
  if (!autorizado(request, segredo)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const inicio = Date.now();

  // Dois relógios, e os dois precisam existir.
  //
  // O orçamento (25s) impede PEGAR recurso novo. Sozinho ele não basta: um
  // recurso iniciado aos 24s ainda tem o tempo dele pela frente, e foi
  // exatamente assim que o primeiro disparo automático estourou os 60s da
  // Vercel — duas vezes seguidas, cada uma devolvendo uma página de texto no
  // lugar do JSON.
  //
  // O prazo (45s) é a rede embaixo: quando o ciclo passa dele, a rota
  // responde assim mesmo, dizendo quanto sobrou. O trabalho em andamento não
  // se perde — cada página já foi gravada com seu cursor, e a próxima chamada
  // retoma dali. Melhor uma resposta honesta de "ainda falta" que um 504 que
  // não diz nada.
  const ORCAMENTO_SYNC_MS = 25_000;
  const PRAZO_RESPOSTA_MS = 45_000;

  // Sync e automação são relatados separados: se a automação falhar por falta
  // de ANTHROPIC_API_KEY, o sync ainda rodou, e a resposta precisa dizer isso
  // em vez de virar um 500 que esconde as duas coisas.
  let sync:
    | { recursos: number; falhas: number; parciais: number; pendentes: number }
    | { estourou: true; pendentes: number }
    | { erro: string };
  let estourouOPrazo = false;

  try {
    const ESTOUROU = Symbol('estourou');
    let alarme: ReturnType<typeof setTimeout> | undefined;
    const resultados = await Promise.race([
      runSyncCycle(new Date(), { orcamentoMs: ORCAMENTO_SYNC_MS }),
      new Promise<typeof ESTOUROU>((resolve) => {
        alarme = setTimeout(() => resolve(ESTOUROU), PRAZO_RESPOSTA_MS);
      }),
    ]).finally(() => clearTimeout(alarme));

    // O número que interessa a quem agenda de fora: enquanto for maior que
    // zero, há o que fazer e vale chamar de novo. Uma caixa nova leva dezenas
    // de voltas até zerar.
    const pendentes = await contarSyncStatesVencidos();

    if (resultados === ESTOUROU) {
      estourouOPrazo = true;
      sync = { estourou: true, pendentes };
    } else {
      sync = {
        recursos: resultados.length,
        falhas: resultados.filter((r) => r.outcome === 'FAILED').length,
        parciais: resultados.filter((r) => r.outcome === 'PARTIAL').length,
        pendentes,
      };
    }
  } catch (error) {
    sync = { erro: error instanceof Error ? error.message : 'falha desconhecida' };
  }

  // `?automacao=0` roda só o sync — útil para um cron de alta frequência que
  // não deve gastar chamadas de modelo a cada disparo. Se o sync já consumiu
  // o prazo, a automação também fica de fora: começar agora seria garantir o
  // 504 que o prazo existe para evitar.
  const rodarAutomacao =
    request.nextUrl.searchParams.get('automacao') !== '0' && !estourouOPrazo;

  let automacao: { triados: number; cobrancas: number } | { erro: string } | 'pulada' = 'pulada';
  if (rodarAutomacao) {
    try {
      const resultados = await runAutomationCycle();
      automacao = {
        triados: resultados.reduce(
          (s, r) => s + r.triage.reduce((t, p) => t + p.processed, 0),
          0,
        ),
        cobrancas: resultados.reduce(
          (s, r) => s + r.bills.reduce((t, p) => t + p.processed, 0),
          0,
        ),
      };
    } catch (error) {
      automacao = { erro: error instanceof Error ? error.message : 'falha desconhecida' };
    }
  }

  // Só contagens e mensagens de erro. Nada de assunto, remetente ou corpo:
  // o log da Vercel é mais um lugar onde o e-mail não deve aparecer.
  return NextResponse.json({ ok: true, ms: Date.now() - inicio, sync, automacao });
}
