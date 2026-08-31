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
