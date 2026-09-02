import { NextResponse } from 'next/server';
import type { FinancialAccountKind } from '@prisma/client';
import { prisma } from '@/lib/db';
import { importarExtrato } from '@/core/finance/extrato/importar';
import { isBusinessContext } from '@/core/triage/businesses';

/**
 * Upload de extrato (OFX ou CSV). Ver docs/10-financeiro.md
 *
 * Multipart, campo `arquivo`. Opcionais: `accountId` (conta existente) ou
 * `novaContaLabel` + `novaContaKind` + `novaContaBusiness` para criar uma.
 * OFX identifica a conta sozinho quando nenhum dos dois vem.
 *
 * O arquivo nao e guardado: so o hash. Extrato e mais sensivel que e-mail e
 * nao ha motivo para manter o original depois de ler.
 */

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const TAMANHO_MAXIMO = 5 * 1024 * 1024;
const TIPOS_CONTA: FinancialAccountKind[] = ['CHECKING', 'SAVINGS', 'CREDIT_CARD', 'CASH', 'INVESTMENT', 'OTHER'];

export async function POST(request: Request) {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return NextResponse.json({ error: 'Sem usuário' }, { status: 400 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Envie o arquivo como multipart/form-data' }, { status: 400 });
  }

  const arquivo = form.get('arquivo');
  if (!(arquivo instanceof File)) {
    return NextResponse.json({ error: 'Campo "arquivo" ausente' }, { status: 400 });
  }
  if (arquivo.size === 0) return NextResponse.json({ error: 'Arquivo vazio' }, { status: 400 });
  if (arquivo.size > TAMANHO_MAXIMO) {
    return NextResponse.json({ error: 'Arquivo acima de 5 MB' }, { status: 413 });
  }

  const accountId = String(form.get('accountId') ?? '').trim() || undefined;
  const novaLabel = String(form.get('novaContaLabel') ?? '').trim();
  const novaKind = String(form.get('novaContaKind') ?? '').trim();
  const novaBusiness = String(form.get('novaContaBusiness') ?? '').trim();

  const resultado = await importarExtrato({
    userId: usuario.id,
    bytes: new Uint8Array(await arquivo.arrayBuffer()),
    fileName: arquivo.name,
    accountId,
    novaConta:
      !accountId && novaLabel
        ? {
            label: novaLabel,
            kind: TIPOS_CONTA.includes(novaKind as FinancialAccountKind)
              ? (novaKind as FinancialAccountKind)
              : undefined,
            business: isBusinessContext(novaBusiness) ? novaBusiness : undefined,
          }
        : undefined,
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.erro, avisos: resultado.avisos ?? [] }, { status: 422 });
  }
  // So contagens e avisos. Nenhuma descricao de lancamento sai no log.
  return NextResponse.json(resultado);
}
