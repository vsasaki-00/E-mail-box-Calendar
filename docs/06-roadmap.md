# 06 — Roadmap

Cada fase termina em algo utilizável. Nada de "fase de infraestrutura" que não
entrega valor.

---

## Fase 0 — Fundação ✅ (esta entrega)

- Documentação de arquitetura, modelo de dados, segurança e conectores.
- Scaffold Next.js + TypeScript + Prisma + Postgres rodando.
- Contrato `Connector` definido com matriz de capacidades.
- Camada de criptografia de segredos implementada e testada.
- Modelo canônico (`UnifiedMessage`, `UnifiedEvent`) e deduplicação implementados.
- Torre de Controle renderizando com dados de demonstração (`pnpm db:seed`).

**Entrega**: dá para rodar, ver a tela de comando e entender a forma do sistema.

---

## Fase 1 — Primeira conta real, leitura ponta a ponta ✅ (esta entrega)

- OAuth Google completo: PKCE, `state` com TTL e proteção contra replay
  (`OAuthState`), callback, refresh proativo, revogação ao desconectar.
- Conector Gmail: full sync (`messages.list` + `messages.get` em lote,
  paginado e retomável) e incremental por `historyId` via `history.list`,
  com queda automática para full sync quando o histórico expira.
- Conector Google Calendar: full sync com `singleEvents=true` (recorrência
  já expandida pelo Google) e incremental por `syncToken`, um token por
  calendário.
- Camada de persistência (`core/sync/persist.ts`): upsert idempotente,
  vínculo com `UnifiedItem` pela chave de deduplicação, reconciliação de
  `copyCount` e remoção de itens órfãos.
- Motor de sync ligado à persistência real, com paginação retomável
  (`pageToken` em `SyncState`) e descoberta automática de calendário novo.
- Página `/conexoes`: conectar via Google, listar contas, sincronizar agora,
  desconectar (com revogação de token no provedor).
- Link "gerenciar conexões" na Torre de Controle.

**Critério de aceite**: conectar uma conta Google e ver e-mails e eventos reais
na tela, com sync incremental funcionando por 24 h sem intervenção.

**Verificado nesta entrega** (sem credenciais reais do Google, que exigem um
projeto no Google Cloud Console): o fluxo OAuth foi validado ponta a ponta
contra os servidores reais do Google (`/api/auth/google/start` gera a URL de
autorização correta com escopos somente-leitura e PKCE; o callback faz uma
chamada real ao endpoint de token e trata o erro de credencial inválida
corretamente; reenviar o mesmo `state` é bloqueado como replay). O motor de
sync foi testado contra uma conexão sem credenciais e degradou para
`REAUTH_REQUIRED` sem derrubar o processo. 92 testes automatizados cobrem a
normalização Gmail/Calendar, deduplicação, detecção de conflitos e backoff.
O que falta para "conectar de verdade": criar as credenciais OAuth no Google
Cloud Console e colocá-las no `.env`.

---

## Fase 2 — Multi-conta e multi-provedor ✅ (conectores entregues)

- ✅ **OAuth Microsoft** (PKCE, `state` com TTL compartilhado com o Google via
  `OAuthState`, refresh proativo). Tenant `common`: mesma conexão atende
  conta pessoal (Hotmail/Outlook.com/Live) e conta corporativa/escolar.
- ✅ **Conector Outlook Mail**: sincroniza por pasta (Graph não tem uma lista
  única "todas as pastas" como o Gmail) — Caixa de Entrada, Enviados,
  Rascunhos e Arquivo por padrão, cada uma com seu próprio `deltaLink` via
  `messages/delta`. Pastas resolvidas pelo **alias bem-conhecido**
  (`/me/mailFolders/inbox`), não pelo nome de exibição — que é localizado e
  quebraria em qualquer idioma diferente de inglês.
- ✅ **Conector Outlook Calendar**: `calendarView/delta`, que devolve
  instâncias já expandidas dentro de uma janela (equivalente ao
  `singleEvents=true` do Google), um `deltaLink` por calendário. Datas
  normalizadas para UTC via `Prefer: outlook.timezone="UTC"`, evitando mapear
  nomes de fuso horário do Windows para IANA.
