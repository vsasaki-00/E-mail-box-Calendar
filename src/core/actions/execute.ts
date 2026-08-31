import type { ActionRequest, Connection } from '@prisma/client';
import { prisma } from '@/lib/db';
import { keyringFromEnv } from '@/lib/crypto';
import { buildContext } from '@/core/sync/engine';
import { getConnector } from '@/lib/connectors/registry';
import type { Connector, ConnectorContext } from '@/lib/connectors/types';
import {
  checkActionPolicy,
  describeAction,
  isReversible,
  specFor,
  type ActionActor,
  type ActionKind,
} from './policy';

/**
 * Execucao das acoes de escrita. Ver docs/08-escrita-e-acoes.md
 *
 * Tres garantias que este arquivo existe para manter:
 *
 * 1. **Nada executa sem passar pela politica.** A checagem acontece aqui,
 *    no caminho unico, e nao na UI — uma trava que mora na tela e uma
 *    trava que a proxima tela esquece.
 * 2. **O estado ANTERIOR e gravado antes de executar.** Sem isso,
 *    "desfazer" seria um chute sobre como a caixa estava.
 * 3. **O registro e o mesmo objeto da fila.** Log separado diverge, e ai
 *    voce tem dois registros discordando sobre o que o app fez.
 */

export interface RequestActionInput {
  userId: string;
  connectionId: string;
  kind: ActionKind;
  providerId: string;
  unifiedItemId?: string | null;
  params?: Record<string, unknown>;
  actor?: ActionActor;
  /** Assunto do item, so para a descricao ficar legivel no log. */
  subject?: string | null;
}

export interface ActionOutcome {
  ok: boolean;
  actionId?: string;
  error?: string;
  refusal?: string;
}

/**
 * Registra a acao como PENDENTE. Nao executa.
 *
 * Separar pedir de executar e o que torna a fila de confirmacao real: o
 * agente pode propor a manha inteira, e nada acontece ate voce olhar.
 */
export async function requestAction(input: RequestActionInput): Promise<ActionOutcome> {
  const conexao = await prisma.connection.findFirst({
    where: { id: input.connectionId, userId: input.userId },
  });
  if (!conexao) return { ok: false, error: 'Conexão não encontrada' };

  const conector = getConnector(conexao.provider);
  const actor = input.actor ?? 'USER';

  // A politica roda no pedido E na execucao. No pedido para a UI poder
  // explicar; na execucao porque o estado pode ter mudado no meio.
  const check = checkActionPolicy({
    kind: input.kind,
    connectionWriteEnabled: conexao.writeEnabled,
    connectorCanWrite: conector.capabilities.write,
    actor,
    // Enfileirar nao toca na caixa: uma acao irreversivel entra como
    // PENDENTE e so sai de la com a sua confirmacao, na tela.
    stage: 'REQUEST',
  });
  if (!check.allowed) return { ok: false, refusal: check.refusal, error: check.message };

  const acao = await prisma.actionRequest.create({
    data: {
      userId: input.userId,
      connectionId: input.connectionId,
      kind: input.kind,
      actor,
      unifiedItemId: input.unifiedItemId ?? null,
      providerId: input.providerId,
      params: (input.params ?? {}) as object,
      reversible: isReversible(input.kind),
      description: describeAction(input.kind, {
        subject: input.subject ?? undefined,
        labelName: input.params?.labelName as string | undefined,
        to: (input.params?.to as string[] | undefined)?.join(', '),
        newStart: input.params?.newStartLabel as string | undefined,
      }),
    },
  });

  return { ok: true, actionId: acao.id };
}

interface ExecuteOptions {
  /** Voce clicou em confirmar nesta acao especifica? */
  explicitlyConfirmed: boolean;
  /** O rascunho ligado a esta acao foi aprovado por voce? */
  draftApproved?: boolean;
}

/**
 * Executa uma acao ja registrada.
 *
 * Nunca lanca: a falha vira `status: FAILED` com a mensagem, e a acao fica
 * visivel no log em vez de sumir.
 */
