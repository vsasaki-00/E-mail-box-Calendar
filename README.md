# Torre de Comando

Gestão unificada de **todas** as caixas de e-mail e **todos** os calendários —
Google, Microsoft, Apple iCloud e qualquer provedor IMAP/CalDAV — em um único
plano de controle.

Não substitui o Gmail nem o Outlook. **Agrega, normaliza e comanda.**

---

## O que existe hoje (Fase 2 — conectores completos)

| | Estado |
|---|---|
| Documentação de arquitetura, dados, segurança, conectores, roadmap | ✅ `docs/` |
| Modelo de dados completo (Prisma + Postgres) | ✅ `prisma/schema.prisma` |
| Criptografia de segredos (AES-256-GCM + rotação de chave) | ✅ `src/lib/crypto.ts` |
| Contrato `Connector` com matriz de capacidades | ✅ `src/lib/connectors/types.ts` |
| Deduplicação entre contas (Message-ID / iCalUID) | ✅ `src/core/unified/dedupe.ts` |
| Detecção de conflitos e janelas de foco | ✅ `src/core/metrics/conflicts.ts` |
| Política de retentativa e backoff do sync | ✅ `src/core/sync/backoff.ts` |
| Torre de Controle renderizando | ✅ `src/app/page.tsx` |
| **OAuth do Google ponta a ponta** (PKCE, state com TTL, refresh, revogação) | ✅ `src/app/api/auth/google/` |
| **Sync real do Gmail** (full + incremental por `historyId`) | ✅ `src/lib/connectors/google.ts` |
| **Sync real do Google Calendar** (full + `syncToken` por calendário) | ✅ `src/lib/connectors/google.ts` |
| **OAuth do Microsoft ponta a ponta** (aceita conta pessoal Hotmail/Outlook.com e corporativa) | ✅ `src/app/api/auth/microsoft/` |
| **Sync real do Outlook Mail** (por pasta, `messages/delta`) | ✅ `src/lib/connectors/microsoft.ts` |
| **Sync real do Outlook Calendar** (`calendarView/delta`, fuso normalizado p/ UTC) | ✅ `src/lib/connectors/microsoft.ts` |
| Persistência idempotente + reconciliação de itens unificados | ✅ `src/core/sync/persist.ts` |
| Página de conexões (conectar, sincronizar, desconectar) | ✅ `src/app/conexoes/` |
| **Sync real com Apple iCloud / IMAP genérico** | 🔶 implementado, mas não validado contra servidor real (ver `docs/03-conectores.md`) |
| **Triagem por IA** (prioridade, cobrança, precisa-resposta) | 🔶 lógica completa e testada; chamada real ao modelo não exercitada (sem API key no ambiente) |
| **Perfis das caixas** (negócio, papel, objetivo, calibragem, VIPs) | ✅ `src/app/perfis/` |
| **Tela de triagem com correção** (alimenta o aprendizado) | ✅ `src/app/triagem/` |
| **Perfil de voz por caixa** (derivado da pasta Enviados, processado localmente) | ✅ `src/core/voice/` + `src/app/voz/` |
| **Painel financeiro** (boleto e PIX lidos localmente, com dígito verificador) | ✅ `src/core/finance/` + `src/app/financeiro/` |
| **Boleto em PDF anexo** (Google e Microsoft; IMAP declara que não sabe) | ✅ `src/core/finance/pdf.ts` |
| **Rascunhos de resposta** (com o seu perfil de voz; **nunca envia**) | ✅ `src/core/draft/` + `src/app/rascunhos/` |
| **Automação pós-sync** (triagem + cobranças sozinhas, com teto de gasto diário) | ✅ `src/core/pipeline/` + `src/worker/` |
| **SLA de resposta por caixa** (prazo por negócio, urgente encurta) | ✅ `src/core/metrics/sla.ts` |
| **Alertas com dedupe, resolução automática e reconhecimento** | ✅ `src/core/alerts/` |
| **Agenda unificada** (semana e mês, cópias colapsadas, conflitos entre contas) | ✅ `src/core/agenda/` + `src/app/agenda/` |
| **Datas no seu fuso, não no do servidor** | ✅ `src/core/time/zone.ts` |
| **Busca unificada** (todas as caixas e calendários) | ✅ `src/core/search/` + `src/app/busca/` |
| **Ações de escrita** (arquivar, marcar lido, rotular, RSVP, criar/mover evento, enviar) | ✅ `src/core/actions/` + `src/app/acoes/` — consentimento por caixa |
| **Fila de ações + log de auditoria + desfazer** | ✅ `src/app/acoes/` |

