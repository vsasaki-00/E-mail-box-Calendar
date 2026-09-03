import { prisma } from '@/lib/db';
import { BUSINESS_CONTEXTS } from './businesses';
import { chaveDeNome, normalizarNome, precisaMigrar, validarNome, mensagemDoErro } from './negocios';

/**
 * Negócios no banco. Ver docs/07-agente-de-triagem.md
 *
 * A lista saiu do código, mas o código continua sendo a SEMENTE: na
 * primeira leitura os seis de sempre são criados, com `Outros` e `Pessoais`
 * marcados como do sistema. Ninguém abre a tela num vazio que ele mesmo
 * causou.
 */

/** Não são negócios: são as regras de escape, e não se apagam. */
const DO_SISTEMA = new Set(['Outros', 'Pessoais']);

export interface NegocioLido {
  id: string;
  name: string;
  system: boolean;
  archived: boolean;
  sortOrder: number;
}

/**
 * Os negócios do usuário, semeando na primeira vez.
 *
 * A semeadura usa `createMany` com `skipDuplicates`: duas abas abrindo a
 * tela ao mesmo tempo não podem criar a lista em dobro.
 */
/**
 * A lista de código, no formato da tabela.
 *
 * Serve de rede: enquanto o delta de SQL não roda em produção, a tabela não
 * existe e uma consulta a ela derruba toda a tela do financeiro. Já
 * aconteceu — e uma migração pendente não pode custar o app inteiro. Sem
 * `id` real, a tela de cadastro não deixa editar; é o comportamento certo,
 * porque não há onde gravar ainda.
 */
function listaDeCodigo(): NegocioLido[] {
  return BUSINESS_CONTEXTS.map((name, i) => ({
    id: `codigo:${name}`,
    name,
    system: true,
    archived: false,
    sortOrder: (i + 1) * 10,
  }));
}

