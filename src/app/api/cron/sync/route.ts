import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { contarSyncStatesVencidos, runSyncCycle } from '@/core/sync/engine';
import { runAutomationCycle } from '@/core/pipeline/run';
import { sair, tentarEntrar } from '@/core/sync/em-andamento';

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

  // UM relógio, e a rota ESPERA o trabalho acabar.
  //
  // Havia aqui um segundo relógio: um `Promise.race` que respondia aos 45s e
  // deixava o ciclo rodando. Parecia generoso — "melhor uma resposta honesta
  // de ainda falta que um 504 que não diz nada" — e era a origem do erro que
  // mais custou caro:
  //
  //     Timed out fetching a new connection from the connection pool
  //
  // Não dá para cancelar uma promise. O trabalho abandonado continuava com
  // consulta em voo quando a resposta saía, e a plataforma podia CONGELAR a
  // instância nesse ponto. A conexão daquela consulta nunca voltava para o
  // pool. Uma por requisição estourada; cinco depois, aquela instância estava
  // morta para sempre — e o erro aparecia na consulta mais banal do próximo
  // sync, longe de quem causou.
  //
  // O orçamento impede PEGAR recurso novo, e a rota espera o recurso em
  // andamento terminar. O teto é o orçamento MAIS um recurso.
  //
  // Foram 15s enquanto a função rodava em Washington e cada consulta custava
  // 583 ms: um recurso sozinho já ameaçava os 60s. Com a função em São Paulo
  // (`regions: ["gru1"]`) a viagem caiu para ~30 ms, e a página de gravação
  // inteira — oito consultas — custa 0,24s. Um recurso agora é ~10s, quase
  // tudo esperando o provedor. 25 + 10 cabe com folga, e cada volta cobre
  // mais contas: era isso que fazia o ciclo alcançar 5 de 6 em vez de 6.
  const ORCAMENTO_SYNC_MS = 25_000;

  // Onde a GRAVACAO para, mesmo no meio de uma pagina. Deixa ~15s de folga
  // sobre os 60s da plataforma para a reconciliacao e a resposta.
  const PRAZO_DE_GRAVACAO_MS = 45_000;

  // Sync e automação são relatados separados: se a automação falhar por falta
  // de ANTHROPIC_API_KEY, o sync ainda rodou, e a resposta precisa dizer isso
  // em vez de virar um 500 que esconde as duas coisas.
  let sync:
    | { recursos: number; falhas: number; parciais: number; pendentes: number }
    | { erro: string };

  // Um ciclo por instancia: duas requisicoes atendidas pela MESMA instancia
  // quente dividiriam as 5 conexoes do pool do Prisma, que e por instancia.
  // A trava expira sozinha — ver core/sync/em-andamento.ts.
  if (!tentarEntrar()) {
    // `sync` continua sendo um OBJETO: quem chama faz `jq '.sync.erro'`, e
    // uma string ali quebraria o laco do agendamento com erro de jq — um
    // conserto virando falha nova.
    return NextResponse.json({
      ok: true,
      ocupado: true,
      sync: { ocupado: true, pendentes: await contarSyncStatesVencidos() },
      automacao: 'pulada',
    });
  }

  try {
    const resultados = await runSyncCycle(new Date(), {
      orcamentoMs: ORCAMENTO_SYNC_MS,
      // O freio de dentro: nem o recurso que ja comecou pode passar disto.
      prazoDeGravacaoEm: inicio + PRAZO_DE_GRAVACAO_MS,
    }).finally(sair);

    // O número que interessa a quem agenda de fora: enquanto for maior que
    // zero, há o que fazer e vale chamar de novo. Uma caixa nova leva dezenas
    // de voltas até zerar.
    sync = {
      recursos: resultados.length,
      falhas: resultados.filter((r) => r.outcome === 'FAILED').length,
      parciais: resultados.filter((r) => r.outcome === 'PARTIAL').length,
      pendentes: await contarSyncStatesVencidos(),
    };
  } catch (error) {
    // `sair` já veio pelo `finally` acima — ele roda na falha também.
    sync = { erro: error instanceof Error ? error.message : 'falha desconhecida' };
  }

  // `?automacao=0` roda só o sync — útil para um cron de alta frequência que
  // não deve gastar chamadas de modelo a cada disparo. E se o sync falhou, a
  // automação fica de fora: ela lê o que o sync gravou, e rodá-la sobre um
  // ciclo quebrado gasta chamada de modelo sem base.
  const rodarAutomacao =
    request.nextUrl.searchParams.get('automacao') !== '0' && !('erro' in sync);

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
