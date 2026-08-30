# 07 — Agente de Triagem, Painel Financeiro e Resposta Assistida

Documento de reflexão sobre a fase 5, seguido do estado do que já foi
construído. As decisões tomadas com o usuário estão registradas no fim.

---

## O que você pediu, relido com cuidado

> "separar as prioridades, me trazer e-mails que devem ser respondidos, quais
> devem ser removidos, quais são spams, quais são cobranças e enviar para um
> painel financeiro (…) e responder para mim como se fosse eu de acordo com a
> minha aprovação ou direção. Entendendo como eu escrevo, qual o meu perfil e
> objetivo em cada caixa, pois são negócios diferentes."

Lendo com atenção, isso não é **uma** funcionalidade. São **três**, que se
parecem por fora e são completamente diferentes por dentro:

| | O que é tecnicamente | Verificável? | Reversível? | Risco |
|---|---|---|---|---|
| **Classificar** (prioridade, spam, descartável, cobrança) | rotulagem | sim, contra o seu histórico | sim | baixo |
| **Extrair** (cobranças → painel financeiro) | extração estruturada | sim, contra o e-mail original | sim | médio |
| **Escrever como você** | geração de texto | não objetivamente | **não, se enviar** | **alto** |

**Elas não devem ser construídas juntas nem entregues juntas.** Misturar as
três num "agente de e-mail" é o caminho mais rápido para um sistema em que
você não confia — porque um erro na parte arriscada contamina a confiança nas
partes que funcionam bem.

A proposta abaixo separa em fases com risco crescente, e cada uma só começa
depois que a anterior provou que merece confiança.

---

## A ideia que muda tudo: você já tem o corpus

Você pediu que o sistema entenda "como eu escrevo, qual o meu perfil e
objetivo em cada caixa".

O reflexo comum é fazer um formulário: "descreva seu tom", "qual seu
objetivo nesta caixa". Isso produz resultado ruim — ninguém descreve o
próprio jeito de escrever com precisão, e a descrição que você faria de si
mesmo não é a que sai na prática às 23h respondendo um cliente irritado.

**Você já tem milhares de exemplos de como escreve: a pasta Enviados de cada
conta.** E o mais importante — ela é *diferente por caixa*, que é exatamente
a distinção que você pediu. O jeito que você escreve na caixa do negócio A
não é o mesmo da caixa do negócio B, e a prova disso está gravada.

Então o perfil de voz é **derivado**, não declarado. O sistema lê o que você
já escreveu naquela caixa e monta o perfil. Você revisa e corrige — mas
começa de algo real, não de um formulário em branco.

Cuidado técnico: nem tudo em Enviados é você escrevendo. Encaminhamentos,
"ok", "recebido, obrigado", e-mail com 90% de citação do original. O extrator
precisa filtrar para respostas genuinamente autorais com corpo próprio
relevante — senão o perfil aprende que você escreve "ok" o tempo todo.

---

## A decisão que precisa vir antes de qualquer código: privacidade

Classificar e redigir significa que **conteúdo de e-mail sai da sua máquina**
e vai para uma API. Você tem 4+ caixas de negócios diferentes: contratos,
dados de clientes, números financeiros.

Há uma arquitetura que resolve boa parte disso sem sacrificar qualidade, e
acho que é a resposta certa:

**Classificação em massa usa só metadados. Redação usa o corpo, mas só de um
e-mail por vez, quando você pede.**

Na prática:

- **Triagem (roda o tempo todo, em todos os e-mails)**: manda remetente,
  assunto, trecho de 200 caracteres, presença de anexo, se é lista de
  distribuição. **Não manda o corpo.** Isso classifica bem — 80% da decisão
  "isso é spam / cobrança / precisa resposta" está no remetente e no assunto.
- **Extração financeira**: precisa do corpo (valor e vencimento estão lá),
  mas roda só nos e-mails que a triagem já marcou como cobrança — um
  subconjunto pequeno e de natureza previsível.
- **Redação**: precisa do thread completo, mas roda **sob demanda**, quando
  você clica "rascunhar resposta" naquele e-mail específico. Nunca em lote,
  nunca automaticamente.

Resultado: a maior parte do volume nunca tem o corpo enviado a lugar nenhum,
e você controla explicitamente o que sai quando importa.

Isso ainda é uma escolha sua — a alternativa "nada sai da máquina" existe
(modelo local), com custo de qualidade grande e necessidade de GPU. Está na
lista de decisões no fim.

---

## Custo: menor do que parece, e isso muda a recomendação

Fiz a conta com os preços atuais da API (junho/2026). Premissa: 6 caixas,
~200 e-mails/dia no total = ~6.000/mês.