export async function executeAction(
  actionId: string,
  userId: string,
  options: ExecuteOptions,
): Promise<ActionOutcome> {
  const acao = await prisma.actionRequest.findFirst({
    where: { id: actionId, userId },
    include: { connection: true },
  });
  if (!acao) return { ok: false, error: 'Ação não encontrada' };

  if (acao.status === 'DONE') return { ok: true, actionId: acao.id };
  if (acao.status !== 'PENDING' && acao.status !== 'CONFIRMED') {
    return { ok: false, error: `Ação em estado ${acao.status}` };
  }

  const conector = getConnector(acao.connection.provider);
  const check = checkActionPolicy({
    kind: acao.kind as ActionKind,
    connectionWriteEnabled: acao.connection.writeEnabled,
    connectorCanWrite: conector.capabilities.write,
    actor: acao.actor as ActionActor,
    stage: 'EXECUTE',
    explicitlyConfirmed: options.explicitlyConfirmed,
    draftApproved: options.draftApproved,
  });
  if (!check.allowed) return { ok: false, refusal: check.refusal, error: check.message };

  try {
    // `buildContext` DENTRO do try: ele lanca quando a conexao esta sem
    // credenciais, e uma acao que estoura em vez de virar FAILED some do
    // log — que e exatamente a garantia que este arquivo promete manter.
    const contexto = buildContext(acao.connection, keyringFromEnv());
    const anterior = await capturarEstadoAnterior(acao, contexto, conector);

    await prisma.actionRequest.update({
      where: { id: acao.id },
      // Grava o estado ANTERIOR antes de mexer: se a execucao morrer no
      // meio, o desfazer ainda sabe para onde voltar.
      data: { status: 'CONFIRMED', confirmedAt: new Date(), previousState: anterior as object },
    });

    await aplicar(acao, contexto, conector);

    await prisma.actionRequest.update({
      where: { id: acao.id },
      data: { status: 'DONE', executedAt: new Date(), error: null },
    });

    return { ok: true, actionId: acao.id };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await prisma.actionRequest.update({
      where: { id: acao.id },
      data: { status: 'FAILED', error: mensagem },
    });
    return { ok: false, actionId: acao.id, error: mensagem };
  }
}

type AcaoComConexao = ActionRequest & { connection: Connection };

/** Le da caixa como o item esta AGORA, para poder voltar depois. */
async function capturarEstadoAnterior(
  acao: AcaoComConexao,
  _ctx: ConnectorContext,
  _conector: Connector,
): Promise<Record<string, unknown>> {
  switch (acao.kind) {
    case 'MARK_READ':
    case 'MARK_UNREAD': {
      const mensagem = await prisma.message.findFirst({
        where: { connectionId: acao.connectionId, providerId: acao.providerId },
        select: { isRead: true },
      });
      return { isRead: mensagem?.isRead ?? null };
    }
    case 'EVENT_ACCEPT':
    case 'EVENT_DECLINE':
    case 'EVENT_TENTATIVE': {
      const evento = await prisma.calendarEvent.findFirst({
        where: { connectionId: acao.connectionId, providerId: acao.providerId },
        select: { responseStatus: true },
      });
      return { responseStatus: evento?.responseStatus ?? null };
    }
    case 'EVENT_MOVE': {
      const evento = await prisma.calendarEvent.findFirst({
        where: { connectionId: acao.connectionId, providerId: acao.providerId },
        select: { startsAt: true, endsAt: true },
      });
      return {
        startsAt: evento?.startsAt?.toISOString() ?? null,
        endsAt: evento?.endsAt?.toISOString() ?? null,
      };
    }
    default:
      // Arquivar/label nao precisam ler nada: a inversa e simetrica.
      return {};
  }
}

function refDoEvento(acao: AcaoComConexao): { calendarProviderId: string; eventProviderId: string } {
  const params = acao.params as Record<string, unknown>;
  return {
    calendarProviderId: String(params.calendarProviderId ?? 'primary'),
    eventProviderId: acao.providerId,
  };
}

