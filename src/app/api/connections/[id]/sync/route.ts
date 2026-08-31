import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { agendarSyncImediato, runSync } from '@/core/sync/engine';
import { getConnector } from '@/lib/connectors/registry';

/**
 * Forca um sync agora, sem esperar o worker.
 *
 * O motor processa UMA pagina por chamada e persiste o cursor — desenho
 * feito para o worker, que chama em loop. Aqui o loop acontece dentro da
 * requisicao, ate um prazo folgado abaixo do teto da funcao: cada resposta
 * volta com o resumo do que avancou, e o navegador decide se pede mais.
 */

// 60s e o teto seguro do plano Hobby da Vercel.
export const maxDuration = 60;

/**
 * UMA execucao por recurso, por requisicao. Sem laco aqui.
 *
 * O laco existia para poupar idas e vindas, mas encadeava trabalho de
 * duracao imprevisivel e foi assim que a funcao estourou o limite
 * (FUNCTION_INVOCATION_TIMEOUT em producao). Quando a plataforma corta,
 * quem responde e ela — com uma pagina de texto, sem a causa. O laco de
 * verdade vive no navegador (`sync-controls.tsx`), onde cada volta e uma
 * requisicao curta e o progresso aparece na tela.
 *
 * O conector tem orcamento proprio (GRAPH_RUN_BUDGET_MS), entao cada
 * execucao ja devolve o controle sozinha.
 */

interface ResumoRecurso {
  resource: string;
  outcome: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  counts: { created: number; updated: number; deleted: number };
  errorMessage?: string;
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await sincronizar(params);
  } catch (error) {
    // Rede de seguranca: `runSync` ja transforma falha de conector em
    // resultado FAILED, mas qualquer coisa fora dele (banco, keyring,
    // registry) escaparia como 500 sem corpo JSON — e o botao mostraria um
    // erro de parse no lugar do motivo.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha inesperada no sync' },
      { status: 500 },
    );
  }
}

async function sincronizar(params: Promise<{ id: string }>): Promise<NextResponse> {
  const { id } = await params;

  const conexao = await prisma.connection.findUnique({ where: { id } });
  if (!conexao) {
    return NextResponse.json({ error: 'Conexão não encontrada' }, { status: 404 });
  }

  // Credencial ausente e um estado REAL: acontece quando o callback do OAuth
  // morre entre criar a Connection e gravar o segredo. A conta fica na tela
  // parecendo saudavel e nunca sincroniza. Dizer isso em voz alta e melhor
  // que devolver sucesso vazio.
  if (!conexao.secretCiphertext) {
    return NextResponse.json(
      { error: 'Conexão sem credenciais — desconecte e conecte a conta de novo.' },
      { status: 409 },
    );
  }

  // Auto-reparo: garante um SyncState por recurso que o conector suporta.
  // Sem isto, uma conexao que perdeu esta etapa fica orfa para sempre — a
  // consulta abaixo volta vazia e o sync "termina" sem ter feito nada.
  const capacidades = getConnector(conexao.provider).capabilities;
  const suportados = [
    ...(capacidades.mail ? (['MAIL'] as const) : []),
    ...(capacidades.calendar ? (['CALENDAR'] as const) : []),
  ];
  for (const resource of suportados) {
    await prisma.syncState.upsert({
      where: { connectionId_resource: { connectionId: id, resource } },
      create: { connectionId: id, resource, nextRunAt: new Date() },
      update: {},
    });
  }

  await agendarSyncImediato(id);

  const estados = await prisma.syncState.findMany({
    where: { connectionId: id, resource: { in: ['MAIL', 'CALENDAR'] } },
    include: { connection: true },
  });

  // Cinto e suspensorio: se ainda assim nao ha o que rodar, isso e um erro
  // a mostrar, nunca um sucesso de zero itens.
  if (estados.length === 0) {
    return NextResponse.json(
      { error: 'Conexão sem recursos de sincronização. Desconecte e conecte de novo.' },
      { status: 409 },
    );
  }

  const resultados: ResumoRecurso[] = [];

  for (const estado of estados) {
    const resultado = await runSync(estado, new Date());

    // PARTIAL significa "sobrou trabalho", e e o que manda o navegador pedir
    // a proxima volta.
    resultados.push({
      resource: estado.resource,
      outcome: resultado.outcome,
      counts: resultado.counts,
      ...(resultado.errorMessage ? { errorMessage: resultado.errorMessage } : {}),
    });
  }

  return NextResponse.json({ results: resultados });
}
