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

// O padrão de 10s é generoso demais aqui. Se o banco não responde em 5, ele
// está fora para efeito prático — e a sonda precisa dizer isso rápido.
export const maxDuration = 10;

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
    return NextResponse.json(
      {
        ok: true,
        banco: 'ok',
        commit,
        em: new Date().toISOString(),
        latenciaBancoMs: Date.now() - comecou,
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
