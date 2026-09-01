/**
 * Leitura de variavel de ambiente que trata VAZIO como ausente.
 *
 * `process.env.X ?? padrao` so cai no padrao quando a variavel nao existe.
 * Uma variavel declarada e vazia — que e como ela chega ao copiar o
 * `.env.example`, ou ao criar o campo no painel sem preencher — passa como
 * string vazia e vira valor "valido".
 *
 * Custou uma triagem inteira em producao: TRIAGE_MODEL="" foi ate a API da
 * Anthropic, que respondeu `model: String should have at least 1 character`
 * em todas as mensagens. O padrao existia e nunca foi usado.
 */
export function envOu(valor: string | undefined, padrao: string): string {
  const limpo = valor?.trim();
  return limpo ? limpo : padrao;
}

/**
 * Numero vindo de variavel de ambiente, com padrao para vazio e invalido.
 *
 * `Number(process.env.X ?? 12)` tem DOIS buracos, e os dois ja custaram caro
 * aqui: `??` nao pega string vazia, e `Number('')` e **zero**, nao NaN. Uma
 * variavel declarada e vazia — como ela chega ao copiar o .env.example ou ao
 * criar o campo no painel sem preencher — vira zero em silencio.
 *
 * No caso da janela do calendario isso significa "de agora ate agora": os
 * calendarios sao descobertos, nenhum evento cabe no intervalo, e a agenda
 * fica vazia sem erro nenhum em lugar nenhum.
 */
export function envNumero(valor: string | undefined, padrao: number): number {
  const limpo = valor?.trim();
  if (!limpo) return padrao;
  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : padrao;
}
