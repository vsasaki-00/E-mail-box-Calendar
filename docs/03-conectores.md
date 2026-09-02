# 03 — Conectores

Contrato em `src/lib/connectors/types.ts`. Cada conector implementa a mesma
interface e **declara suas capacidades**; o núcleo nunca ramifica por provedor.

## Matriz de capacidades

| | Google | Microsoft | Apple (iCloud) | IMAP/CalDAV genérico |
|---|---|---|---|---|
| Autenticação | OAuth2 + PKCE | OAuth2 + PKCE (MSAL) | senha de app | senha ou OAuth do provedor |
| E-mail | Gmail API | Graph `/messages` | IMAP | IMAP |
| Calendário | Calendar API | Graph `/events` | CalDAV | CalDAV |
| Sync incremental | `historyId` | `deltaLink` | `ctag`/`ETag` | `ctag` / `MODSEQ` |
| Push nativo | `watch` + Pub/Sub | subscriptions | não | IMAP IDLE (parcial) |
| Busca no servidor | sim | sim | limitada | limitada |
| Estratégia do agendador | push + incremental 5 min | push + incremental 5 min | polling 10 min | polling 15 min |

## Google

**Escopos mínimos** (princípio do menor privilégio, fase 1 é leitura):
```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/userinfo.email
```
Fase 4 (escrita) troca para `gmail.modify` e `calendar.events`.

**Sync de e-mail**: `users.messages.list` paginado no full sync; depois
`users.history.list` a partir do `historyId`. O `historyId` expira se ficar
parado tempo demais → `CURSOR_EXPIRED` → full sync.

**Sync de calendário**: `events.list` com `singleEvents=true` (instâncias já
expandidas) e `syncToken` para incremental. Um `410 Gone` significa token
inválido → full sync.

**Cuidado com quota**: Gmail API custa por unidade, não por chamada.
`messages.get` com `format=metadata` é muito mais barato que `format=full` —
por isso o corpo é sob demanda.

## Microsoft ✅ implementado (fase 2)

**Escopos**: `Mail.Read`, `Calendars.Read`, `User.Read`, `offline_access`.
Endpoint comum (`/common`) para aceitar contas pessoais (Hotmail/Outlook.com/
Live) e corporativas/escolares (Azure AD) com o mesmo fluxo — não há
distinção de código entre as duas.

**Sync de e-mail**: por pasta, com `/me/mailFolders/{id}/messages/delta`. O
Graph não tem um endpoint de lista única "todas as pastas" equivalente ao
`messages.list` do Gmail (que, na prática, cobre a caixa inteira menos Lixeira
e Spam em uma chamada só) — cada pasta é seu próprio recurso, com seu próprio
`deltaLink`. O conector sincroniza por padrão `Inbox`, `SentItems`, `Drafts` e
`Archive` (quando existe), usando o mesmo padrão "um token por container" já
usado no calendário — ver `src/lib/connectors/container-cursor.ts`.

As pastas padrão são resolvidas pelo **alias bem-conhecido**
(`/me/mailFolders/inbox`, `/me/mailFolders/sentitems`...), nunca pelo
`displayName`: o nome de exibição é localizado ("Caixa de Entrada" em
pt-BR, "Posteingang" em de-DE) e casar por texto quebraria em qualquer
idioma diferente do inglês.

**Sync de calendário**: `/me/calendars/{id}/calendarView/delta`, que devolve
instâncias já expandidas dentro de uma janela — equivalente ao
`singleEvents=true` do Google Calendar. O `deltaLink` volta no fim da última
página (`@odata.deltaLink`); páginas intermediárias trazem `@odata.nextLink`,
uma URL completa que o conector segue verbatim.

**Cuidado com fuso horário**: por padrão, o Graph devolve `start.dateTime` e
`end.dateTime` como horário **local no fuso indicado em `timeZone`**, sem
sufixo `Z` — não é UTC. O conector envia o header `Prefer:
outlook.timezone="UTC"` em toda chamada de calendário, o que faz o Graph
normalizar essas datas para UTC (ainda sem o sufixo `Z`, então o parser
força a interpretação como UTC explicitamente). Sem isso, seria necessário
mapear nomes de fuso horário do Windows ("Pacific Standard Time") para IANA
— uma fonte clássica de bug de horário errado.

**Resposta do usuário ao convite**: o Graph já resolve `event.responseStatus`
como a resposta do usuário logado diretamente — diferente do Google, que
exige procurar "self" na lista de participantes.

