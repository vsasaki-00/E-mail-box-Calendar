# 01 — Arquitetura

## Visão em blocos

```
┌──────────────────────────────────────────────────────────────────────┐
│  UI  (Next.js App Router, React Server Components)                   │
│  Torre de Controle · Inbox Unificada · Agenda Unificada · Conexões   │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ chamadas diretas (RSC) + rotas /api
┌────────────────────────────▼─────────────────────────────────────────┐
│  NÚCLEO (src/core)                                                   │
│  Modelo canônico · deduplicação · motor de regras · métricas          │
│  Não conhece nenhum provedor. Só fala UnifiedMessage / UnifiedEvent. │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ interface Connector
┌────────────────────────────▼─────────────────────────────────────────┐
│  CONECTORES (src/lib/connectors)                                     │
│  google (Gmail+Calendar) · microsoft (Graph) · caldav/imap (Apple e  │
│  genérico)                                                            │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        ▼                                         ▼
┌───────────────────┐                   ┌────────────────────┐
│ Postgres (Prisma) │                   │ Worker de sync      │
│ cache materializado│◄─────────────────│ incremental + full  │
└───────────────────┘                   └────────────────────┘
```

## Decisões de arquitetura (ADRs resumidos)

### ADR-1 — Cache materializado local, não proxy ao vivo

Consultar as 6 APIs a cada page load é lento, estoura quota e impede busca
unificada e ordenação global. Sincronizamos para o Postgres e servimos tudo
de lá. O preço é a *janela de defasagem*, mitigada por sync incremental
frequente e por webhooks/push onde o provedor oferece.

### ADR-2 — Interface `Connector` única, capacidades declaradas

Nem todo provedor faz tudo. Um servidor CalDAV puro não tem e-mail; um IMAP
puro não tem calendário; só Google e Microsoft têm push nativo bom. Em vez de
`if (provider === 'google')` espalhado pelo código, cada conector **declara
suas capacidades** e o núcleo consulta essa declaração:

```ts
capabilities: {
  mail: true, calendar: true, contacts: true,
  incrementalSync: 'history-api',   // 'history-api' | 'delta-token' | 'sync-token' | 'etag-poll'
  push: true,                        // webhook/subscription nativo
  serverSideSearch: true,
}
```

Isso é o que permite adicionar IMAP/CalDAV genérico sem poluir o núcleo: ele
simplesmente declara `incrementalSync: 'etag-poll'` e `push: false`, e o
agendador usa polling mais frequente para ele.

### ADR-3 — Sync em duas velocidades

- **Full sync** (na conexão inicial e sob demanda): varre uma janela histórica
  configurável (padrão: 90 dias de e-mail, −1/+12 meses de calendário).
  Paginado, retomável, com checkpoint a cada página.
- **Sync incremental** (contínuo): usa o mecanismo nativo de cada provedor
  (Gmail `historyId`, Graph `deltaLink`, Google Calendar `syncToken`,
  CalDAV `ctag`/`ETag`, IMAP `UIDVALIDITY`/`MODSEQ`).

Cursores ficam em `SyncState`, um por (conexão, recurso). Se um cursor expira
— acontece: o Gmail invalida `historyId` antigo, o Graph expira `deltaLink` —
o conector sinaliza `CURSOR_EXPIRED` e o motor cai automaticamente para full
sync daquele recurso, sem intervenção.

### ADR-4 — Deduplicação por identidade de mensagem, não por conteúdo

O mesmo e-mail chega em 3 caixas. A chave canônica é, em ordem de preferência:
1. cabeçalho `Message-ID` (RFC 5322) — presente em quase tudo;
2. para eventos: `iCalUID` (RFC 5545), estável entre provedores;
3. fallback: hash de `(remetente normalizado, assunto normalizado, data ±60s)`.

Guardamos **todas as cópias** (`Message` por conexão) e um agrupador
(`UnifiedItem`) que aponta para elas. Nunca jogamos fora uma cópia: arquivar
"o e-mail" precisa saber em quais caixas ele fisicamente existe.

### ADR-5 — Segredos fora do banco

Ver `04-seguranca.md`. Resumo: envelope encryption AES-256-GCM, chave mestra em
variável de ambiente / KMS, nunca no Postgres. Um dump do banco não vaza acesso
às caixas.

### ADR-6 — Worker no mesmo repositório, processo separado

`pnpm dev` sobe a UI; `pnpm worker` sobe o loop de sync. Mesmo código, mesmo
Prisma client, processos independentes — a UI nunca trava por causa de um sync
lento, e o worker pode escalar/reiniciar sozinho. Fase 1 usa um scheduler
simples em processo; quando houver volume, troca-se por BullMQ + Redis sem
mexer no núcleo (a interface `enqueue`/`runJob` já está isolada).

## Fluxo: adicionar uma conta

```
Usuário → /conexoes → escolhe provedor
   ├─ Google/Microsoft: OAuth2 + PKCE → callback → tokens cifrados → Connection
   └─ Apple/IMAP-CalDAV: formulário (host, porta, usuário, senha de app)
                          → teste de conexão ao vivo → credenciais cifradas
   ↓
enfileira FULL_SYNC (mail + calendar conforme capacidades)
   ↓
worker: descobre pastas/calendários → pagina itens → normaliza → grava
   ↓
motor de deduplicação agrupa em UnifiedItem
   ↓
Torre de Controle passa a contar essa conexão nas métricas
```

## Estrutura de pastas

```
src/
  app/                     UI (App Router) + rotas /api
  core/
    unified/               modelo canônico e normalizadores
    sync/                  motor de sync, cursores, deduplicação
    rules/                 motor de regras
    metrics/               agregações da Torre de Controle
  lib/
    connectors/            um arquivo por provedor + registry
    crypto.ts              envelope encryption
    db.ts                  Prisma client singleton
  worker/                  processo de sync
prisma/schema.prisma       modelo de dados
docs/                      esta documentação
```
