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

**Perfil de voz** (`src/core/voice/`) — `extract.ts` separa o texto autoral
do citado (marcadores do Gmail e Outlook, pt e en), descarta encaminhamentos
e respostas curtas (senão o perfil aprende que você escreve "ok"), e detecta
assinatura **por repetição** entre mensagens, não por regra de separador.
`body-text.ts` normaliza os três formatos de corpo que os conectores
devolvem — sem ele o perfil do Microsoft aprenderia tags HTML e o do IMAP
aprenderia cabeçalhos de e-mail. `persist.ts` é o job que busca os corpos
que faltam, monta o perfil e o salva. Tela em `/voz`, descrita abaixo.

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

- 256 testes automatizados, sendo 126 novos desta fase.
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
3. ~~UI de correção da triagem~~ ✅ **entregue** — `/triagem`. Ver abaixo.
4. ~~Tela do `MailboxProfile`~~ ✅ **entregue** — `/perfis`. Ver abaixo.
5. ~~Job que deriva o `VoiceProfile` da pasta Enviados~~ ✅ **entregue** —
   `/voz`. Ver abaixo.
6. Decidir a fase 5B (extração para o painel financeiro) ou a 5D (rascunhos
   com aprovação) como próximo bloco.

---

# Tela de perfis (`/perfis`) ✅

Os seis contextos são uma **lista fixa**, não texto livre:

`Unitedcom` · `Cordex.AI` · `Brand.co` (palestras/treinamentos) ·
`EmpreendaSim` · `Outros` · `Pessoais`

O motivo é que o nome do negócio **entra no prompt de triagem**: "Cordex.AI",
"cordex.ai" e "Cordex" produziriam contextos diferentes para o modelo entre
caixas que deveriam ser tratadas igual.

**Por caixa se define**: negócio, seu papel nele, objetivo (texto livre, vai
direto no prompt), calibragem, remetentes VIP e palavras que indicam urgência
naquele negócio.

**Defaults por contexto, deliberadamente magros.** Caixa de negócio nasce
`CONSERVATIVE` — esconder o primeiro e-mail de um cliente novo é um dano que
você nunca fica sabendo; `Pessoais` nasce `AGGRESSIVE`, porque é cheia de
newsletter e perder uma não custa nada. Palavras-chave sugeridas **só para
Brand.co**, o único contexto cuja área você me informou. Chutar palavras para
Unitedcom, Cordex.AI ou EmpreendaSim viraria instrução errada dentro do
prompt de toda mensagem daquelas caixas — então elas nascem vazias, para você
preencher.

Trocar o negócio aplica os defaults **apenas em caixa ainda sem perfil
salvo**; nunca sobrescreve o que você já escreveu.

**Verificado**: a tela renderiza com os seis contextos; salvar normaliza e
deduplica as listas (`Cliente@Grande.com, grande.com, cliente@grande.com` →
`["cliente@grande.com", "grande.com"]`); e o perfil salvo **chega de fato ao
prompt** — confirmado que negócio, papel, objetivo, calibragem e
palavras-chave aparecem no texto gerado por `buildSystemPrompt`.


---

# Tela de triagem (`/triagem`) ✅

**Ordenada pelo que exige ação, não por data.** Urgente primeiro; entre itens
de mesma prioridade, o de **menor confiança** vem antes — é o que mais precisa
do seu olho. Ordenar por data faria a lista virar uma caixa de entrada comum,
que é exatamente o que este produto existe para não ser.

Quatro filtros: **Precisam de ação** (padrão) · **Revisar (baixa confiança)** ·
**Cobranças** · **Tudo**.

Cada linha mostra a categoria, a prioridade, e **o motivo da classificação**
com a confiança — é isso que permite discordar de forma informada, em vez de
só ver um rótulo. Itens com confiança abaixo de 60% ganham uma faixa lateral
e nunca somem da lista.

O botão é **"discordo"**, e a correção fica escondida atrás dele de propósito:
a lista precisa ser escaneável em segundos, e seis selects abertos em cada
item transformariam a triagem num formulário.

**A garantia que importa**: corrigir marca a linha como `source: USER` com
confiança 1, e **nenhuma reclassificação futura sobrescreve isso**. Verificado
em execução real — o modelo tentou reclassificar um item corrigido como SPAM
e foi bloqueado (`skippedUserOverride: 1`), categoria intacta.

