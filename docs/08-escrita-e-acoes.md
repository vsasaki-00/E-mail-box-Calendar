# Fase 4 — Escrita e comando

Até aqui o app era um observador: lia tudo, não mexia em nada. Esta fase
tira essa garantia — e por isso ela é construída inteira em torno de
travas, não de funcionalidades.

---

## As quatro travas

### 1. Escrita é por CAIXA, e exige consentimento novo

`Connection.writeEnabled` nasce **falso** e só muda depois de você
reautorizar aquela caixa especificamente, em `/conexoes` → "autorizar
escrita". Ligar escrita em todas as caixas de uma vez seria usar uma
permissão que você não deu.

O escopo de leitura continua sendo o padrão de toda conexão nova. Um teste
falha se algum escopo de escrita entrar na lista de leitura.

**O que decide é o que o provedor CONCEDEU, não o que pedimos.** O Google e
o Microsoft deixam você desmarcar permissões na tela de consentimento e o
fluxo volta com sucesso mesmo assim. `evaluateWriteGrant` compara os
escopos que vieram no token; faltando um, a escrita **não** é ligada e a
tela diz qual faltou. Falhar depois que você confirma é pior do que recusar
antes.

Reconectar uma caixa em modo leitura **não desliga** a escrita já
concedida: consertar o sync não pode revogar em silêncio uma permissão que
você deu de propósito.

### 2. Não existe ação de excluir

O catálogo de ações é fechado e **não tem `DELETE`**. A ausência é
deliberada, pelo mesmo motivo de `DraftStatus` não ter "enviado" antes
desta fase: um enum com `DELETE` convidaria a primeira pessoa apressada a
ligar a exclusão automática.

Arquivar resolve o mesmo problema e volta atrás. Apagar é o único erro que
você nunca descobre, porque a evidência do erro vai junto.

Dois testes guardam isso: um sobre o catálogo, outro varrendo os
conectores por qualquer método com nome de exclusão.

No Gmail pedimos `gmail.modify`, e não `mail.google.com`. O primeiro
permite arquivar, marcar lido, rotular e enviar, mas **não permite excluir
definitivamente**. Pedir permissão que não se usa é deixar a chave reserva
embaixo do tapete.

### 3. O agente propõe o reversível; o irreversível é só seu

| | Agente pode pedir | Precisa confirmação em duas etapas |
|---|---|---|
| Arquivar, marcar lido, rotular | sim | não |
| Responder convite, mover evento | sim | não |
| **Enviar resposta** | **não** | **sim** |
| **Criar evento** | **não** | **sim** |

Enviar e criar evento são as ações que **outras pessoas recebem**. É a
linha entre "o app trabalha para mim" e "o app fala por mim sem eu ver".

A confirmação não transfere autoria: mesmo confirmado, o agente continua
não podendo pedir um envio. E a trava vale nas **duas etapas** — se o
agente pudesse ao menos enfileirar, bastaria um clique distraído.

E a trava da fase 5D continua valendo: enviar um rascunho exige que ele
esteja **aprovado por você** em `/rascunhos`.

### 4. Fila e log de auditoria são a mesma lista

Um log separado da fila diverge dela, e aí você tem dois registros
discordando sobre o que o app fez na sua caixa. E um registro que some
quando você desfaz não é auditoria — desfazer marca `UNDONE`, não apaga.

Cada ação guarda `previousState`, lido **antes** de executar. Sem isso,
"desfazer" seria um chute sobre como a caixa estava.

---

## Dois bugs que a verificação contra o banco encontrou

**`buildContext` estava fora do `try`.** O arquivo promete "nunca lança: a
falha vira `FAILED` com a mensagem". Mas a leitura de credenciais
acontecia antes do bloco, então uma conexão sem token **estourava** em vez
de registrar. A ação sumiria do log exatamente no caso em que você mais
precisa dela.

**A política recusava enfileirar ação irreversível.** Eu passava
`explicitlyConfirmed: isReversible(kind)` no pedido, o que recusava um
envio antes mesmo de ele chegar na fila — impedindo a ação de alcançar a
tela onde você a confirmaria. Corrigido com um `stage: REQUEST | EXECUTE`
explícito: enfileirar não toca na caixa; só executar precisa de
confirmação.

---

## O que foi verificado

Ciclo completo contra o banco real, com as sete travas:

| Cenário | Resultado |
|---|---|
| Arquivar com caixa em somente-leitura | `ESCRITA_NAO_AUTORIZADA` |
| Agente pedindo envio | `AGENTE_NAO_PODE_PEDIR` |
| Você pedindo arquivar | enfileirado como `PENDING`, reversível |
| Executar sem credencial | `FAILED` no log — **não some** |
| Enviar sem confirmação | `IRREVERSIVEL_SEM_CONFIRMACAO` |
| Enviar com rascunho não aprovado | `RASCUNHO_NAO_APROVADO` |
| Desfazer algo irreversível | recusado, registro permanece |

498 testes no total, 31 desta fase.

## O que NÃO foi verificado

**Nenhuma escrita real aconteceu.** Não há conta conectada nem token neste
ambiente — o teste acima chega até a borda e para no ponto onde a chamada
sairia. O código segue as APIs documentadas do Gmail e do Graph, mas a
primeira ação numa caixa de verdade é onde isso vai ser posto à prova.

**Recomendação forte**: a primeira caixa a autorizar escrita deve ser uma
secundária, e a primeira ação deve ser um `MARK_READ` — reversível,
inofensiva, e suficiente para provar que o caminho inteiro funciona.

**IMAP/CalDAV não escreve.** Declara `write: false` pelo mesmo motivo de
sempre: nunca foi validado contra servidor real, e declarar o contrário
faria o app tentar e falhar em silêncio numa caixa Apple.
