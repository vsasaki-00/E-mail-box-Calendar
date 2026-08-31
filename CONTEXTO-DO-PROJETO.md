# Torre de Comando — Gerenciador Unificado de E-mail e Calendário

Contexto de projeto para colar no início de uma nova conversa com o Claude.
Gerado a partir do estado real do código nesta data — não é uma proposta,
é o que existe e está testado.

Repositório: `https://github.com/vsasaki-00/E-mail-box-Calendar`
Branch de trabalho: `claude/email-calendar-manager-zsf592`

---

## 1. O que é

Um app pessoal (Next.js + Postgres, self-hosted) que unifica **várias
caixas de e-mail e calendários** — Gmail, Microsoft/Outlook, Apple iCloud,
IMAP/CalDAV genérico — em uma única "Torre de Comando". O dono opera **seis
negócios diferentes** (Unitedcom, Cordex.AI, Brand.co, EmpreendaSim, Outros,
Pessoais), cada um com sua própria caixa, e quer:

1. Ver tudo num lugar, sem duplicação (o mesmo convite em duas contas não
   pode virar dois itens).
2. Um agente que triA o e-mail: prioridade, o que precisa de resposta, o
   que é cobrança, o que é spam.
3. Um painel financeiro alimentado por cobranças detectadas nos e-mails.
4. Rascunhos de resposta escritos no seu próprio tom de voz, por caixa.
5. Eventualmente, ações de escrita (arquivar, responder, criar evento) —
   com consentimento explícito e travas fortes.

## 2. Stack

- **Next.js 15** (App Router, Server Components, Server Actions), React 19,
  TypeScript estrito (`noUncheckedIndexedAccess`).
- **Postgres 16** via Prisma 6.
- **pnpm**, **vitest** (498 testes, todos sobre lógica pura — sem tocar
  banco nem rede).
- **Anthropic SDK** (`@anthropic-ai/sdk`) para classificação/extração/
  geração de texto, modelo padrão `claude-opus-5`, saída estruturada via
  `zodOutputFormat`.
- **unpdf** para extrair texto de PDF anexo (boletos).
- Worker de sincronização em processo separado (`src/worker/index.ts`),
  hoje um loop simples; troca por fila (BullMQ) fica para quando houver
  volume.

## 3. Decisões de arquitetura que valem a pena saber

- **Contrato único de conector** (`src/lib/connectors/types.ts`): o núcleo
  nunca ramifica por provedor. Cada conector declara `capabilities`
  (incremental sync strategy, push vs. polling, write, attachments) e o
  motor decide a estratégia a partir disso.
- **Deduplicação por identificador estável**: `Message-ID` (RFC 5322) para
  e-mail, `iCalUID` (RFC 5545) + horário de início para evento. Cópias
  continuam existindo por conexão (arquivar precisa saber onde o item
  fisicamente está); a chave só agrupa em um `UnifiedItem`.
- **Datas sempre no fuso do usuário, nunca no do servidor**
  (`src/core/time/zone.ts`). Bug real encontrado e corrigido: o servidor
  roda em UTC, e sem fuso explícito os horários e os limites de dia saíam
  errados em até 3h.
- **Backoff que distingue `CURSOR_EXPIRED`** (não é falha, é sinal para
  full sync) **de falha real**.
- **Segurança**: credenciais cifradas AES-256-GCM, chave mestra fora do
  banco (`.env`, nunca commitado — verificado com `git check-ignore` antes
  de cada commit). Corpo de e-mail nunca logado. Fase 1 é 100% somente-
  leitura; escrita (fase 4) é opt-in por conexão.

## 4. O que está construído e testado

### Fase 0–3 — Fundação, conectores, Torre de Controle ✅
- Conectores Google (Gmail + Calendar), Microsoft Graph (Mail + Calendar),
  IMAP/CalDAV genérico (Apple iCloud e outros).
- Sincronização incremental por provedor (`historyId`, `deltaLink`,
  `syncToken`, `CONDSTORE`), com reconciliação idempotente.
- Torre de Controle: saúde das conexões, agenda do dia com dedupe real,
  detecção de conflito de calendário **entre contas diferentes**, janelas
  de foco livres.
- **Agenda unificada** (`/agenda`): visão semana e mês, timezone correto,
  grade de horas.
- **SLA de resposta por caixa** — substitui "não lidos" pela métrica que
  importa: quem está esperando e há quanto tempo, com prazo por negócio
  (caixa comercial 8h, `Pessoais` 72h).
- **Alertas** com dedupe, resolução automática e reconhecimento manual.
- **Busca unificada** (`/busca`) sobre metadados (nunca sobre o corpo).

### Fase 5A — Triagem por IA ✅ (lógica testada; modelo real não exercitado)
- Pré-filtro determinístico decide o que dá para decidir sem gastar
  chamada de API (VIP, lista de distribuição, etc).
- Classificador com saída estruturada, contexto por caixa
  (`MailboxProfile`: negócio, papel, objetivo, calibragem, VIPs).
- **Privacidade**: a triagem em massa manda **apenas metadados**
  (remetente, assunto, trecho de 200 caracteres) — nunca o corpo.