Cada correção grava um `TriageFeedback` com o de-para
(`INFORMATIVE → COBRANCA`, `LOW → URGENT`). É o insumo que faz o sistema
melhorar; sem capturá-lo, você desistiria dele em três semanas.

O rodapé mostra quantos itens foram classificados, quantos faltam e quantas
correções suas já foram registradas.

**Verificado**: os quatro filtros retornando o conjunto certo; ordenação por
urgência; selo "corrigido por você" após a correção; item migrando de filtro
ao ser recategorizado; e o bloqueio de sobrescrita descrito acima.

---

# Tela do perfil de voz (`/voz`) ✅

**O perfil é derivado, não declarado.** Ninguém descreve o próprio jeito de
escrever com precisão — e você já escreve diferente em cada negócio, sem
nunca ter escrito isso em lugar nenhum. A prova está gravada na sua pasta
Enviados: o job lê até 60 mensagens enviadas daquela caixa e extrai o
padrão.

**Nada sai da sua máquina aqui.** Este job **não faz nenhuma chamada a API
de modelo** — todo o processamento é local, com funções puras. É a operação
mais invasiva do sistema em termos de dados (lê o corpo do que você
escreveu) e a menos invasiva em termos de exposição. Diferente da triagem,
que envia metadados, e da redação (5D), que enviará o thread sob demanda.

O que o perfil captura, por caixa: como você começa, como você termina, a
assinatura, o tamanho típico da sua mensagem, o registro (formal / neutro /
informal), o idioma e traços observados.

**A despedida e a assinatura são campos separados.** Bug encontrado rodando
contra um corpus realista: como `Abraço,` repetia junto do bloco final, a
assinatura detectada saía `"Abraço,\nVictor Sasaki\nBrand.co"` — a despedida
contada duas vezes, o que produziria `Abraço,` duplicado no rascunho da 5D.
Corrigido: o bloco candidato a assinatura começa **depois** da despedida.

**O perfil é uma proposta até você confirmar.** A tela pergunta "É assim que
você escreve nesta caixa?" e aceita uma correção em texto livre. Separar a
validação da geração é deliberado: julgar "é assim que eu escrevo?" é muito
mais fácil, e muito mais confiável, do que julgar um texto já gerado — que
é onde a maioria das ferramentas de rascunho falha.

**Derivar de novo reseta a validação.** Você aprovou um perfil específico;
o novo é outro. Fingir que a aprovação antiga vale seria mentir sobre o
único sinal que autoriza a fase 5D.

Quando não há material suficiente, a tela diz **por quê** — "encontrei 9
mensagens enviadas, mas só 3 serviram (o resto é encaminhamento ou resposta
curta demais)" — em vez de só dizer que falhou. Sem isso você não saberia se
o problema é a caixa ou o sistema. Abaixo de 5 amostras úteis o perfil não é
salvo: perfil magro induz rascunho ruim.

**Verificado** contra um corpus de 9 mensagens montado para exercitar o
ruído real da pasta Enviados (5 respostas autorais, 1 encaminhamento, 2
confirmações curtas, 1 resposta com trecho citado): 6 amostras entraram e 3
foram descartadas pelo motivo certo; o trecho citado foi cortado; a
despedida saiu do bloco de assinatura; e `userApproved` voltou a `false` na
rederivação. Os dados de teste foram removidos do banco depois.

**O que NÃO foi verificado**: a derivação contra uma caixa real e grande.
O corpus acima é sintético, ainda que realista. O primeiro perfil derivado
de uma conta de verdade é onde a lista de saudações e a detecção de
assinatura vão ser postas à prova — e é exatamente por isso que a tela pede
sua validação antes de qualquer rascunho existir.

---

# Painel financeiro (`/financeiro`) ✅ — fase 5B

## A decisão central: o modelo não pode ser a fonte da linha digitável

Um modelo de linguagem que troca um dígito produz **um pagamento para o
lugar errado**. Do lado do dinheiro isso é irreversível. Então a extração
tem três camadas com autoridade decrescente, e ela não inverte:

1. **Instrumento de pagamento** — boleto e PIX carregam dígito verificador.
   Manda.