- ✅ Refatoração: PKCE (`pkce.ts`) e o codec de cursor multi-container
  (`container-cursor.ts`) viraram módulos compartilhados entre Google e
  Microsoft — o mesmo padrão de "um token por container" (calendário ou,
  agora, pasta de e-mail) não precisou ser reimplementado.
- ✅ Deduplicação ativa entre contas (`Message-ID`, `iCalUID`) — já era
  provider-agnóstica desde a fase 1, funciona sem alteração para Microsoft.
- ✅ **Conector IMAP/CalDAV genérico + preset Apple iCloud**: IMAP (via
  `imapflow`) para e-mail com incremental por CONDSTORE/MODSEQ quando o
  servidor suporta e `UIDVALIDITY` como detector de cursor expirado; CalDAV
  (via `tsdav`) para calendário com REPORT `sync-collection` (RFC 6578) e
  expansão de recorrência por `ical.js` quando o servidor não expande.
  Conexão por formulário com teste ao vivo (`POST /api/connections/imap`),
  sem OAuth. **Não validado contra servidor real** — ver ressalva abaixo.
- ⛔ Seletor de quais pastas/calendários entram na visão unificada — hoje o
  padrão (`Mailbox.includeInUnified`) é fixo por papel (`INBOX` = sim, resto
  = não); falta a UI para o usuário alternar. O IMAP herda o mesmo gap: só
  sincroniza `INBOX` por padrão.

**Ressalva importante sobre IMAP/CalDAV**: a rede deste ambiente de
desenvolvimento bloqueia TCP bruto (porta 993) e libera HTTPS só para um
allowlist (Google, Microsoft, registries). Diferente do Google e do Microsoft
— cujos fluxos OAuth foram exercitados contra os servidores reais — **este
conector nunca completou um login real**. O que foi verificado: erro de DNS
(`ENOTFOUND` → `PERMANENT`), timeout de rede real de 90s (`CONNECT_TIMEOUT` →
`TRANSIENT`, sem travar o processo), e 25 testes de lógica pura contra o
`ical.js` real (RRULE, EXDATE, RECURRENCE-ID). Detalhes em
`docs/03-conectores.md`. Recomendação: testar com uma conta descartável antes
de confiar uma caixa principal a ele.

**Critério de aceite**: todas as suas caixas e calendários em uma única tela,
com o mesmo convite aparecendo uma vez só.

**Verificado nesta entrega** (sem app registration real no Microsoft Entra):
`/api/auth/microsoft/start` gera a URL de autorização correta (tenant
`common`, escopos `Mail.Read Calendars.Read User.Read offline_access`, PKCE);
o callback fez uma chamada real ao endpoint de token da Microsoft e recebeu
`AADSTS9002313` (client inválido, esperado com credencial de teste) tratado
corretamente; reenvio do mesmo `state` bloqueado como replay; motor de sync
testado contra uma conexão Microsoft sem credenciais degradou para
`REAUTH_REQUIRED` sem derrubar o processo. 105 testes automatizados (13
novos: normalização de mensagem/evento do Graph, incluindo o caso do
`dateTime` sem sufixo `Z` que precisa ser interpretado como UTC).

**Gap conhecido, não introduzido nesta fase**: `Mailbox.includeInUnified` e
`CalendarSource.includeInUnified` já existem no schema e são respeitados pelo
`persist.ts`, mas a Torre de Controle (`control-tower.ts`) ainda não filtra
as consultas de backlog por esse campo — todo Message sincronizado conta no
backlog de triagem, independente da caixa. Não é um problema visível hoje
porque mensagens de pastas como "Enviados" normalmente já estão marcadas como
lidas, mas é uma amarração pendente para a fase 3 (Torre de Controle
completa), não específica do conector Microsoft.

---

## Fase 3 — Torre de Controle completa ✅

- Detecção de conflitos de agenda entre contas ✅
- **Agenda unificada por semana** ✅ — `/agenda`, com navegação, filtro por
  conta, cópias colapsadas por `iCalUID`, conflitos entre contas e janelas
  livres. O núcleo da unificação já existia desde a fase 2; faltava a tela
  além de "hoje".
