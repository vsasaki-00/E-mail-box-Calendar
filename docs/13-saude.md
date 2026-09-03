# 13 — Saúde do sync (Fase 6)

`/conexoes/saude` responde **uma** pergunta: por que uma caixa está
desatualizada. A Torre já diz "sync há 40min"; aqui está o histórico que
explica o 40.

Fica sob **Conexões**, e não como um 11º item na barra: a pergunta é sobre
as conexões, e é para lá que você já vai quando ela aparece.

## De onde vem o dado

De `SyncRun`, que o motor abre antes de rodar e fecha depois — **inclusive
quando falha** ([`engine.ts`](../src/core/sync/engine.ts)). Mais o estado
atual em `SyncState` e os alarmes abertos em `Alert`. Nada é coletado só
para esta tela; ela lê o que o sync já grava desde a fase 2.

A aritmética toda vive em `core/metrics/saude.ts`, que **não conhece
Prisma**. Não é cerimônia de arquitetura: é o que permite testar "corrida
órfã não entra na média" sem subir banco.

## Quatro maneiras de este painel mentir, e o que foi feito

### 1. A corrida que morreu no meio

Se um `SyncRun` ficou **aberto**, o processo morreu — quase sempre por
estouro do tempo da função. Não é hipótese: foi o que aconteceu quando o
ciclo estourou o `maxDuration` da Vercel e voltou 504.

Uma média que ignora essas corridas mostra "tudo verde" no dia em que nada
terminou. Então elas são contadas à parte (`órfãs`), **não** entram na
duração, e **não** contam como sucesso nem como falha — ninguém sabe o que
elas teriam sido.

Aberta há menos de 10 minutos é outra coisa: provavelmente está rodando
agora. O teto de execução é 60s e o ciclo se dá 45s para responder, então
10 minutos é folga de sobra para separar "rodando" de "cadáver".

Órfã **não é perda de dado**: o cursor só avança ao terminar, então a volta
seguinte refaz o trecho. É perda de tempo — e o sinal de que o ciclo está
pegando trabalho demais por execução.

### 2. O p95 sobre seis amostras

Três voltas por dia por conta dão poucas dezenas de corridas por provedor
por semana. Um p95 sobre n=6 é ruído com cara de medida, e ruído com cara de
medida é pior que ausência de medida — você age nele.

Abaixo de **20 corridas medidas** o p95 não aparece, e a tela diz por quê.
A mediana continua, que com n pequeno ainda significa alguma coisa.

O percentil é por **posto mais próximo**, sem interpolar: devolve uma
duração que alguma corrida realmente teve, em vez de uma média entre duas
que ninguém viveu.

### 3. O dia que não gerou linha

Um dia em que o agendamento não rodou **não aparece em média nenhuma** —
ele não gerou corrida para entrar na média. É o sintoma mais barato de ver
e o mais caro de descobrir tarde.

Por isso o cartão "voltas por dia" preenche o buraco com **zero** em vez de
pular o dia, e há um aviso separado contando os dias em branco.

E conta **voltas**, não corridas: seis caixas fazem doze corridas por volta,
e contar corridas faria o número subir ao conectar uma conta nova, sem o
agendamento ter mudado nada. Corridas a menos de 20 minutos de distância são
a mesma volta.

As **duas pontas da janela** ficam de fora da acusação. Às 00h30 o dia
corrente legitimamente ainda não teve volta, e "7 dias atrás" cai no meio de
um dia, cujas voltas da madrugada a própria janela cortou. Acusar qualquer
um dos dois seria alarme falso todo santo dia — o tipo de aviso que ensina a
ignorar avisos. Os dois aparecem no gráfico marcados `parcial`.

### 4. Dizer "latência do provedor"

O relógio de uma corrida cobre **buscar E gravar**. Chamar isso de "latência
do Google" culparia o provedor pelo nosso `persist`. A tela diz o que a
medida é: "buscar + gravar, não só a chamada".

E o cartão do topo mostra a **pior** mediana entre os provedores, não a
média delas: média de percentil não é percentil, e a média esconderia
justamente o provedor lento atrás dos rápidos — a única coisa que essa
métrica serve para achar.

## O que a tela mostra

| bloco | responde |
| --- | --- |
| corridas com sucesso | a saúde geral do período |
| duração de uma corrida | está lento? |
| esperando a vez | quanta coisa está vencida agora |
| por provedor | é o Google ou é a Microsoft |
| voltas por dia | o agendamento está rodando |
| por caixa e recurso | **qual** caixa, que é onde o problema mora |
| estado agora | o instantâneo: falhas seguidas, backoff, fora da fila |
| alarmes abertos | o que a Torre já teria gritado |

Período de 24 horas, 7 dias (padrão) ou 30.

"O Google está lento" quase nunca é verdade — uma caixa específica está. Por
isso o bloco por caixa × recurso existe, e por isso ele ordena por quem está
quebrado, não alfabeticamente.

## Duas contradições que a tela chegou a mostrar

Encontradas **renderizando a página com dados semeados**, não lendo o
código:

- **"em dia" ao lado de "vencido"**, na mesma linha. `IDLE` + vencido não é
  em dia: é esperando a próxima volta. Virou a pílula **"na fila"**.
- **A mensagem de erro cortada com reticências** justamente na linha que só
  existia para mostrar o erro (`...o refresh token foi revogado pel…`). O
  `.titulo-item` normal corta com reticências, o que serve para assunto de
  e-mail; ganhou a variante `.solto`, que quebra a linha.

Havia também dois plurais errados na tela — "2 corridas nunca terminou" e
"2 morreuram no meio" — que nenhum teste de unidade pegaria.

## Verificado

Vinte e nove testes de unidade sobre a aritmética, entre eles: órfã fora da
duração, p95 sumindo abaixo do mínimo, doze corridas seguidas contando como
uma volta, dia de zero aparecendo na série, e as duas pontas da janela não
virando buraco.

A tela foi renderizada com 128 corridas semeadas em 4 contas e 3
provedores, com 2 órfãs, 1 dia em branco, uma conta em `REAUTH_REQUIRED` e
um alarme aberto — nos três períodos, em 1100px e em 390px, sem overflow
horizontal.

E o portão foi conferido **ativo**: `/conexoes/saude` responde 307 para
`/entrar`. É dado privado e continua atrás da senha, ao contrário dos
arquivos do PWA ([`12-pwa.md`](12-pwa.md)).
