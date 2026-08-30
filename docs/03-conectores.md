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

## Apple iCloud

Não há OAuth público para iCloud Mail/Calendar. O caminho suportado é:

- **Senha específica de app** gerada em appleid.apple.com (exige 2FA ativo).
- **E-mail**: IMAP em `imap.mail.me.com:993` (TLS).
- **Calendário**: CalDAV em `caldav.icloud.com`, com descoberta via
  `PROPFIND` → `calendar-home-set` → lista de calendários.

Do ponto de vista do núcleo, iCloud é apenas uma configuração pré-preenchida do
conector IMAP/CalDAV genérico — mesma implementação, defaults diferentes.

## IMAP/CalDAV genérico

Cobre Fastmail, Zoho, domínios corporativos, servidores próprios. Precisa de
host/porta/usuário/senha para cada protocolo. Faz **autodiscovery** por
convenção (`imap.<domínio>`, registro SRV `_caldavs._tcp`, `/.well-known/caldav`)
e cai para entrada manual.

Sem push confiável: o agendador usa polling e, quando o servidor anuncia
`IDLE`, mantém uma conexão ociosa para reduzir latência.

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