2. **Texto rotulado** — "Valor total: R$ ...", "Vencimento: ...".
3. **Modelo** — só o que sobrou, e com **teto de confiança de 0,5**.

A linha digitável de um boleto de título carrega o **próprio valor e o
próprio vencimento**. Quando ela está presente, esses dois campos não
dependem de nenhum modelo acertar — saem de aritmética. O mesmo vale para o
valor num PIX copia e cola.

## O que é lido localmente, sem nenhuma chamada de API

- **Linha digitável de título (47 dígitos)**: três dígitos verificadores de
  campo (módulo 10), DV geral (módulo 11), valor, e vencimento a partir do
  fator.
- **Linha de arrecadação/convênio (48 dígitos)**: DVs dos quatro blocos, e
  valor apenas quando o indicador diz que é valor efetivo em real — os
  indicadores 7 e 9 são "valor referência" (quantidade de moeda), e tratar
  isso como dinheiro num painel de contas a pagar seria erro grave.
- **PIX copia e cola (BR Code EMV)**: TLV completo, CRC-16, chave, valor,
  beneficiário.

**O fator de vencimento estourou em 2025.** O fator chegou a 9999 em
21/02/2025 e reiniciou em 1000 no dia seguinte. Sem tratar isso, todo boleto
emitido depois dessa data viraria uma data do fim dos anos 1990, e o painel
diria "vencida há 27 anos". A leitura calcula os dois candidatos e escolhe o
mais próximo de hoje.

## A ressalva honesta: o DV geral não pôde ser verificado

Os **três DVs de campo (módulo 10) estão verificados** contra uma linha
digitável real — os três fecham, o que também prova que o parsing dos campos
está certo.

O **DV geral (módulo 11) não pôde ser verificado**: a única linha real que
tenho à mão não fecha esse dígito, e não há rede neste ambiente para buscar
uma referência. Ele segue a especificação FEBRABAN, mas pode estar errado.

Isso teve uma consequência de projeto que os testes pegaram. A primeira
versão exigia **todos** os DVs para aceitar valor e vencimento do
instrumento. Se a minha implementação do módulo 11 estiver errada, isso
faria **todo boleto real cair calado para o modelo** — e o painel
continuaria parecendo funcionar. Modo de falha silencioso, o pior tipo.

A versão final entra pelo DV **verificado** (módulo 10) e usa o não
verificado só para **rebaixar a confiança de 0,95 para 0,75 e emitir um
aviso**. Erro visível em vez de erro silencioso.

Há uma lacuna real por trás disso, e ela está documentada em teste: o campo
5 da linha digitável (fator de vencimento + valor) **não tem DV próprio** —
só o DV geral o cobre. Trocar um dígito do valor passa batido pelos três
módulo 10. É exatamente por isso que o aviso existe e que a tela manda
conferir no e-mail original.

## Privacidade: é aqui que o corpo passa a ser lido

Mudança deliberada em relação à triagem, e é exatamente a decisão que você
tomou ("metadados na triagem, **corpo sob demanda**"). Este é o sob demanda.
O escopo é estreito, e a garantia começa na consulta ao banco:

- só mensagens que a 5A já classificou como `COBRANCA`;
- no máximo 4.000 caracteres por e-mail no prompt;
- e boa parte **nem chega ao modelo**, porque boleto e PIX se resolvem
  localmente.

Sem `ANTHROPIC_API_KEY` o painel **continua funcionando** com a camada
local. Um painel que só funciona com chave seria pior do que um painel
parcial e honesto.

## As mentiras que esta tela se recusa a contar

- O total em aberto **exclui** cobranças sem valor identificado, e diz isso:
  "1 sem valor identificado — não estão nesse total". Somar zero as
  esconderia.
- Uma extração sem valor nem vencimento mostra "nada identificado
  automaticamente", não "estimado pelo modelo" — não houve palpite nenhum a
  atribuir.
- Cada cobrança mostra **de onde veio o número** (lido do boleto / lido do
  corpo / estimado pelo modelo) e a confiança.
- Uma linha digitável que não fecha o DV **aparece com o aviso**, nunca é
  descartada em silêncio. Descartar faria a cobrança sumir do painel, que é
  o pior modo de falha desta fase.
- O topo da tela declara que é detecção automática e **não é garantia de
  completude** — uma cobrança que chegou só como PDF anexo não aparece.

