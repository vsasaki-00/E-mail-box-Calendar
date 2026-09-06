import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * A sonda de saúde — o que o vigia de fora pergunta.
 *
 * Existe porque a Torre de Controle media este app pela RAIZ, e a raiz responde
 * 200 mesmo com o banco fora: o Next entrega o HTML e o erro só aparece quando
 * alguém tenta usar. "No ar" e "funcionando" viravam a mesma coisa, e a
 * diferença entre as duas é justamente o que um NOC existe para ver.
 *
 * ── Três decisões ───────────────────────────────────────────────────────────
 *
 * · ELA TOCA O BANCO. Um `select 1` é o mínimo que prova a cadeia inteira —
 *   variável de ambiente, rede, credencial, pool. Sonda que não sai do processo
 *   responde "estou vivo" enquanto o app está inútil.
 *
 * · ELA NÃO É `/api/cron`. Aquela rota dispara trabalho e custa dinheiro; esta
 *   é lida a cada poucos minutos por um agente externo e precisa ser barata.
 *   Separar as duas evita que o vigia vire carga.
 *
 * · ELA É PÚBLICA E NÃO DIZ NADA. Sem sessão, porque quem pergunta é uma
 *   máquina de fora; e sem detalhe de erro, porque a resposta é visível na
 *   internet — mensagem de falha do Postgres entrega versão, host e nome de
 *   tabela. Quem precisa do detalhe olha o log.
 *
 * Devolve 200 quando o banco responde e 503 quando não. O status é a resposta:
 * o corpo é para gente, o código é para o robô.
 *
 * ── Quatro medidas, porque três hipóteses ───────────────────────────────────
 *
 * `latenciaBancoMs` é o PRIMEIRO `select 1` e paga o aperto de mão inteiro
 * (TCP, TLS, autenticação, pegar conexão no pooler). `latenciaConsultaMs` é o
 * segundo, com a conexão já aberta.
 *
 * As duas juntas mostraram 1455 ms e 583 ms — e eu li isso como "o banco está
 * longe". Estava errado: o log do backup diário prova que o projeto já roda em
 * `aws-0-sa-east-1`, a mesma São Paulo do `gru1` da Vercel. Distância não
 * explica 583 ms entre vizinhos.
 *
 * Faltavam duas medidas para separar o que sobrou:
 *
 * `latenciaDezMs` são DEZ `select 1` em sequência. Dividido por dez, é o custo
 * de uma ida e volta. Se bater com `latenciaConsultaMs`, o gargalo é POR
 * VIAGEM — rede ou pooler no caminho.
 *
 * `latenciaTrabalhoMs` é UMA consulta que faz trabalho de verdade no servidor
 * (varrer 200 mil linhas geradas) e volta um número só. Uma viagem, muito
 * processamento. Se ela for desproporcionalmente lenta, o gargalo é a MÁQUINA
 * — instância pequena, crédito de CPU esgotado, IO estourado.
 *
 *     por viagem alto, trabalho rápido  → caminho da conexão (pooler, rede)
 *     trabalho também lento             → a instância do banco está sufocada
 *
 * ── E o `commit` ────────────────────────────────────────────────────────────
 *
 * Só os 7 primeiros caracteres do SHA que a Vercel injeta no build. Não é
 * enfeite: mais de uma vez perdemos uma rodada inteira depurando um sintoma
 * que o commit seguinte já tinha consertado — sem jeito de responder, de fora,
 * "a correção está no ar?". Um SHA público não conta nada que o repositório
 * (público) já não conte.
 */

// Sonda com resposta em cache é sonda que mente: ela repetiria "ok" por
// minutos depois de o banco cair.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 30s, e não os 10 de antes: a sonda passou a fazer treze idas e voltas de
// propósito, e num banco de 583 ms por viagem isso não cabe em 10. Cortar a
// medição justamente onde ela dói esconderia a resposta.
export const maxDuration = 30;

/** Curto de propósito: identifica a versão sem virar um dump do ambiente. */
function commitNoAr(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  // Cortar o texto de fallback daria "desconh", que parece um SHA e não é.
  return sha ? sha.slice(0, 7) : 'local';
}

export async function GET() {
  const comecou = Date.now();
  const commit = commitNoAr();

  try {
    await prisma.$queryRaw`select 1`;
    const primeira = Date.now() - comecou;

    // Segunda consulta: a conexão já está aberta, sobra a ida e volta.
    const antesDaSegunda = Date.now();
    await prisma.$queryRaw`select 1`;
    const segunda = Date.now() - antesDaSegunda;

    // Dez viagens. Dividido por dez dá o custo de uma, com menos ruído que
    // uma medida só.
    const antesDasDez = Date.now();
    for (let i = 0; i < 10; i += 1) await prisma.$queryRaw`select 1`;
    const dez = Date.now() - antesDasDez;

    // Uma viagem só, com trabalho de verdade do outro lado. Separa "a rede
    // custa caro" de "a máquina está sufocada".
    const antesDoTrabalho = Date.now();
    await prisma.$queryRaw`select count(*) from generate_series(1, 200000)`;
    const trabalho = Date.now() - antesDoTrabalho;

    return NextResponse.json(
      {
        ok: true,
        banco: 'ok',
        commit,
        em: new Date().toISOString(),
        latenciaBancoMs: primeira,
        latenciaConsultaMs: segunda,
        latenciaDezMs: dez,
        porViagemMs: Math.round(dez / 10),
        latenciaTrabalhoMs: trabalho,
      },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (erro) {
    // O detalhe vai para o log, que é privado; a resposta diz só o que caiu.
    console.error('[saude] banco inacessível:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json(
      {
        ok: false,
        banco: 'fora',
        commit,
        em: new Date().toISOString(),
        latenciaBancoMs: Date.now() - comecou,
      },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    );
  }
}
