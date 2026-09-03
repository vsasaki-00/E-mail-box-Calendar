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

## PDF de cobrança: lido, e verificável

Mandar o boleto em PDF pelo WhatsApp funciona, e ele volta lido:

```
Li o boleto: R$ 1.740,80 · Boleto Itaú · vence 10/09
Dígitos verificadores fecham.
```

**Por que PDF veio antes de imagem.** A linha digitável tem **dígito
verificador**: o app confere com mod10 e mod11. O valor não é palpite de
modelo — ou o código fecha, ou o app diz que não fecha. É a única parte
deste terreno onde a leitura é verificável, e por isso a confiança sobe para
0,95 quando os DVs fecham (frase digitada nunca passa de 0,7).

Quando **não** fecham, a resposta diz isso com todas as letras. Esconder
seria transformar um número possivelmente corrompido em número confiável.

Reaproveita inteira a extração que já lê boleto e PIX dos anexos dos seus
e-mails — nada de motor novo.

**O binário nunca é guardado.** É lido em memória e descartado; no banco
ficam o valor extraído e a referência que já existia.

**A legenda tem precedência.** Se você escreveu um valor e o documento diz
outro, o seu vale — pode ser pagamento parcial ou com desconto. Mas a
divergência é contada na resposta, nunca engolida:

```
Você escreveu R$ 1.200,00 na legenda, e o documento diz R$ 1.740,80.
Mantive o seu — ajuste no painel se for o contrário.
```

Ler o arquivo é etapa **separada** de registrar a mensagem, pelo mesmo
princípio que já valia para o texto: registrar o que chegou nunca falha por
causa da interpretação. Se o download ou a leitura falharem, a linha
continua lá com o motivo escrito.

### Buscar uma URL que veio num webhook é a definição de SSRF

Três travas, todas necessárias, em `core/whatsapp/midia.ts`:

1. **Só host do Twilio.** A assinatura prova que a entrega é dele, mas não
   prova para onde a URL aponta — um parâmetro é só texto. Sem esta trava,
   quem controlasse o conteúdo do webhook faria o servidor buscar qualquer
   endereço interno. Há teste para `169.254.169.254`, `localhost`, e para o
   clássico `api.twilio.com.evil.com`.
2. **Redirecionamento na mão.** A URL do Twilio responde 30x para um CDN;
   seguir automático mandaria o cabeçalho `Authorization` — o Auth Token da
   conta — para o destino. A segunda busca vai **sem credencial nenhuma**.
3. **Teto de bytes e de tempo.** Isto roda dentro do webhook, que tem 30s
   para responder. Um arquivo grande não pode virar timeout, que faria o
   Twilio reentregar a mensagem inteira.

### Configurar

| Variável | De onde vem |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Console do Twilio → Account Info → Account SID |

Sem ela o PDF chega e o app responde que não conseguiu baixar — a mensagem
não se perde.

### Verificado, e o que não foi

Um boleto real gerado em PDF passa pela cadeia inteira e sai
`R$ 1.740,80 · vence 10/09 · Boleto Itaú · dígitos conferem`. A trava de URL
tem sete testes; a resposta, oito.

**Não exercitado ponta a ponta**: o download em si contra o Twilio real.
O ambiente de desenvolvimento derruba servidores de teste de longa duração,
e a montagem com CA própria não chegou ao fim. As partes foram verificadas
separadamente.

## Mídia: o que o app faz e o que não faz

Foto de comprovante e PDF chegam e ficam **por referência** — o binário
continua no WhatsApp, não no nosso banco. Guardar comprovante do dono aqui
é assumir uma responsabilidade que este app não precisa ter.

**O app não lê valor de imagem.** Não há OCR, e inventar um número a partir
de uma foto seria pior que não ler. Foto e áudio caem numa seção separada
("chegaram, mas não deu para ler"), com o motivo escrito. Se você quer que
uma foto vire lançamento, mande o valor junto na legenda.

## A resposta tem de ser TwiML, nunca JSON

**Encontrado só contra o provedor real**, e é a lição desta fase. A rota
respondia `application/json` com contagens; o Twilio recusa isso num webhook
de mensagem com o erro **12300** (`Invalid Content-Type: application/json
supplied`). A mensagem entrava no app do mesmo jeito — mas cada uma virava
um alarme no console, e um canal que grita a cada mensagem é um canal que
ninguém olha.

Toda resposta da rota agora é um `<Response>` vazio, que diz exatamente o
que queremos dizer: **recebi, e não tenho nada a responder**. O Meridiano
nunca manda mensagem de volta.

O desfecho vai num **comentário XML** dentro do `Response`. Comentário é
ignorado por qualquer parser de TwiML e aparece inteiro no inspetor de
requisição do Twilio — o único lugar onde dá para ver o que aconteceu com
uma mensagem recusada, que de propósito não deixa registro no banco:

```xml
<?xml version="1.0" encoding="UTF-8"?><Response><!-- recusada: numero fora da allowlist --></Response>
```