## O agente nunca marca nada como pago

`PENDING` / `PAID` / `IGNORED` é sempre ação sua. E reextrair **não pode
desfazer** o que você marcou: o `status` fica de fora do update, e uma linha
com `source: USER` nunca é sobrescrita — mesma regra da triagem, verificada
em execução real (corrigi para R$ 175,00, marquei como paga, reextraí: valor
e status intactos).

## O que foi verificado

- **53 testes** só desta fase, sendo os do CRC ancorados no **vetor canônico
  do CRC-16/CCITT-FALSE** (`CRC("123456789") = 0x29B1`) — sem essa âncora,
  todo teste de PIX seria circular.
- Execução real ponta a ponta contra o banco, **sem chave de API**: boleto
  lido (R$ 150,00, vencimento 24/05/2022, direto da linha), fatura lida do
  corpo (R$ 209,90, total e não o item de R$ 89,90), e um e-mail sem dado
  nenhum devolvendo "nada identificado" em vez de inventar.
- A tela renderizando com os três casos e com o total honesto.

## O que NÃO foi verificado

- **O DV geral (módulo 11)**, pelo motivo acima.
- **A chamada real ao modelo**, pelo mesmo motivo de sempre: não há
  `ANTHROPIC_API_KEY` neste ambiente. Toda a orquestração está testada com
  um modelo falso, incluindo falha de API e item ausente na resposta.
- **Cobrança em anexo PDF.** Não é lida. É a lacuna mais provável de te
  morder, e por isso está declarada na própria tela.

---

# Rascunhos com aprovação (`/rascunhos`) ✅ — fase 5D

## A regra desta fase

**Nada aqui envia e-mail.** Não é um envio desligado por configuração — é a
**ausência da capacidade**. Não há dependência de SMTP no projeto, não há
chamada de envio nos conectores, e o enum `DraftStatus` **não tem estado
"enviado"**: a ausência é proposital, porque um enum com `SENT` convidaria a
primeira pessoa apressada (eu inclusive) a ligar o envio.

Há uma segunda barreira, independente do código: os **escopos OAuth
continuam somente-leitura** (`gmail.readonly`, `Mail.Read`). Mesmo que
alguém escrevesse um envio, o token não teria permissão. Dois testes
guardam isso — um falha se aparecer qualquer função com nome de envio nos
módulos de rascunho, outro falha se um escopo de escrita entrar na lista.

"Está bom, vou usar" registra que você aprovou o texto. Copiar e mandar é
você, do seu cliente de e-mail.

## A decisão de projeto: o modelo escreve só o miolo

Mesma lógica da 5B — o que pode ser determinístico, é. O modelo recebe
instrução explícita de **não escrever saudação, despedida nem assinatura**.
Essas três são compostas localmente, a partir do perfil que você validou:

```
{sua saudação, com o nome de quem escreveu}

{miolo escrito pelo modelo}

{sua despedida}
{sua assinatura, exata}
```

Por que isso importa:

- A **assinatura sai caractere por caractere** do seu perfil, não uma
  paráfrase que o modelo achou parecida com a sua.
- A **despedida** é a que você mais usa, contada da sua pasta Enviados.
- A **saudação** segue a sua forma real: o perfil aprendeu `"Oi Camila,"`, e
  o sistema troca o nome mantendo a forma → `"Oi Marina,"`. Se a sua forma
  exige nome (`"Prezado João,"`) e o remetente não tem nome utilizável, ele
  **não saúda** em vez de escrever `"Prezado,"`.
- Endereço de sistema não vira nome: `no-reply@`, `financeiro@`, `billing@`
  devolvem `null`. `"Oi Noreply,"` seria a coisa mais denunciadora possível.
- E o perfil de voz deixa de ser tempero de prompt e passa a fazer
  **trabalho mecânico verificável**.

Há uma defesa em profundidade: se o modelo desobedecer e escrever saudação e
despedida mesmo assim, elas são **removidas antes da composição**. A remoção
usa exatamente o mesmo `isClosingLine` que derivou o perfil na 5C — duas
listas separadas divergiriam e a duplicação voltaria. **Verificado em
execução real com um modelo que desobedece de propósito**: ele devolveu
`"Oi Marina,\n\n...\n\nAbraço,\nVictor"`, e o texto final saiu com
exatamente uma saudação, uma despedida, e a assinatura completa
(`Victor Sasaki\nBrand.co`) no lugar do `"Victor"` que o modelo escreveu.

