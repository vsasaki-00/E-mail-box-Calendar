/**
 * Um ciclo por instância, de cada vez — e a trava expira.
 *
 * As rotas de sync não abandonam mais trabalho no meio (ver a nota sobre
 * `Promise.race` em `docs/09-deploy.md`), então esta trava é rede de
 * segurança e não o mecanismo principal: ela impede que duas requisições
 * atendidas pela MESMA instância quente disputem as 5 conexões do pool do
 * Prisma, que é por instância.
 *
 * **A expiração não é detalhe.** Numa função serverless a instância pode ser
 * congelada a qualquer momento; se isso acontecer com a trava tomada, o
 * `finally` que a devolveria nunca roda e aquela instância passaria a recusar
 * todo sync para sempre — um conserto virando pane permanente. Uma trava mais
 * velha que o tempo máximo de uma função não é mais uma trava: é lixo de uma
 * execução que não existe mais.
 */

/**
 * Depois disto a trava é considerada abandonada.
 *
 * 90s: o teto da plataforma é 60s, então nenhuma execução viva pode ter
 * passado disso. A folga cobre relógio impreciso.
 */
export const VALIDADE_MS = 90_000;

let tomadaEm: number | null = null;

/** Devolve `false` quando já há um ciclo vivo nesta instância. */
export function tentarEntrar(agora = Date.now()): boolean {
  if (tomadaEm !== null && agora - tomadaEm < VALIDADE_MS) return false;
  tomadaEm = agora;
  return true;
}

/**
 * Libera a trava.
 *
 * Precisa ser chamado quando o TRABALHO termina, e não quando a resposta sai:
 * é o trabalho que segura conexão do pool.
 */
export function sair(): void {
  tomadaEm = null;
}

export function estaOcupado(agora = Date.now()): boolean {
  return tomadaEm !== null && agora - tomadaEm < VALIDADE_MS;
}
