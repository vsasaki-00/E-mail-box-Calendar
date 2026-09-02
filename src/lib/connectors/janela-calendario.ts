import { envNumero } from '@/lib/env';

/**
 * Janela do calendario — e a assinatura que diz quando ela mudou.
 *
 * O detalhe que custou caro: a janela nao e reenviada a cada sync. Ela e
 * gravada DENTRO do cursor pelo proprio provedor. No Google, `timeMin`/
 * `timeMax` sao recusados junto com `syncToken`; no Microsoft, o
 * `deltaLink` ja vem com `startDateTime`/`endDateTime` embutidos. Ou seja:
 * a janela usada no primeiro full sync vale para sempre.
 *
 * Isso tem duas consequencias, e as duas doiam:
 *
 * 1. Corrigir `SYNC_CALENDAR_*` nao adiantava nada. A conta que ja tinha
 *    cursor continuava buscando na janela velha — inclusive a janela vazia
 *    que `Number('')` produzia. A configuracao ficava certa na tela e
 *    errada no provedor.
 * 2. Mesmo com tudo certo, a janela envelhece. Ela e ancorada em "hoje";
 *    um cursor criado hoje cobre ate daqui a 12 meses e nunca mais avanca,
 *    entao o horizonte do calendario encolhe um dia por dia, em silencio.
 *
 * A assinatura resolve os dois: ela acompanha o cursor, e quando muda o
 * cursor e descartado — o proximo sync refaz a janela do zero. Muda quando
 * os meses configurados mudam, e quando vira o mes (reancoragem). Um full
 * sync mensal de calendario e barato: eventos sao poucos e o `upsert` e
 * idempotente.
 */

/** Janela padrao do full sync de calendario. */
export function janelaCalendario(agora = new Date()): { since: Date; until: Date } {
  const mesesPassado = envNumero(process.env.SYNC_CALENDAR_PAST_MONTHS, 1);
  const mesesFuturo = envNumero(process.env.SYNC_CALENDAR_FUTURE_MONTHS, 12);

  const since = new Date(agora);
  since.setMonth(since.getMonth() - mesesPassado);
  const until = new Date(agora);
  until.setMonth(until.getMonth() + mesesFuturo);

  return { since, until };
}

/**
 * Identidade da janela em vigor.
 *
 * Ancorada no MES, e nao no instante: dois syncs no mesmo mes precisam
 * concordar, senao todo sync viraria full sync e o incremental morreria.
 */
export function assinaturaJanela(agora = new Date()): string {
  const mesesPassado = envNumero(process.env.SYNC_CALENDAR_PAST_MONTHS, 1);
  const mesesFuturo = envNumero(process.env.SYNC_CALENDAR_FUTURE_MONTHS, 12);
  const ancora = `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}`;
  return `p${mesesPassado}f${mesesFuturo}@${ancora}`;
}