## A trava que faz a fase 5C valer alguma coisa

**Rascunho só é gerado com perfil de voz que você validou.** Sem essa
recusa, a 5C teria sido decorativa: a validação é o único sinal de que o
perfil representa você.

A recusa é um **resultado legítimo**, não um erro, e diz o que fazer:

| Situação | O que a tela diz |
|---|---|
| Caixa sem perfil de voz | derive o perfil em `/voz` primeiro |
| Perfil existe, não validado | valide em `/voz` antes de gerar |
| Mensagem sem corpo carregado | sincronize a conta primeiro |
| Sem `ANTHROPIC_API_KEY` | aqui **não há** camada local que substitua |

Essa última linha é uma diferença honesta em relação à 5B: o painel
financeiro funciona sem chave, porque boleto e PIX são aritmética. Rascunho
não tem esse substituto, e a tela diz isso em vez de fingir.

## Privacidade

Aqui vai o corpo da mensagem a ser respondida — não há como responder sem
ler. Continua sendo **corpo sob demanda**, e o escopo é o mais estreito de
todo o sistema: **um item por vez, quando você clica em "gerar rascunho"
naquele item**. Nunca em lote pela caixa. A geração em lote seria
exatamente a porta de entrada para o envio automático, que esta fase não
tem.

## Sua instrução tem precedência

O campo "o que você quer nesta resposta?" (`recuse educadamente, agenda
cheia até novembro`) entra no prompt marcado como tendo **precedência**
sobre o que o modelo concluiria sozinho — você sabe do negócio o que o
e-mail não diz. E a **sua correção sobre o perfil de voz** (o texto livre
que você escreveu em `/voz`) entra por último no prompt de sistema, depois
do perfil derivado, porque foi você quem escreveu olhando para ele.

## Sua edição é o sinal

`bodyGenerated` (o miolo cru) e `bodyEdited` (o que você deixou) ficam
**guardados separados**. A distância entre os dois é a única medida honesta
de se o rascunho está ficando bom. O rodapé mostra "N rascunhos gerados, M
editados por você" — sem capturar isso, você desistiria da ferramenta em
três semanas sem saber dizer por quê.

Regerar zera a edição anterior: o texto editado era de outro rascunho, e
mantê-lo faria a tela mostrar uma edição que não bate com o que está ali.

## O que foi verificado

- **35 testes** desta fase, incluindo os dois guardas de "não envia".
- O prompt levando perfil de voz, negócio, papel e objetivo daquela caixa —
  e um teste de que o perfil de **outra** caixa não vaza (responder um
  cliente da Unitedcom com a voz do e-mail pessoal seria o pior erro
  possível de um sistema multi-negócio).
- Execução real contra o banco: recusa com perfil não validado, geração com
  perfil validado, e a composição corrigindo um modelo desobediente.
- A tela renderizando com o rascunho e os quatro botões.

## O que NÃO foi verificado

- **A qualidade do texto gerado.** Nenhum teste aqui mede se o rascunho soa
  como você — só que o sistema em volta se comporta. Sem
  `ANTHROPIC_API_KEY` neste ambiente, o modelo real nunca escreveu uma
  linha. É a limitação mais importante desta fase, e a única forma de
  resolvê-la é você ler os primeiros rascunhos de uma caixa real.
- **Thread completa.** O prompt leva só a última mensagem, não a conversa
  inteira. Para a maioria das respostas basta; para uma negociação longa,
  não.

---

# Automação pós-sync (o worker trabalhando sozinho)

Até aqui você precisava clicar em "rodar triagem" e "extrair cobranças". O
worker agora faz os dois depois de cada sync, em **intervalo próprio** (15
min por padrão, contra 5 min do sync): sync só custa quota do provedor,
triagem custa dinheiro por chamada, e não há valor em reclassificar de cinco
em cinco minutos.

## O que NÃO roda sozinho

**Rascunho.** Gerar resposta automaticamente para tudo é o degrau anterior a
enviar automaticamente, e a fase 5D existe justamente para manter você no
meio do caminho. Rascunho continua sendo um por vez, quando você pede.