async function aplicar(
  acao: AcaoComConexao,
  ctx: ConnectorContext,
  conector: Connector,
): Promise<void> {
  const params = acao.params as Record<string, unknown>;
  const faltando = (metodo: string): never => {
    throw new Error(`O conector ${acao.connection.provider} não implementa ${metodo}`);
  };

  switch (acao.kind) {
    case 'ARCHIVE':
      await (conector.archiveMessage ?? faltando('archiveMessage'))(ctx, acao.providerId);
      return;
    case 'UNARCHIVE':
      await (conector.unarchiveMessage ?? faltando('unarchiveMessage'))(ctx, acao.providerId);
      return;
    case 'MARK_READ':
      await (conector.setMessageRead ?? faltando('setMessageRead'))(ctx, acao.providerId, true);
      return;
    case 'MARK_UNREAD':
      await (conector.setMessageRead ?? faltando('setMessageRead'))(ctx, acao.providerId, false);
      return;
    case 'ADD_LABEL':
      await (conector.setMessageLabel ?? faltando('setMessageLabel'))(
        ctx,
        acao.providerId,
        String(params.labelId ?? params.labelName ?? ''),
        true,
      );
      return;
    case 'REMOVE_LABEL':
      await (conector.setMessageLabel ?? faltando('setMessageLabel'))(
        ctx,
        acao.providerId,
        String(params.labelId ?? params.labelName ?? ''),
        false,
      );
      return;
    case 'EVENT_ACCEPT':
      await (conector.respondToEvent ?? faltando('respondToEvent'))(ctx, refDoEvento(acao), 'ACCEPTED');
      return;
    case 'EVENT_DECLINE':
      await (conector.respondToEvent ?? faltando('respondToEvent'))(ctx, refDoEvento(acao), 'DECLINED');
      return;
    case 'EVENT_TENTATIVE':
      await (conector.respondToEvent ?? faltando('respondToEvent'))(ctx, refDoEvento(acao), 'TENTATIVE');
      return;
    case 'EVENT_MOVE':
      await (conector.moveEvent ?? faltando('moveEvent'))(
        ctx,
        refDoEvento(acao),
        new Date(String(params.startsAt)),
        new Date(String(params.endsAt)),
      );
      return;
    case 'EVENT_CREATE':
      await (conector.createEvent ?? faltando('createEvent'))(ctx, {
        calendarProviderId: String(params.calendarProviderId ?? 'primary'),
        title: String(params.title ?? '(sem título)'),
        startsAt: new Date(String(params.startsAt)),
        endsAt: new Date(String(params.endsAt)),
        description: params.description as string | undefined,
        attendees: params.attendees as string[] | undefined,
      });
      return;
    case 'SEND_REPLY':
      await (conector.sendReply ?? faltando('sendReply'))(ctx, {
        inReplyToProviderId: acao.providerId,
        to: (params.to as string[] | undefined) ?? [],
        subject: String(params.subject ?? ''),
        bodyText: String(params.bodyText ?? ''),
      });
      return;
    default:
      throw new Error(`Ação desconhecida: ${acao.kind}`);
  }
}

/**
 * Desfaz uma acao ja executada.
 *
 * So para o que e reversivel — e o desfazer NAO apaga o registro: ele vira
 * `UNDONE` e continua no log. Auditoria que some quando voce desfaz nao e
 * auditoria.
 */
export async function undoAction(actionId: string, userId: string): Promise<ActionOutcome> {
  const acao = await prisma.actionRequest.findFirst({
    where: { id: actionId, userId },
    include: { connection: true },
  });
  if (!acao) return { ok: false, error: 'Ação não encontrada' };
  if (acao.status !== 'DONE') return { ok: false, error: 'Só dá para desfazer ação executada' };
  if (!acao.reversible) {
    return { ok: false, error: 'Esta ação não tem volta. O registro fica no log.' };
  }

  const inversa = specFor(acao.kind as ActionKind).inverse;
  const conector = getConnector(acao.connection.provider);

  try {
    // Mesmo motivo do `executeAction`: sem credencial, `buildContext`
    // lanca, e o desfazer precisa registrar o erro em vez de estourar.
    const contexto = buildContext(acao.connection, keyringFromEnv());
    if (acao.kind === 'EVENT_MOVE') {
      // Mover de volta usa os horarios que foram gravados antes.
      const anterior = (acao.previousState ?? {}) as { startsAt?: string; endsAt?: string };
      if (!anterior.startsAt || !anterior.endsAt) {
        throw new Error('Horário anterior não foi registrado');
      }
      await (conector.moveEvent ?? (() => {
        throw new Error('Conector sem moveEvent');
      }))(contexto, refDoEvento(acao), new Date(anterior.startsAt), new Date(anterior.endsAt));
    } else if (inversa) {
      await aplicar({ ...acao, kind: inversa }, contexto, conector);
    } else {
      throw new Error('Esta ação não tem inversa definida');
    }

    await prisma.actionRequest.update({
      where: { id: acao.id },
      data: { status: 'UNDONE', undoneAt: new Date() },
    });
    return { ok: true, actionId: acao.id };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await prisma.actionRequest.update({ where: { id: acao.id }, data: { error: mensagem } });
    return { ok: false, actionId: acao.id, error: mensagem };
  }
}

/** Cancela uma acao pendente. Nunca tocou na caixa. */
export async function cancelAction(actionId: string, userId: string): Promise<void> {
  await prisma.actionRequest.updateMany({
    where: { id: actionId, userId, status: { in: ['PENDING', 'CONFIRMED', 'FAILED'] } },
    data: { status: 'CANCELLED' },
  });
}
