# Torre de Comando

Gestão unificada de **todas** as caixas de e-mail e **todos** os calendários —
Google, Microsoft, Apple iCloud e qualquer provedor IMAP/CalDAV — em um único
plano de controle.

Não substitui o Gmail nem o Outlook. **Agrega, normaliza e comanda.**

---

## O que existe hoje (Fase 0)

| | Estado |
|---|---|
| Documentação de arquitetura, dados, segurança, conectores, roadmap | ✅ `docs/` |
| Modelo de dados completo (Prisma + Postgres) | ✅ `prisma/schema.prisma` |
| Criptografia de segredos (AES-256-GCM + rotação de chave) | ✅ `src/lib/crypto.ts` |
| Contrato `Connector` com matriz de capacidades | ✅ `src/lib/connectors/types.ts` |
| Deduplicação entre contas (Message-ID / iCalUID) | ✅ `src/core/unified/dedupe.ts` |
| Detecção de conflitos e janelas de foco | ✅ `src/core/metrics/conflicts.ts` |
| Política de retentativa e backoff do sync | ✅ `src/core/sync/backoff.ts` |
| Motor de sync e worker | ✅ estrutura pronta, aguardando os conectores |
| Torre de Controle renderizando | ✅ `src/app/page.tsx` |
| **Sync real com Google / Microsoft / IMAP** | ⛔ Fases 1–2 |
| **Fluxo OAuth ponta a ponta** | ⛔ URLs e PKCE prontos; callback e troca de token na fase 1 |
| **Ações de escrita** (arquivar, responder, criar evento) | ⛔ Fase 4, com consentimento novo |

Os conectores declaram capacidades reais e traduzem erros de verdade, mas os
métodos de busca **falham de forma explícita** em vez de devolver listas vazias
— ausência de implementação não deve se disfarçar de "caixa sem mensagens".

Roadmap completo por fases: [`docs/06-roadmap.md`](docs/06-roadmap.md).

---

## Rodando localmente

Pré-requisitos: Node ≥ 20, pnpm, Docker (ou um Postgres 16 já disponível).

```bash
pnpm install

cp .env.example .env
openssl rand -base64 32          # cole em MASTER_ENCRYPTION_KEY no .env

pnpm db:up                       # sobe o Postgres via docker compose
pnpm db:push                     # aplica o schema
pnpm db:seed                     # popula dados de demonstração

pnpm dev                         # http://localhost:3000
```

Sem Docker, aponte `DATABASE_URL` para um Postgres 16 próprio e pule `pnpm db:up`.

O seed monta de propósito o cenário que justifica o produto: o mesmo convite
chegando em duas contas (que deve virar **uma** linha, não um conflito) e uma
reunião do Microsoft sobrepondo uma consulta do Google (que **deve** aparecer
como conflito), além de uma conta atrasada e uma precisando reautenticar.

### Outros comandos

```bash
pnpm test        # 67 testes de núcleo, sem banco
pnpm typecheck   # tsc --noEmit
pnpm build       # build de produção
pnpm worker      # processo de sincronização (separado da UI)
pnpm db:studio   # inspecionar o banco
```

---

## Estrutura

```
docs/                    arquitetura, modelo de dados, segurança, roadmap
prisma/
  schema.prisma          modelo de dados
  seed.ts                cenário de demonstração
src/
  app/                   UI (Next.js App Router) — Torre de Controle
  core/
    unified/dedupe.ts    agrupamento do mesmo item entre contas
    metrics/             conflitos, janelas de foco, agregações do painel
    sync/                motor de sincronização, backoff, cursores
  lib/
    connectors/          um arquivo por provedor + registry
    crypto.ts            criptografia de segredos
    db.ts                Prisma client
  worker/                processo de sync
```

## Como o sistema é organizado

O **núcleo nunca ramifica por provedor**. Cada conector declara o que sabe fazer
(`incrementalSync`, `push`, `serverSideSearch`, `write`, intervalo de polling) e
o motor decide a estratégia a partir dessa declaração. É isso que permite somar
um provedor IMAP genérico sem espalhar `if (provider === ...)` pelo código.

Detalhes e as decisões de arquitetura (ADRs) em
[`docs/01-arquitetura.md`](docs/01-arquitetura.md).

## Segurança

Este app concentra acesso a todas as suas caixas. Tokens e senhas de app são
cifrados com AES-256-GCM usando chave mestra que **não vive no banco** — um dump
do Postgres não dá acesso a nenhuma conta. A fase 1 pede **apenas escopos de
leitura**. Detalhes, modelo de ameaças e regras de log em
[`docs/04-seguranca.md`](docs/04-seguranca.md).

Nunca comite o `.env`.