## Teto de gasto diário

A automação gasta a cada ciclo. Sem teto, uma enxurrada de e-mail, um
provedor devolvendo a caixa inteira depois de um cursor expirado, ou
simplesmente a primeira sincronização de uma caixa antiga viram uma conta
alta que você só descobre no fim do mês.

| Variável | Padrão | O que limita |
|---|---|---|
| `AUTO_TRIAGE_DAILY_LIMIT` | 1500 | itens classificados **pelo modelo** por dia |
| `AUTO_BILLS_DAILY_LIMIT` | 200 | cobranças que precisaram do modelo por dia |
| `AUTOMATION_INTERVAL_SECONDS` | 900 | de quanto em quanto tempo roda |
| `AUTO_PIPELINE` | `true` | `false` desliga tudo (o sync continua) |

Três decisões dentro disso:

**O consumo é derivado, não contado.** O gasto do dia sai das linhas que a
automação realmente gravou (`source: MODEL` com data de hoje), e não de um
contador em tabela separada. Contador próprio dessincroniza do que
aconteceu — e um contador que mente sobre gasto é pior do que não ter
contador.

**Só o que o modelo decidiu conta.** O pré-filtro determinístico resolve boa
parte sem gastar chamada nenhuma; incluir isso no teto faria o orçamento
acabar sem ter havido gasto.

**Há teto por ciclo além do teto diário.** Sem ele, o primeiro sync de uma
caixa antiga queimaria o orçamento do dia inteiro numa rodada só.

Um detalhe que o teste trava: valor inválido em `AUTO_TRIAGE_DAILY_LIMIT`
(um `"muito"` digitado por engano) **cai no padrão**, nunca vira `NaN` —
comparação com `NaN` é sempre falsa, e o teto sumiria em silêncio, que é
exatamente o modo de falha que um teto de gasto não pode ter.

E quando o orçamento acaba, o worker **avisa no log**: um sistema que para
de trabalhar em silêncio parece um sistema quebrado.

## Cobranças rodam mesmo sem chave de API

A extração financeira tem camada local (boleto e PIX são aritmética), então
ela roda com `hasApiKey: false` e sem consumir orçamento. Só o que o modelo
faria é que não acontece — a cobrança continua aparecendo no painel, com
valor e vencimento lidos da linha digitável.

## Idempotência

A triagem só pega itens sem triagem; a extração só pega cobranças sem
extração. Rodar duas vezes seguidas não refaz trabalho nem gasta duas vezes.
**Verificado em execução real**: segunda rodada devolveu `NADA_PENDENTE` em
todas as caixas.

## Verificado

Contra o banco, no estado real deste ambiente (sem `ANTHROPIC_API_KEY`):

- sem chave → triagem pula com `SEM_CHAVE_DE_API`, mas a **cobrança foi
  extraída assim mesmo**: R$ 150,00, vencimento 24/05/2022, direto da linha
  digitável;
- segunda rodada → `NADA_PENDENTE` (idempotente);
- `AUTO_PIPELINE=false` → `DESLIGADO`;
- `AUTO_TRIAGE_DAILY_LIMIT=0` → `ORCAMENTO_ESGOTADO`.

---

# Cobrança em anexo PDF

Era a lacuna declarada da fase 5B, e a mais provável de morder: **"segue o
boleto em anexo"**, com o corpo do e-mail sem nenhum dado. Sem ler o anexo,
a cobrança simplesmente não existe para o sistema — e o painel diria "nada
vencendo" com um boleto vencendo.

## O que foi feito

**Contrato de conector**: `capabilities.attachments` e um método opcional
`fetchAttachments`. Declarado em vez de assumido — o núcleo consulta a
capacidade e não tenta onde ela é falsa, sem ramificar por provedor.

| Conector | `attachments` | Por quê |
|---|---|---|
| Google | `true` | duas chamadas: a estrutura traz o `attachmentId`, o conteúdo vem depois |
| Microsoft | `true` | uma chamada: o Graph já embute `contentBytes` |
| IMAP/CalDAV | **`false`** | o protocolo saberia, mas este conector nunca foi validado contra servidor real |

Esse `false` é deliberado. Declarar `true` faria o painel tentar e falhar em
silêncio numa caixa Apple; declarar `false` faz ele simplesmente não tentar,
e a limitação fica visível em vez de virar um bug intermitente.

