/**
 * Decide se os escopos concedidos permitem escrever.
 * Ver docs/08-escrita-e-acoes.md
 *
 * Funcao pura, testavel — e ela e a fronteira entre "o usuario autorizou" e
 * "o app acha que autorizou". Confiar no que PEDIMOS em vez do que veio e
 * o erro classico: o Google e o Microsoft deixam o usuario desmarcar
 * permissoes na tela de consentimento, e o fluxo continua com sucesso.
 */

/** Escopos que, presentes, indicam que a escrita foi concedida. */
const GOOGLE_WRITE_MARKERS = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
];

const MICROSOFT_WRITE_MARKERS = ['mail.readwrite', 'mail.send', 'calendars.readwrite'];

export interface WriteGrant {
  /** Da para executar QUALQUER acao de escrita? */
  enabled: boolean;
  /** O que veio, normalizado. */
  granted: string[];
  /** O que foi pedido e nao veio. Vira aviso na tela. */
  missing: string[];
}

/**
 * O Microsoft devolve escopos com URI completa e caixa variavel
 * (`https://graph.microsoft.com/Mail.ReadWrite`). Normalizar antes de
 * comparar evita um "nao autorizado" que na verdade e diferenca de caixa.
 */
function normalizar(escopo: string): string {
  const semUri = escopo.includes('/') ? (escopo.split('/').pop() ?? escopo) : escopo;
  return semUri.toLowerCase();
}

export function evaluateWriteGrant(
  provider: 'GOOGLE' | 'MICROSOFT',
  grantedScopes: string[] | undefined,
): WriteGrant {
  const granted = grantedScopes ?? [];

  // Sem informacao de escopo, a resposta e NAO. Um provedor que nao
  // informou o que concedeu nao autorizou nada — presumir o contrario
  // inverteria o onus na direcao errada.
  if (granted.length === 0) return { enabled: false, granted: [], missing: [] };

  const normalizados = new Set(granted.map(normalizar));
  const marcadores = provider === 'GOOGLE' ? GOOGLE_WRITE_MARKERS : MICROSOFT_WRITE_MARKERS;

  const missing = marcadores.filter((m) => !normalizados.has(normalizar(m)));

  return {
    // TODOS os marcadores precisam estar presentes: faltando um, alguma
    // acao do catalogo falharia na hora de executar, e falhar depois de
    // voce confirmar e pior do que recusar antes.
    enabled: missing.length === 0,
    granted,
    missing,
  };
}