- Backlog de triagem e **SLA de resposta por caixa** ✅ — o prazo muda por
  negócio (caixa comercial nasce com 8h, `Pessoais` com 72h), e urgente
  encurta pela metade. Substitui "não lidos" como métrica da Torre.
- **Alertas com deduplicação e reconhecimento** ✅ — a tabela já tinha
  `dedupeKey` e `acknowledgedAt`, mas **nada nunca criava um alerta**. Agora
  são derivados do mesmo estado que a Torre mostra, dedupados por condição,
  **resolvidos automaticamente** quando a condição deixa de valer, e
  reconhecíveis ("eu sei") sem apagar.
- **Busca unificada** ✅ — `/busca`, sobre assunto, remetente, prévia e
  título, com filtros por conta, tipo e triagem. O corpo fica de fora de
  propósito.
- Métricas semanais de atenção — **não feito**. É a única coisa da fase que
  ficou de fora: sem histórico de uso real, uma métrica semanal seria um
  gráfico bonito sobre dados de demonstração.

**Critério de aceite**: a tela de comando responde "está tudo sob controle?"
sem você abrir mais nada.

---

## Fase 4 — Escrita e comando ✅

Racional completo, com as travas e os bugs encontrados:
[`08-escrita-e-acoes.md`](08-escrita-e-acoes.md).

O app deixa de ser observador. **Consentimento OAuth novo e por conexão** —
`writeEnabled` nasce falso e só muda depois de você reautorizar aquela
caixa, e quem decide é o que o provedor **concedeu**, não o que pedimos.

- Ações em e-mail: arquivar, marcar lido, aplicar marcador, enviar ✅
- Ações em calendário: aceitar/recusar/talvez, criar e mover evento ✅
- Fila de ações e log de auditoria na **mesma lista**, com desfazer ✅ —
  tela `/acoes`
- **Não existe ação de excluir.** A ausência é a garantia.
- O agente propõe o reversível; enviar e criar evento são só seus, com
  confirmação em duas etapas.
- IMAP/CalDAV continua sem escrever (nunca validado contra servidor real).

**Critério de aceite**: triar a manhã inteira sem sair do app. **Não
verificado** — nenhuma escrita real aconteceu neste ambiente, por falta de
conta conectada.

---

## Fase 5 — Triagem, painel financeiro e resposta assistida 🔶 (5A a 5D entregues, 5A em uso real)

Reflexão completa, com as armadilhas e o raciocínio por trás do
faseamento: [`07-agente-de-triagem.md`](07-agente-de-triagem.md).

O pedido ("separar prioridades, identificar cobranças, responder como eu")
são **três problemas diferentes** com perfis de risco distintos —
classificar (rotulagem, reversível), extrair (estruturado, verificável) e
escrever (geração, irreversível se enviar). Por isso a fase está quebrada em
sub-fases de risco crescente, cada uma utilizável sozinha:

- **5A — Triagem** 🔶: classifica categoria, prioridade e "precisa resposta?"
  usando **só metadados** (sem enviar corpo de e-mail para lugar nenhum).
  Nenhuma ação tomada. Pré-filtro determinístico, classificador com saída
  estruturada, avaliação contra histórico, card na Torre de Controle e a
  tela `/perfis` (negócio, papel, objetivo, calibragem, VIPs por caixa)
  e a tela `/triagem` (ordenada por urgência, com correção que alimenta o
  `TriageFeedback`) estão implementados e testados. **Exercitada de verdade
  em 02/09/2026**, em produção, contra as seis caixas — a primeira
  classificação real do projeto. Até então toda tentativa morria numa
  variável de ambiente vazia (`TRIAGE_MODEL=""`, que `??` não pegava). O que
  ainda não foi medido é se a classificação ACERTA: isso depende das
  correções do dono se acumularem em `TriageFeedback`, e do preenchimento
  dos perfis de caixa, que é o contexto que o classificador recebe.
