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

## Microsoft

**Escopos**: `Mail.Read`, `Calendars.Read`, `User.Read`, `offline_access`.
Endpoint comum (`/common`) para aceitar contas pessoais e corporativas.

**Sync**: `/me/messages/delta` e `/me/calendarView/delta`. O `deltaLink` volta
no fim de cada página final. `calendarView` (e não `/events`) é o endpoint que
expande recorrências dentro de uma janela.

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
