/**
 * O estado de uma conta, em UM lugar só.
 *
 * Existia uma cópia deste vocabulário na Torre e outra em Conexões, e elas
 * discordavam: a Torre conhecia "atrasada" e Conexões não. A mesma conta
 * aparecia "atrasada" numa tela e "ativa" na outra — duas verdades sobre o
 * mesmo fato, que é o jeito mais rápido de fazer o usuário parar de
 * acreditar nas duas. Qualquer tela que mostre o estado de uma conexão
 * chama daqui.
 */

/**
 * Quanto tempo sem sync é normal.
 *
 * Este número é da IMPLANTAÇÃO, não do conector. O conector declara
 * `pollIntervalSeconds: 300` — "dá para me ler a cada 5 minutos" —, mas
 * quem chama é o agendamento do GitHub Actions, 3× por dia (10h, 16h e 22h
 * UTC). O maior intervalo normal é o da noite: **12 horas**.
 *
 * Usar os 5 minutos do conector como régua deixava TODA conexão marcada
 * "atrasada" o tempo inteiro, menos nos 15 minutos seguintes a um sync — e
 * gerava seis alertas permanentes na Torre. Um alarme que nunca desliga
 * ensina a ignorar todos os alarmes.
 *
 * Se você mudar a cadência do agendamento, ajuste
 * `SYNC_EXPECTED_INTERVAL_MINUTES`.
 */
const DEFAULT_INTERVAL_MINUTES = 12 * 60;

/**
 * Folga sobre o intervalo esperado.
 *
 * Um ciclo leva minutos e pode atrasar; 25% de folga (15h sobre 12h) evita
 * gritar por causa disso, e ainda pega um ciclo PERDIDO — que produziria um
 * intervalo de 18h ou mais.
 */
const STALE_MULTIPLIER = 1.25;

export function intervaloEsperadoMinutos(): number {
  const bruto = Number(process.env.SYNC_EXPECTED_INTERVAL_MINUTES);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : DEFAULT_INTERVAL_MINUTES;
}

export function isSyncStale(
  lastSyncAt: Date | null,
  expectedIntervalMinutes = DEFAULT_INTERVAL_MINUTES,
  now = new Date(),
): boolean {
  // Conta que nunca sincronizou e um problema, nao um estado neutro.
  if (!lastSyncAt) return true;
  const elapsedMinutes = (now.getTime() - lastSyncAt.getTime()) / 60_000;
  return elapsedMinutes > expectedIntervalMinutes * STALE_MULTIPLIER;
}

export type ClasseEstado = 'ok' | 'warn' | 'crit';

export interface EstadoConexao {
  classe: ClasseEstado;
  texto: string;
  atrasada: boolean;
}

export interface RecursoSincronizado {
  resource: string;
  lastSyncAt: Date | null;
}

const NOME_DO_RECURSO: Record<string, string> = {
  MAIL: 'e-mail',
  CALENDAR: 'agenda',
  CONTACTS: 'contatos',
};

export function nomeDoRecurso(resource: string): string {
  return NOME_DO_RECURSO[resource] ?? resource.toLowerCase();
}

export interface Frescor {
  /** O instante em que a conta ficou inteira. `null` = há parte nunca lida. */
  desde: Date | null;
  /** Qual recurso está segurando a conta atrás. `null` = não dá para saber. */
  recurso: string | null;
  /** Minutos desde `desde`. `null` quando `desde` é nulo. */
  minutos: number | null;
}

/**
 * Há quanto tempo esta conta está atual — medido pelo recurso MAIS ATRASADO.
 *
 * `Connection.lastSyncAt` é gravado quando QUALQUER recurso termina bem, o
 * que a torna otimista por construção: com o e-mail rodando e a agenda
 * parada, o campo diz "sincronizei agora" e esconde exatamente a metade que
 * quebrou. Já houve esse bug aqui — o calendário nunca rodava porque o
 * e-mail sempre ganhava o desempate (ver `escolherProximoRecurso`) — e o
 * painel não mostrava nada de errado.
 *
 * Uma conta vale o seu pior recurso. Sem linhas de `SyncState` (conexão
 * antiga, ainda não reparada), cai para o campo da conexão: é o melhor
 * conhecido, e inventar um atraso seria pior.
 */
export function frescorDaConexao(
  conexao: { lastSyncAt: Date | null },
  recursos: RecursoSincronizado[],
  agora = new Date(),
): Frescor {
  const idade = (d: Date) => Math.max(0, Math.round((agora.getTime() - d.getTime()) / 60_000));

  if (recursos.length === 0) {
    return {
      desde: conexao.lastSyncAt,
      recurso: null,
      minutos: conexao.lastSyncAt ? idade(conexao.lastSyncAt) : null,
    };
  }

  const nunca = recursos.find((r) => r.lastSyncAt === null);
  if (nunca) return { desde: null, recurso: nunca.resource, minutos: null };

  const pior = recursos.reduce((a, b) =>
    (a.lastSyncAt as Date) <= (b.lastSyncAt as Date) ? a : b,
  );
  return {
    desde: pior.lastSyncAt,
    recurso: pior.resource,
    minutos: idade(pior.lastSyncAt as Date),
  };
}

/**
 * `680` → `há 11h`.
 *
 * A Torre imprimia minutos crus. Com o agendamento rodando 3× por dia isso
 * virava "sync há 680min" ao lado de "último sync 03/09 10:14" em Conexões:
 * o mesmo fato escrito de dois jeitos que ninguém consegue comparar de
 * cabeça.
 */
export function descreverIdade(minutos: number | null): string {
  if (minutos === null) return 'nunca sincronizou';
  if (minutos < 1) return 'agora mesmo';
  if (minutos < 60) return `há ${minutos}min`;

  const horas = Math.round(minutos / 60);
  if (horas < 36) return `há ${horas}h`;

  const dias = Math.round(horas / 24);
  return `há ${dias} dia${dias > 1 ? 's' : ''}`;
}

export function haQuantoTempo(desde: Date | null, agora = new Date()): string {
  if (!desde) return 'nunca sincronizou';
  return descreverIdade(Math.max(0, Math.round((agora.getTime() - desde.getTime()) / 60_000)));
}

/**
 * A etiqueta da conta.
 *
 * A ordem é a mesma do alerta em `core/alerts/rules.ts`, de propósito: o que
 * exige você é mais urgente do que o que se resolve sozinho, e uma conta
 * parada por reautenticação também está atrasada — dizer as duas coisas
 * seria dizer a mesma duas vezes.
 *
 * `DISABLED` nunca é "atrasada": ela não está devendo sync nenhum, está
 * desligada por escolha sua.
 */
export function estadoDaConexao(
  conexao: { status: string },
  frescor: Pick<Frescor, 'desde'>,
  agora = new Date(),
): EstadoConexao {
  if (conexao.status === 'REAUTH_REQUIRED')
    return { classe: 'crit', texto: 'reautenticar', atrasada: false };
  if (conexao.status === 'ERROR') return { classe: 'crit', texto: 'erro', atrasada: false };
  if (conexao.status === 'DISABLED')
    return { classe: 'warn', texto: 'desativada', atrasada: false };

  if (isSyncStale(frescor.desde, intervaloEsperadoMinutos(), agora))
    return { classe: 'warn', texto: 'atrasada', atrasada: true };

  if (conexao.status === 'ACTIVE') return { classe: 'ok', texto: 'ativa', atrasada: false };
  return { classe: 'warn', texto: 'degradada', atrasada: false };
}
