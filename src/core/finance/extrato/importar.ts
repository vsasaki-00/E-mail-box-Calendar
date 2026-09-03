import type { FinancialAccountKind, LedgerSource, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { lerExtrato } from './ler';
import { hashDoArquivo, impressaoDigital, normalizarDescricao } from './normalizar';
import type { ContaDoArquivo, LancamentoBruto } from './types';
import { nomeDoBanco } from '../bancos';

/**
 * Importa um arquivo de extrato para o razao.
 *
 * Tres garantias, porque sao as tres coisas que dao errado em importacao:
 *
 * 1. **O mesmo arquivo duas vezes nao cria nada.** Hash do arquivo na
 *    StatementImport. Ninguem lembra o que ja subiu.
 * 2. **O mesmo lancamento em dois arquivos nao duplica.** Extratos de
 *    periodos que se sobrepoem sao a regra, nao a excecao (o banco exporta
 *    "ultimos 90 dias"). FITID quando ha, impressao digital quando nao ha,
 *    e `skipDuplicates` na unique (accountId, fingerprint).
 * 3. **Nada e descartado em silencio.** O que nao entrou vira contagem e
 *    aviso na propria importacao.
 *
 * Ver docs/10-financeiro.md
 */

export type ResultadoImportacao =
  | {
      ok: true;
      statementId: string;
      accountId: string;
      contaRotulo: string;
      formato: 'OFX' | 'CSV' | 'PDF';
      encontrados: number;
      criados: number;
      duplicados: number;
      avisos: string[];
      /** O arquivo inteiro ja tinha sido importado antes. */
      jaImportado: boolean;
    }
  | { ok: false; erro: string; avisos?: string[] };

export interface ImportarParams {
  userId: string;
  bytes: Uint8Array;
  fileName?: string;
  /** Conta escolhida por voce. Obrigatoria para CSV; para OFX, opcional. */
  accountId?: string;
  /** Para criar a conta na hora (CSV sem conta existente). */
  novaConta?: { label: string; kind?: FinancialAccountKind; business?: string; institution?: string };
}

/**
 * Rotulo automatico quando o arquivo cria a conta sozinho.
 *
 * "Nubank · conta 0001/667683447-8", e nao "Conta banco 0260 ...": o codigo
 * e verdadeiro e inutil — ninguem sabe de cabeca que 0260 e o Nubank. O
 * nome e o que torna a conta reconhecivel na tela. Voce pode renomear.
 */
export function rotuloAutomatico(conta: ContaDoArquivo): string {
  const banco = nomeDoBanco(conta.bankId) ?? (conta.bankId ? `banco ${conta.bankId}` : undefined);
  const tipo = conta.kind === 'CREDIT_CARD' ? 'cartão' : 'conta';
  const numero = conta.accountId ? `${tipo} ${conta.accountId}` : undefined;
  const partes = [banco, numero].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : 'Conta importada';
}

async function resolverConta(
  params: ImportarParams,
  contaDoArquivo: ContaDoArquivo,
): Promise<{ id: string; label: string; business: string | null } | { erro: string }> {
  if (params.accountId) {
    const conta = await prisma.financialAccount.findFirst({
      where: { id: params.accountId, userId: params.userId },
      select: { id: true, label: true, business: true },
    });
    return conta ?? { erro: 'Conta não encontrada' };
  }

  if (params.novaConta) {
    const criada = await prisma.financialAccount.create({
      data: {
        userId: params.userId,
        label: params.novaConta.label.trim() || rotuloAutomatico(contaDoArquivo),
        kind: params.novaConta.kind ?? contaDoArquivo.kind ?? 'CHECKING',
        business: params.novaConta.business ?? null,
        institution: params.novaConta.institution ?? nomeDoBanco(contaDoArquivo.bankId) ?? null,
        bankId: contaDoArquivo.bankId ?? null,
        accountId: contaDoArquivo.accountId ?? null,
        currency: contaDoArquivo.currency ?? 'BRL',
      },
      select: { id: true, label: true, business: true },
    });
    return criada;
  }

  // OFX identifica a conta: acha ou cria pelo par (banco, conta). Nao e
  // upsert porque a unique tem colunas nulas (cartao nao tem BANKID) e
  // Postgres trata NULL como distinto — o upsert nunca acharia.
  if (contaDoArquivo.accountId) {
    const existente = await prisma.financialAccount.findFirst({
      where: {
        userId: params.userId,
        bankId: contaDoArquivo.bankId ?? null,
        accountId: contaDoArquivo.accountId,
      },
      select: { id: true, label: true, business: true, institution: true },
    });
    if (existente) {
      // Conta criada antes de o nome do banco existir: preenche agora, sem
      // mexer no rotulo — esse pode ser seu.
      const banco = nomeDoBanco(contaDoArquivo.bankId);
      if (!existente.institution && banco) {
        await prisma.financialAccount.update({
          where: { id: existente.id },
          data: { institution: banco },
        });
      }
      return { id: existente.id, label: existente.label, business: existente.business };
    }

    return prisma.financialAccount.create({
      data: {
        userId: params.userId,
        label: rotuloAutomatico(contaDoArquivo),
        institution: nomeDoBanco(contaDoArquivo.bankId) ?? null,
        kind: contaDoArquivo.kind ?? 'CHECKING',
        bankId: contaDoArquivo.bankId ?? null,
        accountId: contaDoArquivo.accountId,
        currency: contaDoArquivo.currency ?? 'BRL',
      },
      select: { id: true, label: true, business: true },
    });
  }

  return {
    erro: 'Este arquivo não identifica a conta. Escolha uma conta existente ou crie uma.',
  };
}

/** Monta as linhas com impressao digital, contando ocorrencias iguais dentro do arquivo. */
function prepararLinhas(
  lancamentos: LancamentoBruto[],
  base: { userId: string; accountId: string; statementId: string; source: LedgerSource; business: string | null },
): Prisma.LedgerEntryCreateManyInput[] {
  const ocorrencias = new Map<string, number>();

  return lancamentos.map((l) => {
    const normalized = normalizarDescricao(l.description);
    const chave = `${l.postedAt.toISOString().slice(0, 10)}|${l.amountCents}|${normalized}`;
    const n = ocorrencias.get(chave) ?? 0;
    ocorrencias.set(chave, n + 1);

    return {
      userId: base.userId,
      accountId: base.accountId,
      statementId: base.statementId,
      postedAt: l.postedAt,
      amountCents: l.amountCents,
      description: l.description,
      normalized,
      source: base.source,
      fitId: l.fitId ?? null,
      fingerprint: impressaoDigital({
        fitId: l.fitId,
        postedAt: l.postedAt,
        amountCents: l.amountCents,
        normalized,
        ocorrencia: n,
      }),
      business: base.business,
    };
  });
}

export async function importarExtrato(params: ImportarParams): Promise<ResultadoImportacao> {
  const fileHash = hashDoArquivo(params.bytes);

  const anterior = await prisma.statementImport.findUnique({
    where: { userId_fileHash: { userId: params.userId, fileHash } },
    include: { account: { select: { label: true } } },
  });
  if (anterior) {
    return {
      ok: true,
      jaImportado: true,
      statementId: anterior.id,
      accountId: anterior.accountId,
      contaRotulo: anterior.account.label,
      formato: anterior.source === 'MANUAL' ? 'CSV' : anterior.source,
      encontrados: anterior.entriesFound,
      criados: 0,
      duplicados: anterior.entriesFound,
      avisos: ['Este arquivo já tinha sido importado. Nada foi criado.'],
    };
  }

  const extrato = await lerExtrato(params.bytes);
  if (extrato.lancamentos.length === 0) {
    return { ok: false, erro: 'Nenhum lançamento legível no arquivo.', avisos: extrato.avisos };
  }

  const conta = await resolverConta(params, extrato.conta);
  if ('erro' in conta) return { ok: false, erro: conta.erro, avisos: extrato.avisos };

  const source: LedgerSource = extrato.formato;

  const statement = await prisma.statementImport.create({
    data: {
      userId: params.userId,
      accountId: conta.id,
      source,
      fileName: params.fileName ?? null,
      fileHash,
      periodStart: extrato.periodStart ?? null,
      periodEnd: extrato.periodEnd ?? null,
      entriesFound: extrato.lancamentos.length,
      warnings: extrato.avisos,
    },
  });

  const linhas = prepararLinhas(extrato.lancamentos, {
    userId: params.userId,
    accountId: conta.id,
    statementId: statement.id,
    source,
    business: conta.business,
  });

  // A unique (accountId, fingerprint) + skipDuplicates e a deduplicacao
  // entre arquivos. O banco decide, nao um loop de findFirst.
  const criacao = await prisma.ledgerEntry.createMany({ data: linhas, skipDuplicates: true });
  const criados = criacao.count;
  const duplicados = linhas.length - criados;

  const atualizacoes: Prisma.PrismaPromise<unknown>[] = [
    prisma.statementImport.update({
      where: { id: statement.id },
      data: { entriesCreated: criados, entriesDuplicate: duplicados },
    }),
  ];

  // Saldo do OFX: so avanca se for mais novo que o que temos.
  if (extrato.conta.balanceCents !== undefined) {
    const atual = await prisma.financialAccount.findUnique({
      where: { id: conta.id },
      select: { balanceAt: true },
    });
    const quando = extrato.conta.balanceAt ?? extrato.periodEnd ?? new Date();
    if (!atual?.balanceAt || quando >= atual.balanceAt) {
      atualizacoes.push(
        prisma.financialAccount.update({
          where: { id: conta.id },
          data: { balanceCents: extrato.conta.balanceCents, balanceAt: quando },
        }),
      );
    }
  }
  await prisma.$transaction(atualizacoes);

  // Ja procura pares: o extrato acabou de chegar e as cobrancas ja estao
  // la. Falhar aqui nao pode desfazer a importacao — vira aviso.
  let sugeridos = 0;
  try {
    const { sugerirPares } = await import('../conciliacao/sugerir');
    sugeridos = (await sugerirPares(params.userId)).sugeridos;
  } catch {
    // A conciliacao tem sua propria tela e botao; a importacao ja valeu.
  }

  // Notas que esperavam o extrato: colam ANTES das categorias, porque a
  // categoria que voce deu na nota tem precedencia sobre regra e palpite.
  let coladas = 0;
  try {
    const { aplicarNotasPendentes } = await import('./notas-aplicar');
    coladas = (await aplicarNotasPendentes(params.userId, statement.id)).coladas;
  } catch {
    // A nota continua esperando a proxima importacao; nada se perde.
  }

  // Categorias: regras suas e palpites, so no que ainda nao tem.
  try {
    const { aplicarCategorias } = await import('../categorizar');
    await aplicarCategorias(params.userId);
  } catch {
    // Tem botao proprio na tela; a importacao ja valeu.
  }

  const avisos = [...extrato.avisos];
  if (sugeridos > 0) {
    avisos.push(`${sugeridos} par(es) com cobranças de e-mail sugerido(s) — confira em Conciliação.`);
  }
  if (coladas > 0) {
    avisos.push(
      coladas === 1
        ? '1 nota do WhatsApp colou no lançamento correspondente.'
        : `${coladas} notas do WhatsApp colaram nos lançamentos correspondentes.`,
    );
  }
  if (duplicados > 0) {
    avisos.push(`${duplicados} lançamento(s) já existiam (de outro arquivo) e não foram repetidos.`);
  }

  return {
    ok: true,
    jaImportado: false,
    statementId: statement.id,
    accountId: conta.id,
    contaRotulo: conta.label,
    formato: extrato.formato,
    encontrados: linhas.length,
    criados,
    duplicados,
    avisos,
  };
}