## Extração

`src/core/finance/pdf.ts`, com a paranoia que um parser de arquivo externo
exige:

- **Formato verificado pela assinatura** (`%PDF-`), não pelo nome nem pelo
  `content-type`: os dois vêm de quem mandou o e-mail, e alimentar o parser
  com o que o remetente *disser* que é um PDF é confiar em desconhecido.
- Teto de 10MB por arquivo, 10 páginas, 40 mil caracteres.
- **Nunca lança**: PDF protegido por senha ou corrompido devolve o motivo, e
  a cobrança continua aparecendo com o que deu para ler do corpo.

## Dois bugs encontrados construindo isto

**O pdfjs se apropria do buffer que recebe.** Depois de ler um anexo, o
`Uint8Array` do chamador ficava *detached* — `length` virava 0. O sintoma
apareceu longe da causa: `selectPdfAttachments` passou a devolver vazio
depois que outro teste leu o mesmo PDF. Se tivesse ido para produção,
apareceria como "o anexo sumiu". Corrigido passando uma cópia, com teste que
trava isso.

**"O corpo já resolveu?" estava medido errado.** Eu checava se havia valor
*rotulado em texto*, ignorando que um boleto válido **já carrega valor e
vencimento no próprio código**. O efeito seria abrir o anexo de toda
cobrança que já tinha boleto no corpo — gastando quota para reconfirmar o
que já sabia. O teste pegou.

## As regras de quando abrir

- Só cobranças **cujo corpo não trouxe instrumento de pagamento**. Abrir PDF
  de todo mundo gastaria quota à toa.
- No máximo **15 anexos por execução** (contra 40 corpos): anexo pesa
  megabytes.
- O **corpo tem precedência campo a campo**. Quando os dois trazem o dado,
  vale o que o remetente escreveu para você ler.
- A justificativa diz **de qual arquivo veio** ("lido do anexo boleto.pdf"),
  para você saber onde conferir se discordar.

## O que foi verificado, e o que não

**Verificado**: a extração de texto ponta a ponta, contra um PDF real
gerado no próprio teste (em ASCII, para dar para ver o que ele contém). A
linha digitável sobrevive à formatação do PDF e é parseada corretamente; o
valor e o vencimento saem certos; PDF corrompido, grande demais, vazio e
"não é PDF" devolvem o motivo sem lançar.

**NÃO verificado**: o download em si, no Gmail e no Graph. Não há conta
conectada nem token neste ambiente. O código segue as APIs documentadas de
cada um, mas é a mesma ressalva de sempre — o primeiro anexo real é onde
isso vai ser posto à prova.


## Ler o e-mail para validar a classificação

A tela de triagem foi desenhada para ser escaneável: assunto, remetente,
trecho, motivo, confiança. Na prática, para dizer "concordo" ou "discordo"
com segurança, muitas vezes é preciso **ler**. Sem isso a correção vira
palpite sobre palpite.

O botão **ler**, ao lado do "discordo", abre o corpo contraído na própria
linha. Três decisões nele:

- **Só o texto novo, por padrão.** Num "Re: Re: Re:" o corpo inteiro é
  quase todo citação. O separador de texto autoral × citado do perfil de
  voz (`extractAuthoredText`) corta no primeiro "Em ... escreveu:" e tira
  as linhas com `>`. "Ver tudo" fica a um clique.
- **HTML só em sandbox, sem imagem remota.** Ver `04-seguranca.md`.
- **Link para abrir no provedor** (Gmail ou Outlook, na conta certa, na
  mensagem certa). Responder e ver anexo continuam sendo lá.

O que isto **não** muda: a triagem continua classificando só com metadados.
Ler o corpo é ato humano, e o corpo não vai para o modelo por causa disto.

### Triagem profunda — decisão adiada, com critério

Fica registrada a opção de o modelo receber um trecho limitado do corpo
(sem citação, sem assinatura) quando a classificação por metadados sair
com confiança baixa — **por caixa e opt-in**, porque corpo de e-mail de
negócio saindo da infra tem implicação com cliente. A decisão é para depois
de umas duas semanas de correções: aí dá para medir *quantas correções
teriam sido evitadas lendo o corpo* em vez de decidir por intuição.
