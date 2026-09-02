# 11 — Entrada por WhatsApp (Fase 7A)

Mandar informação e comprovante por WhatsApp e ver virar lançamento no
painel — com uma confirmação sua no meio. Complementa
[`10-financeiro.md`](10-financeiro.md).

## Por que a Cloud API da Meta, e não um bridge

Existem duas famílias de caminho, e elas não são equivalentes:

- **Cloud API da Meta** (o que está implementado): oficial, gratuita até um
  volume que este uso nunca alcança, e exige conta business verificada mais
  um número dedicado. O número **não pode** estar em uso no app comum do
  WhatsApp.
- **Bridges não-oficiais** (baileys, venom e afins): fáceis de começar,
  contra os termos de uso, e passíveis de **banimento do número**. Para um
  número que atende seis negócios, isso não é um risco aceitável.

Por isso a implementação assume a Cloud API. A conversão do payload fica
isolada em `src/app/api/whatsapp/webhook/route.ts`; o núcleo
(`core/whatsapp/`) não sabe de qual provedor a mensagem veio.

## Duas barreiras, as duas obrigatórias

O canal **não tem remetente verificável** como o e-mail. Qualquer um que
descubra a URL pode fazer um POST, e qualquer pessoa pode mandar mensagem
para um número comercial. Então:

1. **Assinatura HMAC-SHA256** do corpo **cru** com o App Secret
   (`X-Hub-Signature-256`). Sem ela → **403**. O corpo tem de ser o que veio
   na rede: um `JSON.parse` + `JSON.stringify` reordena chaves e a
   assinatura deixa de bater — "funciona no teste, recusa em produção".
2. **Allowlist de número** (`WHATSAPP_ALLOWED_NUMBERS`). Fora dela, a
   mensagem é descartada em silêncio: não registra, não responde, não conta
   a quem mandou o que aconteceu.

**Allowlist vazia recusa tudo.** É de propósito — a alternativa ("sem lista
configurada, aceita todo mundo") transforma um esquecimento de configuração
em porta aberta para lançamentos financeiros.

O nono dígito é tratado: a Meta às vezes entrega `551187654321` e às vezes
`5511987654321`. Sem normalizar as duas formas, você cairia na própria
allowlist umas vezes sim, outras não — um bug que só aparece em produção e
parece aleatório.

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

A Meta **reentrega** o que não recebe 200. Por isso:

- unique `(channel, externalId)` — reentrega não duplica proposta;
- o webhook responde **200 mesmo quando recusa** (número de fora, corpo
  ilegível): a recusa é definitiva, não um erro temporário, e reentregar
  para sempre só geraria ruído. O **403** fica só para assinatura inválida,
  a única coisa que a Meta nunca deveria mandar.

## Configurar

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
honesta enquanto a conta business não estiver verificada.

## Verificado

Nove comportamentos exercitados de ponta a ponta contra o app rodando, não
só em teste unitário: verificação com token certo e errado; POST sem
assinatura, com assinatura de outro segredo, e com a certa; reentrega da
mesma mensagem; número fora da allowlist; o mesmo número sem o nono dígito;
e foto sem legenda. Depois, "lançar" pela tela criando o `LedgerEntry` com
a categoria corrigida à mão e o negócio herdado da conta.

**Não verificado**: a integração real com a Meta, que depende de conta
business verificada e número dedicado — nada disso existe neste ambiente. O
que foi testado é o webhook recebendo exatamente o formato de payload que a
Cloud API documenta.
