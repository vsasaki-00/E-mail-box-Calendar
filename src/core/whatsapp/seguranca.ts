import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Quem pode falar com o webhook. Ver docs/11-whatsapp.md
 *
 * O canal não tem remetente verificável como o e-mail: qualquer um que
 * descubra a URL pode fazer um POST. São duas barreiras independentes, e as
 * duas precisam passar:
 *
 * 1. **Assinatura**: a Meta assina cada entrega com HMAC-SHA256 do corpo
 *    CRU usando o App Secret. Sem isso, a URL é a única proteção — e URL
 *    não é segredo.
 * 2. **Allowlist de número**: mesmo uma entrega legítima da Meta pode vir
 *    de qualquer pessoa que mande mensagem para o seu número comercial.
 *    Uma frase que vira lançamento financeiro só pode vir de você.
 */

/**
 * Confere `X-Hub-Signature-256: sha256=<hex>` contra o corpo cru.
 *
 * Sobre o corpo CRU: precisa ser exatamente o que veio na rede. Um
 * `JSON.parse` seguido de `JSON.stringify` reordena chaves e muda espaços,
 * e a assinatura deixa de bater — um jeito clássico de "funciona no teste,
 * recusa em produção".
 */
export function assinaturaConfere(corpoCru: string, cabecalho: string | null, appSecret: string): boolean {
  if (!cabecalho || !appSecret) return false;

  const prefixo = 'sha256=';
  if (!cabecalho.startsWith(prefixo)) return false;
  const recebida = cabecalho.slice(prefixo.length);
  if (!/^[0-9a-f]{64}$/i.test(recebida)) return false;

  const esperada = createHmac('sha256', appSecret).update(corpoCru, 'utf8').digest('hex');

  // Comprimentos são iguais por construção (64 hex), então o
  // timingSafeEqual não vaza nada pelo tamanho.
  return timingSafeEqual(Buffer.from(esperada, 'hex'), Buffer.from(recebida, 'hex'));
}

/**
 * Normaliza para E.164 sem o "+": só dígitos.
 *
 * A Meta manda `5511987654321`; uma pessoa escreve `+55 (11) 98765-4321`.
 * Sem normalizar, a allowlist só funcionaria se você digitasse igualzinho.
 */
export function normalizarNumero(bruto: string): string {
  return bruto.replace(/\D/g, '');
}

/**
 * O nono dígito brasileiro.
 *
 * Celular no Brasil ganhou um 9 na frente em 2013, e a Meta às vezes
 * entrega o número SEM ele (`5511987654321` × `551187654321`). Comparar
 * cru faria o dono cair na própria allowlist umas vezes sim, outras não —
 * um bug que só aparece em produção e parece aleatório.
 */
function variantes(numero: string): string[] {
  const n = normalizarNumero(numero);
  const lista = [n];
  // 55 + DDD(2) + 9 + 8 dígitos = 13
  if (n.length === 13 && n.startsWith('55') && n[4] === '9') {
    lista.push(`${n.slice(0, 4)}${n.slice(5)}`);
  }
  // 55 + DDD(2) + 8 dígitos = 12 → acrescenta o 9
  if (n.length === 12 && n.startsWith('55')) {
    lista.push(`${n.slice(0, 4)}9${n.slice(4)}`);
  }
  return lista;
}

/** Lê `WHATSAPP_ALLOWED_NUMBERS` (separada por vírgula) já normalizada. */
export function lerAllowlist(bruto: string | undefined): string[] {
  if (!bruto?.trim()) return [];
  return bruto
    .split(',')
    .map((n) => normalizarNumero(n))
    .filter((n) => n.length >= 10);
}

export function numeroAutorizado(numero: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  const candidatos = variantes(numero);
  return allowlist.some((permitido) => variantes(permitido).some((v) => candidatos.includes(v)));
}
