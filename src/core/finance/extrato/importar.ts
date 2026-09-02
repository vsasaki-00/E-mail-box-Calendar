import type { FinancialAccountKind, LedgerSource, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { lerExtrato } from './ler';
import { hashDoArquivo, impressaoDigital, normalizarDescricao } from './normalizar';
import type { ContaDoArquivo, LancamentoBruto } from './types';

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
      formato: 'OFX' | 'CSV';
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

/** Rotulo automatico quando o OFX cria a conta sozinho. */
function rotuloAutomatico(conta: ContaDoArquivo): string {
  const tipo = conta.kind === 'CREDIT_CARD' ? 'Cartão' : 'Conta';
  const partes = [tipo, conta.bankId ? `banco ${conta.bankId}` : undefined, conta.accountId]
    .filter(Boolean)
    .join(' ');
  return partes || 'Conta importada';
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
        institution: params.novaConta.institution ?? null,
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
      select: { id: true, label: true, business: true },
    });
    if (existente) return existente;

    return prisma.financialAccount.create({
      data: {
        userId: params.userId,
        label: rotuloAutomatico(contaDoArquivo),
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
      formato: anterior.source === 'OFX' ? 'OFX' : 'CSV',
      encontrados: anterior.entriesFound,
      criados: 0,
      duplicados: anterior.entriesFound,
      avisos: ['Este arquivo já tinha sido importado. Nada foi criado.'],
    };
  }

  const extrato = lerExtrato(params.bytes);
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

  const avisos = [...extrato.avisos];
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