Os quatro conectores estão implementados. Google e Microsoft tiveram o fluxo
OAuth validado contra os servidores reais de cada provedor. O conector
IMAP/CalDAV (Apple iCloud e genérico) **não pôde ser validado contra um
servidor real** — a rede do ambiente de desenvolvimento bloqueia IMAP e hosts
CalDAV; veja a ressalva honesta em `docs/03-conectores.md` antes de confiar
uma caixa principal a ele.

Para conectar uma conta Google ou Microsoft de verdade, falta apenas criar as
credenciais no [Google Cloud Console](https://console.cloud.google.com) e/ou
no [Microsoft Entra](https://entra.microsoft.com) e colocá-las no `.env` —
veja abaixo. O IMAP/CalDAV não precisa de credencial de app nenhuma, só da
senha de app da própria conta.

Roadmap completo por fases: [`docs/06-roadmap.md`](docs/06-roadmap.md).
Reflexão sobre a fase de IA (triagem, painel financeiro, resposta assistida):
[`docs/07-agente-de-triagem.md`](docs/07-agente-de-triagem.md).

---

## Rodando localmente

Pré-requisito no Mac: **Node 20+** (`brew install node`) e o Docker Desktop
aberto (ou um Postgres 16 já rodando). O `pnpm` o script instala sozinho.

Sem o Homebrew? Instale-o primeiro — e rode as duas linhas `echo ... >>
~/.zprofile` que ele imprime no final, senão o `brew` some ao fechar o
Terminal:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

```bash
git clone https://github.com/vsasaki-00/E-mail-box-Calendar
cd E-mail-box-Calendar
git checkout claude/email-calendar-manager-zsf592

bash scripts/setup.sh            # confere tudo, gera a chave, sobe o banco
pnpm dev                         # http://localhost:3000
```

O ponto de entrada é `bash`, e não `pnpm`, de propósito: exigir o `pnpm`
para rodar o script que instala o `pnpm` seria um círculo. Se você já tem
tudo instalado, `pnpm setup` faz o mesmo.

O script faz o resto: confere o Node, **instala o pnpm sozinho** pelo
`corepack` (que vem com o Node) se ele faltar, cria o `.env` com uma chave
mestra nova, sobe o Postgres (via Docker, ou usa um que já esteja no ar),
aplica o esquema e popula os dados de demonstração.

É **idempotente**: rodar de novo não quebra nada. E ele **nunca sobrescreve
um `.env` existente** — trocar a `MASTER_ENCRYPTION_KEY` tornaria ilegíveis
as credenciais já guardadas das suas caixas.

**Sem Docker também funciona**, e é mais leve:

```bash
brew install postgresql@16
brew services start postgresql@16
bash scripts/setup.sh
```

O script cria sozinho o papel e o banco que o app espera — o mesmo que o
`docker-compose` já criaria.

Para pular os dados de demonstração: `SEED=0 bash scripts/setup.sh`.

<details>
<summary>Passo a passo manual, se preferir</summary>

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
</details>

O seed monta de propósito o cenário que justifica o produto: o mesmo convite
chegando em duas contas (que deve virar **uma** linha, não um conflito) e uma
reunião do Microsoft sobrepondo uma consulta do Google (que **deve** aparecer
como conflito), além de uma conta atrasada e uma precisando reautenticar.

### Conectando uma conta Google de verdade

1. No [Google Cloud Console](https://console.cloud.google.com), crie um
   projeto, ative a **Gmail API** e a **Google Calendar API**, e crie uma
   credencial OAuth 2.0 do tipo *Web application*.
2. Em **Authorized redirect URIs**, adicione
   `http://localhost:3000/api/auth/google/callback`.
3. Enquanto o app estiver em modo de teste (*Testing*), adicione seu e-mail
   como usuário de teste na tela de consentimento — sem isso o Google recusa
   o login.
4. Cole `Client ID` e `Client Secret` em `GOOGLE_CLIENT_ID` e
   `GOOGLE_CLIENT_SECRET` no `.env`.
5. Rode `pnpm dev`, abra `http://localhost:3000/conexoes` e clique em
   **Conectar conta Google**.

O primeiro sync roda na hora (a página chama `/api/connections/:id/sync`);
os seguintes rodam pelo worker (`pnpm worker`), a cada
`SYNC_INTERVAL_SECONDS`.

### Conectando uma conta Microsoft de verdade (Hotmail, Outlook.com ou corporativa)

1. No [Microsoft Entra admin center](https://entra.microsoft.com), vá em
   **App registrations** → **New registration**.
2. Em **Supported account types**, escolha *Accounts in any organizational
   directory and personal Microsoft accounts* — é isso que faz a mesma
   conexão aceitar tanto Hotmail/Outlook.com pessoal quanto conta
   corporativa/escolar.
3. Em **Redirect URI**, adicione (tipo *Web*)
   `http://localhost:3000/api/auth/microsoft/callback`.
4. Em **Certificates & secrets**, crie um *Client secret* e copie o valor na
   hora — ele só aparece uma vez.
5. Em **API permissions**, adicione `Mail.Read`, `Calendars.Read`,
   `User.Read` e `offline_access` (delegadas, tipo Microsoft Graph).
6. Cole o `Application (client) ID` e o *Client secret* em
   `MICROSOFT_CLIENT_ID` e `MICROSOFT_CLIENT_SECRET` no `.env`.
7. Rode `pnpm dev`, abra `http://localhost:3000/conexoes` e clique em
   **Conectar conta Microsoft**.

Diferente do Google, não existe modo de teste separado nem lista de test
users — qualquer conta consegue autorizar assim que o app registration
existe, inclusive sua própria conta pessoal.

### Conectando uma conta Apple iCloud ou IMAP/CalDAV genérica

Não há OAuth aqui — nem app registration, nem `.env`. Só a conta.

1. Gere uma **senha específica de app** (nunca a senha principal):
   - **iCloud**: appleid.apple.com → Segurança → Senhas específicas de app
     (exige 2FA ativo na conta).
   - **Outros provedores**: procure por "app password" nas configurações de
     segurança da conta.
2. Rode `pnpm dev`, abra `http://localhost:3000/conexoes` e clique em
   **Conectar Apple iCloud / IMAP+CalDAV**.
3. Informe e-mail + senha de app. Host IMAP e URL do CalDAV são detectados
   pelo domínio (`icloud.com`/`me.com`/`mac.com` usam o preset da Apple;
   outros domínios tentam `imap.<domínio>` e `/.well-known/caldav`). Se o
   provedor usar outro endereço, abra "configurar host/porta manualmente".

O formulário **testa a conexão ao vivo** antes de gravar qualquer coisa — as
duas pernas (IMAP e CalDAV) precisam responder. Um erro aqui aparece na hora,
com a mensagem real do servidor.

> ⚠️ Este conector foi escrito e testado em unidade, mas **nunca completou um
> login contra um servidor real** — a rede do ambiente de desenvolvimento
> bloqueia IMAP e hosts CalDAV. Teste com uma conta descartável antes de
> confiar uma caixa principal a ele. Ver `docs/03-conectores.md`.

### Outros comandos

```bash
pnpm test        # 498 testes de núcleo, sem banco
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