**Triagem** (só metadados: ~300 tokens de entrada, ~100 de saída por e-mail,
com o prompt de sistema em cache):

| Modelo | Custo mensal estimado |
|---|---|
| Claude Haiku 4.5 | ~US$ 5 |
| Claude Sonnet 5 | ~US$ 10 |
| Claude Opus 5 | ~US$ 24 |

**Redação** (~20 rascunhos/dia, thread + perfil de voz em cache):

| Modelo | Custo mensal estimado |
|---|---|
| Claude Opus 5 | ~US$ 15 |

A conclusão importante: **o custo não é o gargalo**. Estamos falando de algo
como US$ 20–40/mês para o sistema inteiro. Isso muda a recomendação —
não vale complicar a arquitetura com uma cascata de modelos baratos para
economizar US$ 15. Melhor usar um modelo bom e acertar mais.

Dois ajustes que valem por outros motivos (não por custo):

- **Filtro determinístico antes da IA**: cabeçalho `List-Unsubscribe`,
  remetente já conhecido e classificado antes, domínio na sua lista de
  clientes. Não é para economizar — é para **não gastar uma chamada de API
  numa decisão que uma regra resolve com certeza**, e para dar resposta
  instantânea nesses casos.
- **Batch API (50% de desconto, assíncrono)**: a triagem não precisa ser
  instantânea. E-mail que chegou às 3h pode ser classificado às 7h.

---

## As armadilhas — o que eu faria diferente do óbvio

Esta é a parte que acho mais importante deste documento.

### 1. Auto-envio: minha recomendação é *nunca*, não "ainda não"

Você disse "de acordo com a minha aprovação ou direção" — o que já indica que
você quer aprovação. Quero reforçar por quê, porque a tentação de automatizar
"os fáceis" vai aparecer.

A assimetria é brutal: um e-mail auto-enviado corretamente economiza 2
minutos. Um e-mail auto-enviado com o tom errado para o cliente errado pode
custar um negócio. E com **4 negócios diferentes**, o modo de falha mais
provável não é "texto ruim" — é **tom do negócio A num e-mail do negócio B**.
Esse erro é sutil, passa despercebido na revisão rápida, e é exatamente o que
um sistema que mistura contextos comete.

### 2. O risco real não é o rascunho ruim — é a fadiga de aprovação

O agente vai acertar ~80% dos rascunhos. O problema não é os 20% errados: é
que depois de aprovar 50 rascunhos bons seguidos, você para de ler com
atenção. É aí que o ruim passa.

Contramedidas de design, desde a primeira versão:

- O rascunho **declara sua confiança** e o motivo. "Alta confiança: cliente
  recorrente, assunto rotineiro, 12 respostas parecidas no histórico" versus
  "Baixa confiança: primeiro contato deste remetente, assunto envolve preço".
- **Destinatários de alto risco marcados no perfil** (clientes grandes,
  primeiro contato, qualquer coisa com valor) sempre vêm com aviso de revisão
  cuidadosa, mesmo que o texto pareça ótimo.
- A UI **não** deve ter um botão "aprovar todos".

### 3. "Quais devem ser removidos": o agente nunca apaga

Excluir é a única ação verdadeiramente destrutiva aqui. Proposta:

- O agente **sugere arquivar**, não excluir. Arquivar é reversível; excluir,
  na prática, não.
- Vira uma fila de "candidatos a arquivar" que você aprova em lote,
  revisando a lista.
- Exclusão de verdade continua 100% manual, no provedor. O app não faz.

### 4. Falso positivo de spam é assimétrico

Newsletter marcada como spam: nenhum dano. **Primeiro e-mail de um cliente
novo marcado como spam e escondido: negócio perdido, e você nunca fica
sabendo.**

Então: a classificação de spam tem que ser **conservadora por projeto** — na
dúvida, não esconde. E spam nunca é apagado automaticamente, só rebaixado na
ordenação.

### 5. O painel financeiro cria falsa sensação de completude

Se o extrator perder um boleto, você olha o painel, vê "nenhuma cobrança
vencendo" e conclui que está tudo pago. O erro do sistema virou o seu erro.

Então o painel precisa dizer, sempre e visivelmente: **"detectado
automaticamente a partir dos e-mails — não é garantia de que todas as
cobranças foram encontradas"**. E mostrar a confiança de cada extração, com
link para o e-mail original para conferência.

### 6. Como saber se funciona antes de confiar: seu histórico é o gabarito

Esta é a oportunidade que não pode ser desperdiçada. Você já tem meses de
decisões tomadas, e elas são a resposta certa:

- E-mail que **você respondeu** → precisava de resposta.
- E-mail que você **arquivou ou apagou sem abrir** → descartável.
- E-mail que está na pasta de **spam** → spam.
- E-mail que você respondeu **em menos de 1h** → era urgente.

