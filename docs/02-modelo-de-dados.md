# 02 — Modelo de Dados

Fonte da verdade do schema: `prisma/schema.prisma`. Este documento explica o
*porquê* de cada entidade.

## Entidades

### `User`
Dono das conexões. Single-user na fase 1, mas modelado desde já para múltiplos
usuários — adicionar `userId` depois exigiria migração em todas as tabelas.

### `Connection`
**A entidade central.** Uma conta conectada = uma caixa de e-mail e/ou um
conjunto de calendários de um provedor.

Campos que importam:
- `provider`: `GOOGLE | MICROSOFT | APPLE | IMAP_CALDAV`
- `capabilities` (JSON): o que essa conexão sabe fazer, preenchido pelo conector
- `secretCiphertext` / `secretIv` / `secretTag` / `secretKeyId`: credenciais cifradas
- `status`: `ACTIVE | DEGRADED | REAUTH_REQUIRED | DISABLED | ERROR`
- `lastSyncAt`, `lastErrorAt`, `lastErrorMessage`: alimentam a Torre de Controle

`status` é o que faz a degradação por conexão funcionar: a UI lê esse campo e
mostra o card vermelho sem quebrar o resto.

### `Mailbox` e `CalendarSource`
Pastas/labels e calendários **dentro** de uma conexão. Uma conta Google tem
`INBOX`, labels próprios e N calendários (o principal, os compartilhados, os
assinados). O usuário escolhe quais entram na visão unificada
(`includeInUnified`) — ninguém quer o calendário "Feriados do Brasil" competindo
com reuniões na tela de comando.

### `Message`
Uma cópia física de um e-mail, em uma conexão. Guarda os cabeçalhos
normalizados, o snippet, flags (`isRead`, `isFlagged`), e `providerId` +
`providerThreadId` para poder agir de volta no provedor.

Corpo completo (`bodyHtml`/`bodyText`) é **opcional e carregado sob demanda** —
sincronizar o corpo de 90 dias de 6 caixas é caro em banco e em quota. A lista
precisa só dos metadados.

### `CalendarEvent`
Um evento em um calendário de uma conexão. Guarda `iCalUid` (chave de dedupe
entre provedores), janela `startsAt`/`endsAt`, `isAllDay`, `timezone`,
`status` (confirmado/tentativo/cancelado), `responseStatus` do usuário, e
participantes em JSON.

Recorrência na fase 1 é armazenada **expandida** dentro da janela sincronizada
(cada ocorrência é uma linha, com `recurringEventId` apontando para a série).
Motivo: expandir RRULE corretamente com exceções, DST e fusos é uma fonte
inesgotável de bugs, e os provedores já fazem isso — Google e Graph entregam
instâncias expandidas. Para CalDAV usamos uma biblioteca de expansão.

### `UnifiedItem`
O agrupador da deduplicação. Um `UnifiedItem` do tipo `MESSAGE` ou `EVENT`
aponta para 1..N cópias. `dedupeKey` é a chave descrita no ADR-4, com índice
único por usuário. É esta tabela que a Inbox e a Agenda unificadas leem.

### `SyncState`
Cursor por (conexão, recurso). Guarda `cursor` (historyId/deltaLink/syncToken/
ctag), `lastFullSyncAt`, `status` e contadores. É o que permite retomar um sync
interrompido e detectar cursor expirado.

### `SyncRun`
Histórico de execuções: início, fim, itens processados, erro. Alimenta o painel
de saúde e permite responder "por que a agenda está desatualizada?".

### `Rule`
Automação: `condition` (JSON) + `action` (JSON) + `enabled` + `scope`.
Avaliada pelo núcleo sobre `UnifiedItem`, nunca sobre o formato do provedor.

### `Alert`
O que a Torre de Controle precisa gritar: conflito de agenda, conexão caída,
token para expirar, e-mail sem resposta além do SLA. Tem `severity`,
`acknowledgedAt` e `dedupeKey` para não repetir o mesmo alerta a cada ciclo.

## Regras de integridade que valem citar

- **`Message` e `CalendarEvent` são deletados em cascata com a `Connection`.**
  Desconectar uma conta remove o cache dela — o provedor continua sendo a fonte
  da verdade, nada se perde de verdade.
- **`UnifiedItem` sobrevive** à remoção de uma cópia se ainda houver outra.
- **Índices obrigatórios**: `(connectionId, providerId)` único em `Message` e
  `CalendarEvent`; `(userId, dedupeKey)` único em `UnifiedItem`;
  `(userId, startsAt)` em `CalendarEvent` para a agenda do dia;
  `(userId, receivedAt DESC)` para a inbox unificada.