- Tela `/triagem` com correção manual, que retroalimenta o sistema
  (`TriageFeedback`) e nunca é sobrescrita por reclassificação futura.
- Avaliação contra o histórico real do usuário (`evaluate.ts`) para medir
  acurácia antes de confiar.

### Fase 5B — Painel financeiro ✅
- Extração de cobranças: valor, vencimento, beneficiário, linha digitável,
  PIX copia-e-cola.
- **Boleto e PIX são lidos localmente**, com verificação de dígito
  verificador — nenhuma chamada de modelo necessária para isso. O modelo
  só entra pro que sobra, com confiança limitada.
- **PDF anexo** também é lido (Google e Microsoft; IMAP declara que não
  sabe, de propósito, por nunca ter sido testado contra servidor real).
- Tela `/financeiro`.

### Fase 5C — Perfil de voz ✅
- Deriva de que jeito o usuário escreve **em cada caixa**, a partir da
  pasta Enviados — nunca de formulário de auto-descrição.
- Extração local, sem chamada de modelo: saudação, despedida, assinatura,
  tamanho médio de mensagem, tom.
- Tela `/voz`, com validação manual antes do perfil "valer" para geração.

### Fase 5D — Rascunhos de resposta ✅
- Gera rascunho de resposta usando o perfil de voz **daquela caixa**.
- **Nunca envia.** Tela `/rascunhos`, aprovação manual obrigatória.

### Automação pós-sync ✅
- Worker roda triagem e extração de cobrança sozinho, com **teto de gasto
  diário** configurável (`AUTO_TRIAGE_DAILY_LIMIT`, `AUTO_BILLS_DAILY_LIMIT`)
  para não sair caro sem aviso.

### Fase 4 — Escrita e comando ✅ (código pronto; nenhuma escrita real ainda)
Este é o ponto mais delicado do projeto, e foi construído em torno de
quatro travas, não de funcionalidades:

1. **Escrita é por caixa**, não global. `Connection.writeEnabled` nasce
   `false` e só muda depois que o usuário reautoriza *aquela* conexão
   especificamente (fluxo OAuth novo, com escopos de escrita). O que conta
   é o que o provedor **concedeu**, não o que foi pedido — o usuário pode
   desmarcar permissão na tela de consentimento e o app respeita isso.
2. **Não existe ação de excluir** no catálogo (`ActionKind`). Arquivar
   resolve o mesmo problema e é reversível; apagar é o único erro que a
   pessoa nunca descobre. Isso é garantido por teste.
3. **O agente nunca pode pedir ação irreversível.** Enviar e-mail e criar
   evento (as duas ações que "saem" para outra pessoa) exigem confirmação
   humana explícita em duas etapas — mesmo se o agente "quisesse".
4. **Fila de confirmação e log de auditoria são a mesma lista**
   (`ActionRequest`), nunca dois sistemas separados que podem discordar.
   Ações reversíveis podem ser desfeitas; o estado anterior é gravado
   antes de qualquer chamada de escrita.

Tela `/acoes`. 498 testes cobrem a política, mas **nenhuma escrita real
aconteceu ainda** — falta conta conectada com escopo de escrita concedido
para validar ponta a ponta contra um provedor de verdade.

## 5. O que falta / próximos passos honestos

- **Nenhuma chamada real ao modelo Anthropic foi feita** neste ambiente de
  desenvolvimento (sem rede de saída liberada para testar). Toda a lógica
  de triagem/extração/geração está testada com mocks; falta validar
  qualidade de classificação e de rascunho contra casos reais.
- **Escrita (fase 4) está implementada mas não exercitada** contra um
  provedor real — é o próximo teste crítico antes de confiar na fila de
  ações.
- **Conector IMAP/CalDAV genérico nunca foi testado contra um servidor
  real** (só Apple iCloud tem caminho documentado e parcialmente
  validado).
- Ações em lote / envio automático (fase 5E) — **deliberadamente não
  construídas ainda**. Qualquer automação de envio real precisa de decisão
  explícita do usuário, feita com calma, não como efeito colateral de
  outra tarefa.

## 6. Como rodar localmente

```bash
git clone https://github.com/vsasaki-00/E-mail-box-Calendar
cd E-mail-box-Calendar
git checkout claude/email-calendar-manager-zsf592
bash scripts/setup.sh   # confere Node/pnpm, gera chave, sobe/gera o Postgres
pnpm dev                # http://localhost:3000
```

`scripts/setup.sh` é idempotente, nunca sobrescreve um `.env` existente, e
funciona com ou sem Docker (cria papel + banco Postgres sozinho se não
houver Docker disponível).

## 7. Documentação completa no repositório

Cada decisão relevante tem doc própria em `docs/`:
`00-visao.md`, `01-arquitetura.md`, `02-modelo-de-dados.md`,
`03-conectores.md`, `04-seguranca.md`, `05-torre-de-controle.md`,
`06-roadmap.md`, `07-agente-de-triagem.md` (a mais longa — cobre triagem,
financeiro, voz e rascunhos em detalhe), `08-escrita-e-acoes.md`.
