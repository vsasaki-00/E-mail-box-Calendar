/**
 * Categorias do razao e o que da para classificar sem perguntar a ninguem.
 *
 * Lista fixa, em portugues, pensada para seis negocios e a vida pessoal
 * juntos. Fixa porque categoria entra em soma e comparacao mes a mes:
 * "Assinaturas" e "assinatura" e "Software" viram tres linhas num relatorio
 * que deveria ter uma. Ver docs/10-financeiro.md
 */
export const CATEGORIAS = [
  'Receita',
  'Impostos',
  'Folha e pró-labore',
  'Fornecedores',
  'Assinaturas e software',
  'Aluguel e ocupação',
  'Serviços profissionais',
  'Marketing',
  'Transporte',
  'Alimentação',
  'Saúde',
  'Educação',
  'Transferência entre contas',
  'Investimentos',
  'Tarifas e juros',
  'Empréstimos',
  'Outros',
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

export function isCategoria(valor: string): valor is Categoria {
  return (CATEGORIAS as readonly string[]).includes(valor);
}

/**
 * Heuristicas embutidas, sobre a descricao NORMALIZADA. Sao o piso: valem
 * so quando nenhuma regra sua se aplica, e nunca sobrescrevem o que voce
 * definiu. Deliberadamente conservadoras — errar aqui e errar em silencio
 * numa soma.
 */
const HEURISTICAS: [RegExp, Categoria][] = [
  [/\b(rendimento|resgate|aplicacao|cdb|tesouro|poupanca)\b/, 'Investimentos'],
  [/\b(tarifa|iof|juros|anuidade|encargos)\b/, 'Tarifas e juros'],
  [/\b(darf|das|inss|fgts|simples nacional|iss|icms|irpj|csll|pis|cofins|gps|receita federal)\b/, 'Impostos'],
  [/\b(salario|pro labore|prolabore|folha|ferias|13o|decimo terceiro|rescisao)\b/, 'Folha e pró-labore'],
  [/\b(netflix|spotify|google|apple|microsoft|adobe|openai|anthropic|github|vercel|aws|amazon web|notion|slack|zoom|canva|figma|dropbox|icloud|youtube)\b/, 'Assinaturas e software'],
  [/\b(uber|99app|99 app|taxi|posto|combustivel|estacionamento|pedagio|sem parar|conectcar)\b/, 'Transporte'],
  [/\b(ifood|rappi|restaurante|padaria|mercado|supermercado|lanchonete|cafe)\b/, 'Alimentação'],
  [/\b(farmacia|drogaria|hospital|clinica|laboratorio|odonto|unimed|amil|sulamerica|saude|medic[oa]|dentista|psicolog[oa])\b/, 'Saúde'],
  [/\b(aluguel|condominio|iptu|energia|enel|light|cpfl|sabesp|agua|gas|internet|vivo|claro|tim|oi)\b/, 'Aluguel e ocupação'],
  [/\b(contabilidade|contador|advocacia|advogado|juridico|cartorio|consultoria)\b/, 'Serviços profissionais'],
  [/\b(facebook|meta ads|google ads|instagram|linkedin|anuncio|midia)\b/, 'Marketing'],
  [/\b(emprestimo|financiamento|parcela do emprestimo|consorcio)\b/, 'Empréstimos'],
  [/\b(curso|escola|faculdade|udemy|alura|coursera|mensalidade escolar)\b/, 'Educação'],
];

export function categoriaHeuristica(normalizada: string, amountCents: number): Categoria | undefined {
  for (const [re, categoria] of HEURISTICAS) {
    if (re.test(normalizada)) return categoria;
  }
  // Entrada sem pista nenhuma: receita e o palpite mais util para o fluxo
  // de caixa, e o mais facil de corrigir quando errar.
  if (amountCents > 0 && /\b(recebid|credito em conta|deposito)/.test(normalizada)) return 'Receita';
  return undefined;
}

/** Palavras que aparecem em toda descricao e nao identificam ninguem. */
const GENERICAS = new Set([
  'transferencia', 'recebida', 'recebido', 'enviada', 'enviado', 'pelo', 'pela', 'pix', 'ted', 'doc',
  'agencia', 'conta', 'banco', 'bco', 'ltda', 'eireli', 'epp', 'mei', 'com', 'cia', 'para', 'com',
  'efetuado', 'efetuada', 'pagamento', 'pagto', 'compra', 'cartao', 'debito', 'credito', 'boleto',
  'fatura', 'parcela', 'ref', 'nao', 'inst', 'pagamentos', 'brasil',
]);

/**
 * A chave de uma regra: as duas ou tres palavras que identificam QUEM, a
 * partir da descricao normalizada. "porto seguro" e nao "efetuado porto
 * seguro seguro saude"; "unitedcom" e nao "recebida pelo pix unitedcom".
 *
 * Mostrada na tela antes de virar regra: e voce quem julga se faz sentido.
 */
export function chaveDeRegra(normalizada: string): string | undefined {
  const vistas = new Set<string>();
  const palavras = normalizada
    .split(' ')
    .filter((p) => p.length >= 3 && !/^\d+$/.test(p) && !GENERICAS.has(p))
    .filter((p) => (vistas.has(p) ? false : (vistas.add(p), true)));
  if (palavras.length === 0) return undefined;
  return palavras.slice(0, 3).join(' ');
}