- **5B — Painel financeiro** ✅: extração estruturada das cobranças (valor,
  vencimento, beneficiário, tipo, linha digitável, PIX). Tela `/financeiro`.
  A leitura de boleto (linha digitável de título e de arrecadação, com
  dígitos verificadores, valor e fator de vencimento) e de PIX copia e cola
  (BR Code EMV com CRC-16) é **local, sem nenhuma chamada de API** — o
  modelo entra só no que sobrou, com teto de confiança. Sem
  `ANTHROPIC_API_KEY` o painel continua funcionando com a camada local.
  53 testes. Ressalva documentada: o DV geral (módulo 11) não pôde ser
  verificado contra um boleto real neste ambiente, então ele só rebaixa a
  confiança e emite aviso — nunca descarta a cobrança.
- **5C — Perfil de voz por caixa** ✅: derivado da pasta Enviados de cada
  conta, não de formulário. Extração, job de persistência e tela `/voz` de
  validação estão implementados e testados (57 testes): separa texto autoral
  do citado, descarta encaminhamentos e respostas curtas, detecta assinatura
  por repetição (sem engolir a despedida, que é campo próprio) e normaliza
  os três formatos de corpo dos conectores. O conector IMAP foi corrigido
  para sincronizar `SENT` — sem isso contas Apple/IMAP ficariam sem perfil.
  **Este job não faz nenhuma chamada a API de modelo**: todo o processamento
  é local. O perfil é uma proposta até você confirmar "é assim que eu
  escrevo"; rederivar reseta essa validação. Falta rodar contra uma caixa
  real e grande — o corpus de verificação é sintético.
- **5D — Rascunhos com aprovação** ✅: gera resposta com o perfil de voz
  validado da caixa certa. Tela `/rascunhos`. **Nunca envia** — e não é
  envio desligado por flag: não há dependência SMTP, não há chamada de
  envio nos conectores, o enum `DraftStatus` não tem estado "enviado", e os
  escopos OAuth continuam somente-leitura. Dois testes guardam isso. O
  modelo escreve só o miolo; saudação, despedida e assinatura são compostas
  localmente a partir do perfil, então a assinatura sai exata. Só gera com
  perfil de voz que você validou — é o que faz a 5C valer alguma coisa.
  35 testes. NÃO verificado: a qualidade do texto, porque não há API key
  neste ambiente.
- **5E — Ações em lote e envio**: só depois que a 5D tiver ganho confiança.

Princípios inegociáveis desta fase:
- O agente **nunca apaga** — sugere arquivar (reversível); exclusão fica
  manual no provedor.
- Spam é classificado de forma **conservadora**: falso positivo esconde o
  primeiro e-mail de um cliente novo, dano assimétrico.
- O painel financeiro sempre declara que é detecção automática, **não
  garantia de completude**.
- Envio **sempre com aprovação**. O modo de falha mais provável com múltiplos
  negócios não é "texto ruim", é "tom do negócio A no e-mail do negócio B".

---

## Fase 6 — Alcance e operação

- App mobile ou PWA sobre a mesma API.
- Push nativo (Gmail watch + Pub/Sub, Graph subscriptions) substituindo polling.
- Notificações push para alertas críticos.
- Observabilidade: métricas de sync, latência por provedor, alarmes operacionais.

---

## Fase 7 — Módulo financeiro completo 🔶 (7B parte 1 entregue)

**Registrado em 31/08/2026, a pedido do dono. Iniciado em 02/09/2026.**
Detalhes do que existe e das decisões: [`10-financeiro.md`](10-financeiro.md).

Entregue: modelo de dados (contas, importações, lançamentos com campos de
conciliação), leitores de OFX e CSV, importação com deduplicação em duas
camadas, tela `/financeiro/extrato`, SQL delta para produção
(`prisma/fase7-extrato.sql`). Pendente: conciliação (7B parte 2),
categorias/regras, análise (7C), WhatsApp (7A).

Hoje `/financeiro` é um **detector de cobranças que chegam por e-mail**: lê
boleto e PIX do que caiu na caixa e mostra o que vence. Isso responde "o que
tenho a pagar", e só. O pedido é outro: **acompanhar as finanças**, com
previsão, previsibilidade, detecção de "torneira vazando" e análise.

São três blocos, e a ordem entre eles não é indiferente.

### 7A — Entrada de dados por outros canais (WhatsApp)

Poder mandar informação e arquivo por WhatsApp para entrar no módulo — foto
de comprovante, PDF de fatura, "paguei o fornecedor X, 1.200".