export async function listarNegocios(userId: string, incluirArquivados = false): Promise<NegocioLido[]> {
  try {
    const existe = await prisma.business.count({ where: { userId } });

    if (existe === 0) {
      await prisma.business.createMany({
        data: BUSINESS_CONTEXTS.map((name, i) => ({
          userId,
          name,
          sortOrder: (i + 1) * 10,
          system: DO_SISTEMA.has(name),
        })),
        skipDuplicates: true,
      });
    }

    return await prisma.business.findMany({
      where: { userId, ...(incluirArquivados ? {} : { archived: false }) },
      orderBy: [{ archived: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, system: true, archived: true, sortOrder: true },
    });
  } catch {
    // Tabela ainda não criada (delta pendente) ou banco fora: a lista de
    // código mantém as telas de pé. O cadastro fica indisponível, o resto
    // funciona.
    return listaDeCodigo();
  }
}

/** Só os nomes ativos, na ordem — é o que os menus e o prompt consomem. */
export async function nomesDeNegocio(userId: string): Promise<string[]> {
  return (await listarNegocios(userId)).map((n) => n.name);
}

export interface UsoDoNegocio {
  contas: number;
  lancamentos: number;
  regras: number;
  perfis: number;
  propostas: number;
  total: number;
}

/**
 * Quantas linhas citam este nome.
 *
 * É o número que decide se dá para apagar, e é o número que a tela mostra
 * antes de você clicar. O negócio é gravado como TEXTO em cinco lugares —
 * esta função é a lista completa deles, e quem acrescentar um sexto tem de
 * passar por aqui.
 */
export async function contarUsos(userId: string, nome: string): Promise<UsoDoNegocio> {
  const [contas, lancamentos, regras, perfis, propostas] = await Promise.all([
    prisma.financialAccount.count({ where: { userId, business: nome } }),
    prisma.ledgerEntry.count({ where: { userId, business: nome } }),
    prisma.categoryRule.count({ where: { userId, business: nome } }),
    prisma.mailboxProfile.count({ where: { connection: { userId }, businessName: nome } }),
    prisma.inboxMessage.count({ where: { userId, proposedBusiness: nome } }),
  ]);

  return {
    contas,
    lancamentos,
    regras,
    perfis,
    propostas,
    total: contas + lancamentos + regras + perfis + propostas,
  };
}

export type Resultado = { ok: true } | { ok: false; erro: string };

export async function criarNegocio(userId: string, bruto: string): Promise<Resultado> {
  const existentes = (await listarNegocios(userId, true)).map((n) => n.name);
  const erro = validarNome(bruto, existentes);
  if (erro) return { ok: false, erro: mensagemDoErro(erro) };

  const maior = await prisma.business.aggregate({ where: { userId }, _max: { sortOrder: true } });
  await prisma.business.create({
    data: { userId, name: normalizarNome(bruto), sortOrder: (maior._max.sortOrder ?? 0) + 10 },
  });
  return { ok: true };
}

/**
 * Renomeia E migra as linhas que citam o nome antigo — na mesma transação.
 *
 * É a razão de esta tela existir em vez de um campo de texto. Sem a
 * migração, renomear "Brand.co" para "Brand" faria os lançamentos antigos
 * sumirem do filtro do novo nome: a tela mentiria em silêncio, e você só
 * descobriria ao estranhar um total.
 */
export async function renomearNegocio(userId: string, id: string, bruto: string): Promise<Resultado> {
  const negocio = await prisma.business.findFirst({ where: { id, userId }, select: { name: true, system: true } });
  if (!negocio) return { ok: false, erro: 'Negócio não encontrado' };
  if (negocio.system) return { ok: false, erro: `"${negocio.name}" é fixo: não é um negócio, é a regra de escape.` };

  const outros = (await listarNegocios(userId, true)).map((n) => n.name).filter((n) => n !== negocio.name);
  const erro = validarNome(bruto, outros);
  if (erro) return { ok: false, erro: mensagemDoErro(erro) };

  const novo = normalizarNome(bruto);
  const antigo = negocio.name;

  if (!precisaMigrar(antigo, novo)) return { ok: true };

  await prisma.$transaction([
    prisma.business.update({ where: { id }, data: { name: novo } }),
    prisma.financialAccount.updateMany({ where: { userId, business: antigo }, data: { business: novo } }),
    prisma.ledgerEntry.updateMany({ where: { userId, business: antigo }, data: { business: novo } }),
    prisma.categoryRule.updateMany({ where: { userId, business: antigo }, data: { business: novo } }),
    prisma.mailboxProfile.updateMany({ where: { connection: { userId }, businessName: antigo }, data: { businessName: novo } }),
    prisma.inboxMessage.updateMany({ where: { userId, proposedBusiness: antigo }, data: { proposedBusiness: novo } }),
  ]);

  return { ok: true };
}

/** Sai dos menus, continua explicando o histórico. */
export async function arquivarNegocio(userId: string, id: string, arquivado: boolean): Promise<Resultado> {
  const negocio = await prisma.business.findFirst({ where: { id, userId }, select: { name: true, system: true } });
  if (!negocio) return { ok: false, erro: 'Negócio não encontrado' };
  if (negocio.system && arquivado) {
    return { ok: false, erro: `"${negocio.name}" é fixo e precisa existir para o resto funcionar.` };
  }
  await prisma.business.update({ where: { id }, data: { archived: arquivado } });
  return { ok: true };
}

/**
 * Apaga — e só quando ninguém cita.
 *
 * Apagar com histórico deixaria linhas apontando para um nome que não
 * existe mais: some do menu e continua no dado, que é o pior dos dois
 * mundos. Com uso, o caminho é arquivar.
 */
export async function apagarNegocio(userId: string, id: string): Promise<Resultado> {
  const negocio = await prisma.business.findFirst({ where: { id, userId }, select: { name: true, system: true } });
  if (!negocio) return { ok: false, erro: 'Negócio não encontrado' };
  if (negocio.system) return { ok: false, erro: `"${negocio.name}" é fixo e não pode ser apagado.` };

  const uso = await contarUsos(userId, negocio.name);
  if (uso.total > 0) {
    return {
      ok: false,
      erro: `${uso.total} registro${uso.total === 1 ? '' : 's'} ainda usa${uso.total === 1 ? '' : 'm'} "${negocio.name}". Arquive em vez de apagar.`,
    };
  }

  await prisma.business.delete({ where: { id } });
  return { ok: true };
}

/** Existe e está ativo? Substitui o `isBusinessContext` da lista fixa. */
export async function negocioValido(userId: string, nome: string): Promise<boolean> {
  // `listarNegocios` já cai na lista de código quando a tabela não existe,
  // então uma migração pendente recusa nome novo em vez de dar erro 500.
  const nomes = await listarNegocios(userId, true);
  return nomes.some((n) => chaveDeNome(n.name) === chaveDeNome(nome));
}
