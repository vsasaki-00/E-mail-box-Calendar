# 10 — Módulo financeiro (Fase 7)

O que existe, o que foi decidido e por quê. Complementa a Fase 7 do
[`06-roadmap.md`](06-roadmap.md), que tem o pedido original.

## Dois painéis, duas perguntas

| Tela | Pergunta que responde | Fonte |
| --- | --- | --- |
| `/financeiro` | **O que tenho a pagar?** | e-mails marcados como cobrança (boleto, PIX, fatura) |
| `/financeiro/extrato` | **O que entrou e saiu de fato?** | extrato do banco (OFX/CSV importado) |

São coisas diferentes e continuam separadas de propósito. A primeira é
*detecção* — depende do que chegou por e-mail e nunca é completa. A segunda
é o *razão* — o que o banco diz que aconteceu. A conciliação entre as duas
(7B, parte 2) é o que transforma "acho que paguei" em "paguei, dia tal, desta
conta".

## Modelo de dados (7B, parte 1) ✅

Três entidades novas em `prisma/schema.prisma`:

- **`FinancialAccount`** — uma conta de verdade (corrente, poupança, cartão,
  dinheiro…). Tem `business` (um dos `BUSINESS_CONTEXTS`, a mesma lista da
  triagem), e `bankId`/`accountId` como o OFX identifica — é o que faz um
  arquivo novo cair na conta certa sem você escolher. Saldo e data do saldo
  vêm do próprio OFX.
- **`StatementImport`** — um arquivo importado. Guarda o **hash** do arquivo
  (o mesmo arquivo duas vezes não cria nada), o período, e as contagens:
  encontrados, criados, duplicados. Existe como entidade para poder desfazer
  uma importação inteira e para responder "de onde saiu este lançamento?"
  meses depois.
- **`LedgerEntry`** — uma linha do extrato. **`amountCents` é assinado**
  (negativo = saída) — guardar sinal em vez de um campo `tipo` elimina a
  classe inteira de bug em que a soma sai errada porque alguém esqueceu de
  olhar o tipo. `description` é como o banco mandou; `normalized` é o que a
  conciliação e as regras olham. Os campos de conciliação (`matchStatus`,
  `matchedBillId`, `matchConfidence`, `matchReason`) já existem, com a regra
  gravada no enum: **`SUGGESTED` nunca vira `CONFIRMED` sozinho.**

## Deduplicação — o problema central de importação

Extratos de períodos que se sobrepõem são a regra (o banco exporta "últimos
90 dias"). Duas camadas:

1. **Arquivo inteiro**: hash SHA-256 na `StatementImport`, único por usuário.
   Reimportar devolve as contagens da vez anterior e não cria nada.
2. **Lançamento**: unique `(accountId, fingerprint)` + `createMany` com
   `skipDuplicates`. O banco decide, não um loop de `findFirst`.
   - Com **FITID** (OFX), a impressão digital é ele: identidade dada pelo
     banco, estável entre exportações, e a única que sobrevive a uma mudança
     no nosso normalizador.
   - Sem FITID (CSV), é `(dia, valor, descrição normalizada, ocorrência)`.
     O contador de ocorrência existe porque **duas compras iguais no mesmo
     dia são comuns** (dois cafés) e sem ele a segunda sumiria como
     "duplicada".

Ressalva: a dedupe por impressão digital é por **conta**. O mesmo lançamento
importado em duas contas diferentes (erro de escolha no upload) vira dois
lançamentos. Não há como o sistema saber que foi engano; a solução é apagar
a importação errada — o que a `StatementImport` permite.

## Leitores: OFX e CSV

Tudo **local**, sem chamada de API, sem dependência externa. É o caminho
realista descrito no roadmap: todo banco brasileiro exporta OFX, e importar
arquivo não entrega credencial bancária a ninguém.

**OFX** (`src/core/finance/extrato/ofx.ts`) absorve o que os bancos fazem de
diferente entre si: SGML 1.x sem tag de fechamento e XML 2.x com; decimal
com vírgula; data com ou sem hora e fuso (sem fuso, assume-se Brasília);
cartão de crédito via `<CCACCTFROM>` sem `<BANKID>`. `NAME` e `MEMO` se
somam quando diferentes. Extrato de investimento entra como aviso, não como
erro.

**CSV** (`csv.ts`) **descobre o formato** a partir do próprio arquivo:
separador (o que dá o número mais consistente de colunas), cabeçalho (em
qualquer das 10 primeiras linhas, porque banco põe título e período antes),
formato de número (`1.234,56` × `1234.56`, parênteses, sinal no fim, `D`/`C`)
e de data (`dd/mm/aaaa`, `aaaa-mm-dd`). Crédito e débito em colunas separadas
viram sinal. `Saldo` é ignorado — não é lançamento. Sem cabeçalho
reconhecível, infere pela forma. Verificado contra os formatos de Itaú/Inter,
Nubank e Bradesco nos testes.

**Decodificação** (`ler.ts`): OFX de banco brasileiro vem quase sempre em
Latin-1 com cabeçalho dizendo `1252`. Ler como UTF-8 transforma "São João" em
"S�o Jo�o" — e depois quebra a conciliação por nome. UTF-8 estrito primeiro;
byte inválido cai para Latin-1.

**Normalização** (`normalizar.ts`): minúsculas, sem acento, e sem o ruído que
não identifica ninguém — data embutida, final de cartão, número de documento,
horário, parcela, e os prefixos "compra cartão", "pix enviado". A original
fica intacta para auditoria; a normalizada pode mudar quando o normalizador
melhorar, e a dedupe por FITID não depende dela.

## Segurança

Extrato bancário é mais sensível que e-mail. Decisões:

- **O arquivo não é guardado.** Só o hash e o que foi lido.
- Limite de 5 MB e `multipart` estrito na rota.
- Nada de descrição de lançamento em log — a rota devolve só contagens.
- A rota está atrás do middleware como tudo em `/api`.
- Os modelos novos não têm campo cifrado porque não guardam credencial — só
  movimentação. Se um dia entrar Open Finance (credencial de agregador),
  ela herda a criptografia de segredos das conexões.

## Aplicar em produção

O banco de produção já existe; o `prisma/producao.sql` é para banco vazio.
Para a Fase 7B, rode **`prisma/fase7-extrato.sql`** no SQL Editor do
Supabase: só cria os objetos novos, não toca no que existe. Validado
aplicando o `producao.sql` anterior num Postgres limpo, depois este delta, e
conferindo que `prisma db push` responde "already in sync".

Até rodar, a tela `/financeiro/extrato` falha ao carregar (tabela
inexistente). O resto do app não é afetado — nenhuma outra rota consulta
esses modelos.

## O que vem depois

- **7B, parte 2 — conciliação**: propor pares entre `LedgerEntry` e
  `BillExtraction` (valor igual ± data próxima ± beneficiário parecido com a
  descrição normalizada), com motivo, para você confirmar ou rejeitar.
  Nunca casar sozinho.
- **Categorias e regras**: "toda linha com `netflix` → Assinaturas /
  Pessoais". Regra vira aprendizado a partir das suas correções, como na
  triagem.
- **7C — análise**: fluxo de caixa por negócio, recorrente × único,
  "torneira vazando". Precisa de meses de dados — por isso a importação vem
  primeiro.
- **7A — WhatsApp**: decisão de provedor pendente (Cloud API da Meta exige
  conta business verificada e número dedicado). Enquanto isso, encaminhar
  para uma caixa conectada já aciona a extração existente.