Perguntas em aberto, a decidir antes de codar:

- **Qual caminho de WhatsApp.** A Cloud API da Meta exige conta business
  verificada e número dedicado; um bridge não-oficial é frágil e passível de
  banimento. Precisa ser decidido com os custos na mesa.
- **Confiança do canal.** O e-mail tem remetente verificável; o WhatsApp,
  não. Uma mensagem que cria lançamento financeiro precisa saber que veio de
  você — no mínimo, número em allowlist.
- Provavelmente o mesmo padrão já usado no resto: **entrada vira proposta**,
  não lançamento direto. O WhatsApp preenche; você confirma no painel.

Vale notar que o caminho mais barato para começar já existe: **encaminhar
para uma das caixas conectadas** aciona a extração de hoje sem nenhum código
novo. Serve de ponte enquanto o WhatsApp não existe.

### 7B — Dados bancários e conciliação

Subir, conectar, integrar ou importar extrato bancário para conciliar contra
as cobranças detectadas.

O terreno brasileiro, que muda a estratégia:

- **Open Finance é regulado.** Acesso direto exige ser instituição
  autorizada pelo Banco Central. Na prática, ou se usa um agregador
  (Pluggy, Belvo, Klavi e similares), que é serviço pago com credencial de
  terceiro no meio, ou não se usa.
- **Importar arquivo é o caminho realista para a primeira versão**: OFX
  (todo banco brasileiro exporta) e CSV. Sem dependência externa, sem custo
  recorrente, e não entrega credencial bancária a ninguém.
- Conciliação é **casamento de registros**, com todos os problemas do gênero:
  valor bate mas a data não, descrição do extrato não parece com o
  beneficiário do boleto, parcelamento, estorno. Precisa de proposta de
  casamento com confirmação — nunca casar sozinho e em silêncio.
- **Segurança:** extrato bancário é mais sensível que e-mail. Herda a
  criptografia de segredos que já existe, mas merece uma passada própria em
  `04-seguranca.md` antes de entrar.

### 7C — Análise, previsão e previsibilidade

O que o dono pediu com todas as letras, e a parte que só faz sentido depois
que 7B existir — previsão sobre dados incompletos é adivinhação com cara de
número:

- **Fluxo de caixa projetado** por negócio (Unitedcom, Cordex.AI, Brand.co,
  EmpreendaSim, Outros, Pessoais) e consolidado.
- **Previsibilidade**: quanto da receita é recorrente e quanto é evento
  único. Para um negócio de palestras (Brand.co) essa distinção é a que
  importa.
- **Torneira vazando**: assinatura esquecida, cobrança recorrente que subiu
  de preço em silêncio, serviço duplicado entre dois negócios, débito que
  continua depois do cancelamento. É detecção de padrão sobre série
  histórica — precisa de meses de dados, não de um mês.
- **Análise**: em que o dinheiro sai, tendência mês a mês, comparação entre
  os seis negócios.

### Ressalva honesta

Isto é uma reescrita do módulo, não um acréscimo. O `/financeiro` de hoje
tem um modelo de dados de *cobrança detectada*; contas, saldos, lançamentos
conciliados, categorias e séries históricas são entidades que **ainda não
existem no schema**. Vale planejar com essa dimensão à vista em vez de
descobri-la no meio.

---

## Riscos conhecidos e como tratamos

| Risco | Tratamento |
|---|---|
| Verificação do app Google para escopos restritos leva semanas | usar modo de teste com sua conta durante as fases 1–3; iniciar o processo de verificação no início da fase 4 |
| Throttling do Microsoft Graph | respeitar `Retry-After` desde o primeiro dia; backoff exponencial no cliente HTTP |
| Volume de e-mail estourar o banco | janela histórica configurável, corpo sob demanda, sem anexos na fase 1 |
| Recorrência e fuso horário em CalDAV | usar instâncias expandidas dos provedores; para CalDAV, biblioteca dedicada e testes com casos de DST |
| Dedupe agressivo escondendo e-mail legítimo | nunca apagar cópias; a UI sempre mostra em quantas caixas o item existe e permite expandir |
