# 11 — Entrada por WhatsApp (Fase 7A)

Mandar informação e comprovante por WhatsApp e ver virar lançamento no
painel — com uma confirmação sua no meio. Complementa
[`10-financeiro.md`](10-financeiro.md).

## Dois caminhos oficiais, e basta um

**Correção de uma versão anterior deste documento**, que dividia o mundo em
"Cloud API × bridge não-oficial" e deixava de fora justamente o caminho que
o dono já tinha. São três famílias, não duas:

| caminho | o que exige | rota |
| --- | --- | --- |
| **Twilio** (BSP homologado pela Meta) | conta Twilio e um número aprovado | `/api/whatsapp/twilio` |
| **Cloud API da Meta** (direto) | conta business verificada + número dedicado | `/api/whatsapp/webhook` |
| bridges não-oficiais (baileys, venom) | — | **não implementado** |

Os dois primeiros são oficiais. O terceiro é fácil de começar, contra os
termos de uso e passível de **banimento do número** — para um número que
atende seis negócios, risco inaceitável, e por isso não existe aqui.

**Se você já tem um número aprovado no Twilio, use o Twilio**: pula a
verificação de empresa e a exigência de número dedicado, que são a parte
demorada do caminho da Meta.

Os dois adaptadores são casca fina. O núcleo (`core/whatsapp/mensagem.ts`,
`seguranca.ts`, `entrada.ts`) não sabe de qual provedor a mensagem veio, e
as duas rotas terminam no mesmo `registrarMensagem`.

### O que muda entre eles

|  | Twilio | Cloud API |
| --- | --- | --- |
| corpo | `x-www-form-urlencoded` | JSON |
| assinatura | HMAC-**SHA1** de (URL + params ordenados), base64 | HMAC-**SHA256** do corpo cru, hex |
| segredo | `TWILIO_AUTH_TOKEN` | `WHATSAPP_APP_SECRET` |
| handshake | não tem | `GET` com `hub.challenge` |
| mídia | `MediaUrl0` (URL, precisa de Basic auth para baixar) | `id` (precisa de token) |

**A armadilha do Twilio é a URL.** A assinatura inclui a URL que o Twilio
chamou, e atrás de um proxy (Vercel) o runtime enxerga a interna — assinar
contra ela nunca bate. Por isso `urlPublica()` prefere
`WHATSAPP_PUBLIC_URL` e, na falta, reconstrói por `x-forwarded-host` +
`x-forwarded-proto`. Há teste para isso, e ele foi exercitado contra o app
rodando: assinatura válida calculada sobre outra URL → **403**.

## Duas barreiras, as duas obrigatórias

O canal **não tem remetente verificável** como o e-mail. Qualquer um que
descubra a URL pode fazer um POST, e qualquer pessoa pode mandar mensagem
para um número comercial. Então:

1. **Assinatura do provedor**. Sem ela → **403**, nos dois caminhos.
   - Cloud API: HMAC-SHA256 do corpo **cru**. Cru importa: um
     `JSON.parse` + `JSON.stringify` reordena chaves e a assinatura deixa
     de bater — "funciona no teste, recusa em produção".
   - Twilio: HMAC-SHA1 de (URL + parâmetros ordenados). A URL importa
     pelo mesmo motivo, atrás de proxy.
2. **Allowlist de número** (`WHATSAPP_ALLOWED_NUMBERS`). Fora dela, a
   mensagem é descartada em silêncio: não registra, não responde, não conta
   a quem mandou o que aconteceu.