Isso permite **medir a acurácia da triagem contra a sua própria história,
antes de você confiar nela para qualquer coisa**. Sem isso, você estaria
apostando. Com isso, dá para dizer "concorda com você em 91% dos casos, e
aqui estão os 9% em que discorda".

### 7. Toda correção sua é sinal — e precisa ser guardada

Quando você muda uma classificação, edita um rascunho antes de aprovar, ou
descarta uma sugestão: isso é a informação mais valiosa do sistema. Se não
for capturada, o agente nunca melhora e você desiste dele em três semanas.

Cada correção precisa virar registro (`TriageFeedback`), alimentando tanto o
perfil da caixa quanto os exemplos que vão no prompt.

---

## Fases propostas

Risco crescente. Cada uma entrega algo utilizável sozinha.

### Fase 5A — Triagem (classificação)

Somente leitura, só metadados, **nenhuma ação tomada**. Classifica cada item
em categoria (cobrança / precisa-resposta / informativo / promocional /
spam / descartável), prioridade, e "precisa de resposta?".

Entrega: a Torre de Controle deixa de mostrar "47 não lidos" e passa a
mostrar "**3 precisam de resposta hoje**, 2 cobranças vencendo, 41 podem
esperar".

**Critério de aceite honesto**: concordância medida contra o seu histórico,
publicada. Se ficar abaixo de ~85% em "precisa resposta", não avança.

### Fase 5B — Painel financeiro

Extração estruturada das cobranças que a 5A identificou: valor, vencimento,
beneficiário, tipo (boleto/fatura/assinatura/NF), linha digitável.

É a fase de **melhor relação valor/risco do projeto inteiro**: alto valor
prático, totalmente verificável contra o e-mail original, e nenhuma ação
irreversível. Se eu tivesse que escolher uma só para fazer primeiro, seria
forte candidata.

### Fase 5C — Perfil de voz por caixa

Deriva o perfil de cada caixa da pasta Enviados: tom, saudação, despedida,
tamanho típico, formalidade, assinatura, com quem você fala. **Não gera nada
ainda** — só monta o perfil e mostra para você revisar e corrigir: "é assim
que eu escrevo?".

Separar isso da geração é deliberado: você valida o entendimento antes de ver
texto gerado, o que é muito mais fácil de julgar.

### Fase 5D — Rascunhos com aprovação

Aí sim gera resposta, usando o perfil da caixa correta. **Nunca envia.**
Salva como rascunho no provedor (você revisa no Gmail/Outlook se preferir) ou
mostra na UI para aprovar/editar/descartar.

Toda edição sua é comparada com o rascunho original — é assim que o perfil
melhora.

### Fase 5E — Ações em lote e envio com aprovação

Só depois que a 5D tiver histórico suficiente para você confiar. Arquivar em
lote, enviar o rascunho aprovado, marcar cobrança como paga.

---

## O que precisa entrar no modelo de dados

Esboço, para dimensionar a mudança:

- **`MailboxProfile`** (1:1 com `Connection`) — o negócio daquela caixa, seu
  papel nele, objetivo, tom, assinatura, contatos VIP/alto risco, o que conta
  como urgente *ali*. É o que torna "negócios diferentes" um conceito de
  primeira classe em vez de um ajuste global.
- **`VoiceProfile`** — derivado da pasta Enviados: padrões e exemplos reais.
- **`ItemTriage`** — categoria, prioridade, precisa-resposta, confiança,
  motivo em texto, modelo e versão do prompt usados, quando. Guardar o motivo
  é o que permite você discordar de forma informada.
- **`FinancialItem`** — valor, moeda, vencimento, beneficiário, tipo, status,
  confiança, link para a mensagem de origem.
- **`DraftReply`** — mensagem original, texto gerado, confiança, estado
  (rascunho/editado/aprovado/enviado/descartado), e o texto final que você
  usou (para comparar).
- **`TriageFeedback`** — suas correções. O que faz o sistema melhorar.

---

## As decisões que preciso de você

1. **Privacidade** — a arquitetura "metadados na triagem, corpo só sob
   demanda" te serve? Ou tem caixa em que nem metadado pode sair?
2. **Por onde começar** — triagem (5A), painel financeiro (5B), ou perfil de
   voz (5C)?
3. **Quais são os negócios** — para modelar os perfis, preciso saber quantas
   caixas, o que é cada uma, e qual seu papel em cada uma.
4. **Auto-envio** — confirma que é sempre com aprovação, sem exceção?


---

# Decisões tomadas

