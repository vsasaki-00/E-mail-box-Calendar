/**
 * Um ciclo por instância, de cada vez.
 *
 * As duas rotas de sync respondem por `Promise.race` com um prazo: quando o
 * prazo vence, a resposta sai e **o trabalho continua rodando** — não há como
 * cancelar uma promise. Isso é deliberado (o que já foi gravado não se
 * perde), mas tem um custo que ficou invisível até aparecer em produção: quem
 * chama volta imediatamente para a próxima volta, a mesma instância quente
 * atende, e agora há dois ciclos gravando ao mesmo tempo. Depois três.
 *
 * O pool do Prisma é POR INSTÂNCIA e tem 5 conexões. Ciclos empilhados
 * esgotam as cinco, e a próxima consulta espera 20 s por uma conexão e morre:
 *
 *     Invalid `prisma.calendarSource.upsert()` invocation:
 *     Timed out fetching a new connection from the connection pool
 *
 * O erro aparece em quem chegou por último — uma consulta banal, no começo do
 * trabalho — e não em quem causou. Por isso ele engana.
 *
 * A trava é de processo, e é exatamente o alcance certo: o pool também é de
 * processo. Duas instâncias diferentes não disputam as mesmas 5 conexões.
 */

let ocupado = false;

/** Devolve `false` quando já há um ciclo rodando nesta instância. */
export function tentarEntrar(): boolean {
  if (ocupado) return false;
  ocupado = true;
  return true;
}

/**
 * Libera a trava.
 *
 * Precisa ser chamado quando o TRABALHO termina, e não quando a resposta sai:
 * é o trabalho que segura conexão do pool. Ligar isto ao fim da resposta
 * traria de volta exatamente o empilhamento que a trava existe para impedir.
 */
export function sair(): void {
  ocupado = false;
}

export function estaOcupado(): boolean {
  return ocupado;
}