**Allowlist vazia recusa tudo.** É de propósito — a alternativa ("sem lista
configurada, aceita todo mundo") transforma um esquecimento de configuração
em porta aberta para lançamentos financeiros.

O nono dígito é tratado: os provedores às vezes entregam `551187654321` e
às vezes `5511987654321`. Sem normalizar as duas formas, você cairia na própria
allowlist umas vezes sim, outras não — um bug que só aparece em produção e
parece aleatório.

**O código do país também.** O provedor sempre manda com o `55`; uma pessoa
escreve o próprio número sem ele (`11 98765-4321`). Sem aceitar as duas
formas, a allowlist do dono não casaria com o dono — e o sintoma é o pior
possível: descarte em silêncio, sem rastro em lugar nenhum. O `55` é
**acrescentado**, nunca removido: tirar transformaria um número estrangeiro
de 10 dígitos em brasileiro.

E é por isso que `/financeiro/entrada` mostra **quais** números aceita, e
não só quantos. Uma recusa silenciosa que não deixa rastro precisa, no
mínimo, que a configuração esteja visível do lado de cá.

## Nada vira lançamento sozinho

A mensagem chega, é interpretada, e vira **proposta** em
`/financeiro/entrada`. Você confere, corrige o que quiser (valor, direção,
descrição, data, conta, categoria, negócio) e clica **lançar**. Só aí
existe `LedgerEntry`.

O parser (`core/whatsapp/mensagem.ts`) é pura leitura de frase e assume
isso na confiança que reporta — nunca 1:

| entrada | leitura |
| --- | --- |
| `paguei o fornecedor XYZ, 1.200 dia 15/08` | saída, R$ 1.200,00, "fornecedor XYZ", 15/08 |
| `recebi 2 mil do cliente ACME` | entrada, R$ 2.000,00, "cliente ACME" |
| `gastei R$ 89,90 no mercado` | saída, R$ 89,90, "mercado" |
| `fornecedor ACME 349` | saída (assumida), R$ 349,00 — confiança 0,5 |

Detalhes que custam bug quando ignorados: `1.200` em português é mil e
duzentos, não um vírgula dois; a data na frase não pode virar valor
(`paguei 1.200 dia 15/08` tem três números, um só é dinheiro); e um ano
solto (`nota fiscal 2026`) também não é valor.

O lançamento criado carrega a origem na impressão digital
(`whatsapp:<id da mensagem>`), o que impede dois cliques criarem dois
lançamentos e impede colidir com uma linha do extrato do mesmo dia e valor.

## Mídia: o que o app faz e o que não faz

Foto de comprovante e PDF chegam e ficam **por referência** — o binário
continua no WhatsApp, não no nosso banco. Guardar comprovante do dono aqui
é assumir uma responsabilidade que este app não precisa ter.

**O app não lê valor de imagem.** Não há OCR, e inventar um número a partir
de uma foto seria pior que não ler. Foto e áudio caem numa seção separada
("chegaram, mas não deu para ler"), com o motivo escrito. Se você quer que
uma foto vire lançamento, mande o valor junto na legenda.

## Reentrega e idempotência

Os dois provedores **reentregam** o que não recebe 200. Por isso:

- unique `(channel, externalId)` — reentrega não duplica proposta;
- o webhook responde **200 mesmo quando recusa** (número de fora, corpo
  ilegível): a recusa é definitiva, não um erro temporário, e reentregar
  para sempre só geraria ruído. O **403** fica só para assinatura inválida,
  a única coisa que um provedor legítimo nunca deveria mandar.

## Configurar — Twilio

| Variável | De onde vem |
| --- | --- |
| `TWILIO_AUTH_TOKEN` | Console do Twilio → Account Info → Auth Token |
| `WHATSAPP_ALLOWED_NUMBERS` | seu número em E.164, ex. `5511987654321` |
| `WHATSAPP_PUBLIC_URL` | opcional; a URL pública do app, se a reconstrução por cabeçalho falhar |

No console do Twilio, no número de WhatsApp: **"When a message comes in"** →
`https://<seu-domínio>/api/whatsapp/twilio`, método **POST**.

Não há passo de verificação: o Twilio não faz handshake. A primeira
mensagem que você mandar já aparece em `/financeiro/entrada`.

## Configurar — Cloud API da Meta

No painel da Meta (developers.facebook.com → seu app → WhatsApp):

| Variável | De onde vem |
| --- | --- |
| `WHATSAPP_APP_SECRET` | Configurações → Básico → Chave Secreta do App |
| `WHATSAPP_VERIFY_TOKEN` | você inventa; cole a mesma string nos dois lados |
| `WHATSAPP_ALLOWED_NUMBERS` | seu número em E.164, ex. `5511987654321`; vários separados por vírgula |

Depois, em WhatsApp → Configuração → Webhook:

- **URL de callback**: `https://<seu-domínio>/api/whatsapp/webhook`
- **Token de verificação**: o mesmo `WHATSAPP_VERIFY_TOKEN`
- Assinar o campo **`messages`**

A Meta chama a URL com `GET` uma vez, para verificar. A rota responde o
`hub.challenge` quando o token bate, e 403 quando não.

Banco: rode `prisma/fase7-whatsapp.sql` no SQL Editor do Supabase (depois
dos deltas anteriores). Cria tabela, então o aviso de RLS aparece: **"Run
and enable RLS"**.

## Enquanto o canal não estiver ligado

**Encaminhar o comprovante para uma das caixas conectadas já funciona**, sem
nada de novo: a extração de cobranças lê o corpo e o PDF anexo. É a ponte
honesta enquanto o canal não estiver ligado.

## Verificado

**Cloud API** — nove comportamentos contra o app rodando: verificação com
token certo e errado; POST sem assinatura, com assinatura de outro segredo,
e com a certa; reentrega; número fora da allowlist; o mesmo número sem o
nono dígito; foto sem legenda. Depois, "lançar" pela tela criando o
`LedgerEntry` com a categoria corrigida à mão e o negócio herdado da conta.

**Twilio** — oito comportamentos, com assinaturas HMAC-SHA1 calculadas de
verdade: sem assinatura, com token errado, **assinada contra outra URL**
(a armadilha de proxy), com a certa, reentrega, número de fora, foto sem
legenda (vira `FAILED`, sem proposta), e PDF com legenda com valor (vira
proposta de R$ 2.000 de entrada).

**Não verificado nos dois**: a chamada real do provedor. Nem conta Twilio
nem conta business existem neste ambiente; o que foi exercitado é cada
webhook recebendo exatamente o formato que o provedor documenta.