| Questão | Decisão |
|---|---|
| Por onde começar | **5A (triagem) + 5C (perfil de voz)**, juntas |
| Cobranças | **Contas a pagar**: fornecedores com faturas, boletos, cobranças de assinatura. Não recebíveis. |
| Privacidade | **Metadados na triagem, corpo só sob demanda** |
| Auto-envio | **Decidir depois da 5D.** Até lá, sempre com aprovação |
| Calibragem | **Ajustável por caixa** (`MailboxProfile.calibration`) |

---

# Estado da implementação (5A + 5C)

## O que está construído e testado

**Modelo de dados** (`prisma/schema.prisma`): `MailboxProfile` (o negócio de
cada caixa, calibragem, VIPs), `VoiceProfile`, `ItemTriage`,
`TriageFeedback`.

**Pré-filtro determinístico** (`src/core/triage/prefilter.ts`) — decide sem
gastar chamada de API. Precedência garantida por teste: VIP vence tudo;
envio em massa vira `PROMOTIONAL` e nunca `SPAM`; cobrança com
`List-Unsubscribe` ou de remetente `no-reply` **passa para o modelo** em vez
de ser descartada (senão o painel financeiro perderia faturas de assinatura).

**Classificador** (`src/core/triage/classifier.ts`) — `claude-opus-5` com
saída estruturada validada por Zod, prompt de sistema em cache, lotes de 25.
Toda a orquestração é testada com um modelo falso: falha de API devolve
**todos** os itens com confiança 0 para revisão manual (nada some da caixa),
falha de um lote não derruba os outros, item que o modelo esqueceu de
devolver não se perde.

**Prompt** (`src/core/triage/prompt.ts`) — construído em função pura e
verificado por teste, incluindo um teste que protege a decisão de
privacidade: só remetente, assunto e trecho de 200 caracteres entram.

**Avaliação contra o histórico** (`src/core/triage/evaluate.ts`) — o gabarito
é derivado do comportamento (respondeu = precisava resposta; arquivou sem
abrir = descartável; pasta de spam = spam), e é **conservador**: quando o
sinal é ambíguo devolve `null` em vez de chutar, porque gabarito ruim produz
métrica bonita e falsa. `meetsAcceptanceCriteria` tem duas barreiras, e a
segunda não negocia: **qualquer** item escondido que o usuário respondeu
reprova, por mais alta que seja a acurácia global.

**Perfil de voz** (`src/core/voice/extract.ts`) — separa o texto autoral do
citado (marcadores do Gmail e Outlook, pt e en), descarta encaminhamentos e
respostas curtas (senão o perfil aprende que você escreve "ok"), e detecta
assinatura **por repetição** entre mensagens, não por regra de separador.

**Torre de Controle** — o card deixou de ser "não lidos" e passou a ser
"precisam de resposta", com cobranças em card próprio.

## Correção feita no caminho

O conector IMAP/CalDAV só sincronizava `INBOX` — contas Apple/IMAP ficariam
**sem perfil de voz**, já que ele vem da pasta Enviados. Corrigido:
`SENT` entra no sync. Ela alimenta o perfil sem poluir a caixa unificada,
porque `includeInUnified` continua verdadeiro só para `INBOX`.

## O que NÃO foi verificado

**A chamada real ao modelo nunca foi exercitada.** Não há
`ANTHROPIC_API_KEY` neste ambiente (a API responde 401). O que foi
verificado de fato:

- 222 testes automatizados, sendo 92 novos desta fase.
- Toda a orquestração da triagem, com um modelo falso — incluindo os modos
  de falha que importam.
- A rota `POST /api/triage/run` falha de forma limpa e explicativa sem a
  chave.
- A Torre renderizando com dados de triagem reais no banco: mostra
  "2 precisam de resposta, 1 urgente, 1 com baixa confiança".
- Sem triagem executada, o painel mostra "—" e "triagem ainda não
  executada" em vez de "0 precisam de resposta" — a mentira mais fácil
  deste painel.

**O que só aparece com chave real**: a qualidade da classificação. Nenhum
teste aqui mede se o modelo acerta — só que o sistema em volta dele se
comporta. É exatamente para isso que existe o `evaluate.ts`: rodar contra o
histórico real antes de confiar.

## Próximos passos

1. Configurar `ANTHROPIC_API_KEY` e rodar a triagem numa caixa real.
2. Rodar a avaliação contra o histórico e publicar o número.
3. UI de correção da triagem (alimenta `TriageFeedback`).
4. Tela do `MailboxProfile` — hoje o perfil de cada negócio só existe no
   banco, sem forma de editar. **É o gap mais relevante**: sem ele a
   calibragem por caixa que você escolheu não tem como ser configurada.
5. Job que deriva o `VoiceProfile` da pasta Enviados e o mostra para você
   validar.