**Sem revogação programática de token**: ao contrário do Google (`/revoke`),
o Microsoft Identity Platform não tem um endpoint público equivalente.
Desconectar uma conta Microsoft apaga o token localmente; revogar de fato
exige o usuário remover o acesso em `myaccount.microsoft.com/consent`.

**Cuidado**: o Graph aplica throttling agressivo com `429 + Retry-After`.
O cliente HTTP do conector respeita `Retry-After` com backoff exponencial —
ignorar isso derruba a conexão inteira por horas.

## Apple iCloud e IMAP/CalDAV genérico ✅ implementado (fase 2)

Não há OAuth público para iCloud Mail/Calendar, e a maioria dos provedores
genéricos (Fastmail, Zoho, domínio corporativo, servidor próprio) também não
oferece. O caminho é:

- **Senha específica de app** — no iCloud, gerada em appleid.apple.com
  (exige 2FA ativo); nunca a senha principal da conta.
- **E-mail**: IMAP (RFC 3501), via [`imapflow`](https://imapflow.com).
- **Calendário**: CalDAV (RFC 4791 + `sync-collection` do RFC 6578), via
  [`tsdav`](https://github.com/natelindev/tsdav) para o protocolo WebDAV e
  [`ical.js`](https://github.com/kewisch/ical.js) para parsing de ICS e
  expansão de recorrência.

Do ponto de vista do núcleo, iCloud é apenas o conector IMAP/CalDAV genérico
com defaults pré-preenchidos (`APPLE_PRESET` em `imap-caldav.ts`) — mesma
implementação, configuração diferente. **Autodiscovery** por convenção
(`imap.<domínio>`, `https://<domínio>/.well-known/caldav`) roda antes de
pedir host/porta manualmente ao usuário — `guessConfigForDomain()`.

**Sem OAuth, sem redirect**: a conexão é criada por um formulário
(`/conexoes` → "Conectar Apple iCloud / IMAP+CalDAV") que testa a conta ao
vivo (`POST /api/connections/imap`) antes de gravar qualquer coisa — as duas
pernas (IMAP e CalDAV) precisam responder.

### E-mail: por que so a caixa de entrada por padrão

Diferente do Gmail (uma consulta cobre a caixa inteira) e do Graph (delta por
pasta, mas com nomes de pasta bem-conhecidos e estáveis por locale), IMAP não
tem um conceito de "todas as pastas" nem um catálogo universal de nomes
especiais confiável em todo servidor. Por isso o conector sincroniza só
`INBOX` por padrão. `imapflow` já resolve o papel especial de cada pasta —
inclusive por nome localizado (`specialUseSource: 'name'`) quando o servidor
não anuncia a extensão `SPECIAL-USE` — mas a seleção de quais pastas extras
entram no sync ainda depende de uma UI que não existe (mesmo gap documentado
no roadmap para o Microsoft).

**Incremental**: `CONDSTORE` (`changedSince` por MODSEQ) quando o servidor
suporta — pega mensagem nova e mudança de flag numa consulta só, igual em
espírito ao `historyId`/`deltaLink`. Sem CONDSTORE, cai para "UID maior que o
último visto" (não detecta flag mudada nem exclusão em mensagem antiga —
limitação aceita, documentada aqui em vez de escondida). `UIDVALIDITY`
diferente do armazenado é cursor expirado: o servidor reindexou a pasta.

### Calendário: expansão de recorrência

`fetchCalendarObjects` do tsdav pede expansão no servidor
(`expand: true`, suportado pelo iCloud); quando o servidor recusa o filtro,
o conector cai para expansão local via `ical.js` (`ical-normalize.ts`).
Escopo assumido: RRULE + EXDATE + substituição de ocorrência via
RECURRENCE-ID (o caso comum — "arrastei uma reunião de segunda para terça").
`RANGE=THISANDFUTURE` (editar uma ocorrência em diante) não é tratado.

**Incremental**: REPORT `sync-collection` (RFC 6578) chamado diretamente
via `client.syncCollection` do tsdav, não via `smartCollectionSyncDetailed`
— cujo caminho "básico" (ctag, para servidor sem `sync-collection`) exige
anexar funções como propriedade no objeto do calendário, um modelo com
estado que não combina com este conector: aqui tudo é reconstruído do cursor
persistido a cada execução. `410 Gone` é cursor expirado, por RFC.

### O que este conector NÃO pôde ser verificado contra um servidor real

A rede deste ambiente de desenvolvimento bloqueia conexão TCP bruta em
qualquer porta (inclusive 993) e libera HTTPS só para um allowlist restrito
(Google, Microsoft, registries de pacote) — `caldav.icloud.com` e qualquer
outro host CalDAV/IMAP genérico ficam de fora. Diferente do Google e do
Microsoft (cujo OAuth foi validado contra os servidores reais na mesma
sessão), **este conector não pôde completar um login real contra iCloud,
Fastmail ou qualquer outro servidor** aqui.

O que foi verificado nesta sessão, honestamente:
- `POST /api/connections/imap` contra um domínio inexistente devolveu
  `ENOTFOUND` mapeado corretamente para `PERMANENT` (HTTP 400).
- Contra um host real mas inalcançável pela rede deste ambiente
  (`imap.gmail.com:993`, TCP bloqueado), o `connectionTimeout` de 90s do
  imapflow disparou de verdade e foi mapeado para `TRANSIENT` (HTTP 502) —
  sem travar o processo, que continuou respondendo a outras requisições
  durante os 90s de espera.
- Toda a lógica pura (parsing de ICS, expansão de RRULE com `ical.js` real —
  não mockado —, EXDATE, substituição via RECURRENCE-ID, tradução de flag
  IMAP, codec de cursor) tem 130 testes automatizados passando.
- Os contratos de API do `imapflow` e do `tsdav` foram lidos diretamente do
  código-fonte instalado (`node_modules/imapflow/lib/imap-flow.d.ts`,
  `node_modules/tsdav/dist/**`), não de memória — as docs online dessas
  bibliotecas também estão fora do allowlist de rede.

Isso significa que um erro de integração real (um campo de resposta do
servidor com formato inesperado, um comportamento de servidor que diverge da
RFC) só vai aparecer no primeiro uso real, com uma conta de verdade. Vale
testar com uma conta descartável antes de confiar o sync de uma caixa
principal a este conector.

## Tratamento de erro padronizado

Todo conector traduz falhas para um conjunto fechado de erros, para o núcleo
saber reagir sem entender o provedor:

| Erro | Reação do motor |
|---|---|
| `AUTH_EXPIRED` | tenta refresh; se falhar → `REAUTH_REQUIRED` + alerta |
| `CURSOR_EXPIRED` | descarta cursor, agenda full sync do recurso |
| `RATE_LIMITED` | respeita `Retry-After`, backoff exponencial, marca `DEGRADED` |
| `NOT_FOUND` | item some do cache, sem erro |
| `TRANSIENT` | retry com backoff, até N vezes |
| `PERMANENT` | marca `ERROR`, gera alerta, para o recurso |

## A janela do calendário vive dentro do cursor

O detalhe menos óbvio de todo o sync, e o que fez a agenda ficar vazia em
produção mesmo depois de a configuração ser corrigida.

A janela (`SYNC_CALENDAR_PAST_MONTHS` / `SYNC_CALENDAR_FUTURE_MONTHS`) **não
é reenviada a cada sincronização**. Ela é gravada no token de incremental
pelo próprio provedor:

- **Google**: a API rejeita `timeMin`/`timeMax` junto com `syncToken`. A
  janela é a do primeiro `list`, e vale para todos os incrementais seguintes.
- **Microsoft**: o `@odata.deltaLink` volta com `startDateTime`/`endDateTime`
  embutidos e é seguido verbatim.
- **CalDAV**: a janela viaja em cada requisição, mas o `sync-token` só
  reporta o que **mudou** — um evento que passou a caber na janela nova, sem
  ter sido editado, nunca chegaria.

Consequência: enquanto existir cursor, mudar a configuração não muda nada. E
mesmo com tudo certo a janela envelhece, porque é ancorada em "hoje" — um
cursor criado hoje enxerga até daqui a 12 meses e nunca mais avança, então o
horizonte encolhe um dia por dia, em silêncio.

A solução está em `src/lib/connectors/janela-calendario.ts`: uma assinatura
(`p{passado}f{futuro}@{AAAA-MM}`) viaja junto com o cursor, na chave
reservada `__janela`. Quando ela não bate com a atual, os tokens são
descartados e a busca é refeita na janela nova. A âncora é o **mês**, não o
instante — dois syncs no mesmo mês precisam concordar, senão todo sync
viraria full sync. Na prática: um full sync de agenda por mês, o que é
barato (poucos eventos, `upsert` idempotente) e mantém o horizonte rolando.

Cursores gravados antes desta mudança não têm assinatura nenhuma, e por isso
refazem a busca sozinhos na primeira sincronização — que é exatamente o
reparo de que precisavam.

A tela `/agenda` mostra o período em vigor e marca a conta que ainda está com
`período antigo no cursor`.