Nunca o texto da mensagem, só o desfecho.

**E nenhum erro pode escapar sem content-type.** Com o banco fora, a rota
estourava e o runtime devolvia 500 **sem** `Content-Type` — que o Twilio
registra como *502 Bad Gateway*, um sintoma que aponta para o lugar errado.
Agora a parte que toca o banco fica dentro de um `try`, e a falha vira 500
**com** TwiML: o Twilio reentrega, que é o certo para falha passageira.

A recusa por allowlist foi movida para **antes** do banco. Assim ela
continua funcionando mesmo com o banco fora, e quem não está na lista não
gasta consulta.

## A resposta de volta

O app responde na conversa — e **só isso** ele envia. Não há disparo de
mensagem em nenhum outro lugar do código.

Sem chamada de API, sem `TWILIO_ACCOUNT_SID`, sem credencial de envio: o
Twilio já busca TwiML a cada mensagem, então responder é devolver
`<Message>` na mesma resposta. O caminho mais curto é também o que tem menos
peça para quebrar.

**Uma resposta automática só se justifica se disser algo que você não
sabia.** "Recebido ✓" é ruído com cara de educação. Então ela carrega três
coisas, nessa ordem:

1. **O que eu entendi.** Fecha o laço na hora: se o parser leu 1,20 em vez
   de 1.200, você descobre agora, e não semanas depois no painel.
2. **Parece repetido?** É o único momento em que dá para avisar **antes** de
   o dinheiro sair de novo. Pagar duas vezes é o erro caro que este app tem
   como evitar, e ninguém mais tem os dados para ver.
3. **O que vence logo.** A informação que só este app tem — cobranças lidas
   do e-mail — chegando justamente quando você está decidindo gastar.

```
Entendi: saída de R$ 1.200,00 · fornecedor XYZ · 15/08

⚠️ Parecido com *FORNECEDOR XYZ LTDA* de 22/08, mesmo valor.
   Veja se não é o mesmo pagamento.

A vencer em 7 dias: R$ 4.200,00 em 2 cobranças.

Confirme no painel — há mais 1 esperando. Nada foi lançado ainda.
```

O aviso de repetido exige **valor igual E uma palavra em comum** na
descrição. Valor sozinho gera alarme falso demais — aluguel e mensalidade
repetem todo mês de propósito.

**Quando ela NÃO sai:**

- **Número fora da allowlist**: nunca. Responder confirmaria a quem sondou
  que o número existe e que há um app atrás. O silêncio é a resposta.
- **Reentrega**: a resposta sai só no primeiro recebimento. O Twilio
  reentrega o que não recebe 200, e responder de novo encheria a conversa de
  mensagens iguais por um problema de rede.
- **Falha ao montar o texto**: cai em silêncio. A mensagem já está salva;
  um erro aqui faria o Twilio reentregar e a mensagem viraria duas.

O caso mais importante é o que **não** tem valor: sem resposta, você acha
que deu certo e a despesa some. Aí a resposta é o aviso, com exemplo — dizer
"formato inválido" sem mostrar o formato certo é só reclamar.

E o texto da mensagem é escapado antes de entrar no XML: um `&` na descrição
de um fornecedor quebraria a resposta inteira.

## O valor tem teto, e o teto é a coluna

Encontrado em produção, no log do Twilio: uma mensagem rendeu
`717262299560894000` centavos, o `Int` do Postgres recusou, a gravação
estourou, o webhook devolveu **500** — e o Twilio passou a reentregar para
sempre. A mensagem nunca aparecia, e a causa não estava em lugar nenhum da
tela.

Uma frase de WhatsApp com dezesseis dígitos é uma **chave** — linha de
boleto, chave PIX, número de documento —, nunca dinheiro. Acima de
`R$ 21.474.836,47` (o que cabe num `Int`) o número deixa de ser tratado como
valor e a frase cai no caminho honesto: "não achei um valor".

A mesma trava vale na leitura de PDF: uma linha digitável corrompida pode
render um número que a coluna não aceita.

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

**Depois, contra o Twilio de verdade** — e foi ele que achou o que os
testes não achariam: o erro **12300** pela resposta em JSON. Os testes
liam a resposta como um cliente HTTP qualquer, e para um cliente HTTP
qualquer JSON está ótimo; só o Twilio se importa. Vale registrar como
regra: *o formato da RESPOSTA a um provedor só se verifica contra o
provedor*.

Depois do conserto, quatro comportamentos conferidos com o
`MessagingServiceSid` no corpo (o parâmetro que o Messaging Service
acrescenta): assinatura inválida, registro, reentrega e número de fora —
os quatro devolvendo `text/xml`. E, com o **banco derrubado de propósito**,
500 com TwiML para o número válido e 200 para o de fora, provando que a
recusa não depende do banco.

**Continua não verificado**: a Cloud API da Meta contra o provedor real —
não existe conta business neste ambiente. O caminho do Twilio é o que está
em uso.
