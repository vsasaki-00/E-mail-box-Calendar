# 05 — Torre de Controle

A tela de comando. Responde em 5 segundos: **está tudo sob controle?**

Não é um dashboard de vaidade com gráficos bonitos — cada bloco existe porque
leva a uma ação.

## Blocos

### 1. Saúde das conexões
Um card por conta, com o `status` da `Connection`, o horário do último sync
bem-sucedido e o último erro. Ação direta no card: *Reconectar*, *Sincronizar
agora*, *Desativar*.

Regra: **conta sem sync há mais de 1,25× a cadência do agendamento vira
alerta** — hoje 15 h, porque o agendamento roda 3× por dia (10 h, 16 h e 22 h
UTC) e o maior vão normal é o da noite, 12 h. Ajustável por
`SYNC_EXPECTED_INTERVAL_MINUTES`.

Silêncio não é sinal de saúde — é o modo de falha mais comum de agregadores.
Mas a régua tem que ser a da implantação, não a do conector. A primeira versão
usava o `pollIntervalSeconds` que o conector declara (300 s) vezes 3: 15
minutos. Só que `pollIntervalSeconds` responde "com que frequência **dá para**
me ler", e não "com que frequência **sou** lido" — quem responde a segunda é o
agendamento. Resultado: toda conexão ficava vermelha o tempo inteiro, menos nos
15 minutos seguintes a um sync, e a Torre carregava seis alertas permanentes.
Um alarme que nunca desliga ensina a ignorar todos os alarmes.

**A idade é a do recurso mais atrasado, não a do último sync qualquer.**
`Connection.lastSyncAt` é gravado quando QUALQUER recurso termina bem, e por
isso é otimista por construção: com o e-mail rodando e a agenda parada, o
campo diz "sincronizei agora" e esconde exatamente a metade que quebrou —
falha que já aconteceu aqui, quando o e-mail ganhava sempre o desempate e o
calendário nunca rodava. Uma conta vale o seu pior recurso
(`frescorDaConexao`), e a tela diz qual é ele: *"sync há 22h (agenda)"*.

**Uma etiqueta só, em `core/metrics/estado-conexao.ts`.** A Torre e a tela de
Conexões tinham cada uma a sua cópia do vocabulário, e elas discordavam: a
Torre conhecia "atrasada" e Conexões não, então a mesma conta aparecia
"atrasada" numa e "ativa" na outra. Duas verdades sobre o mesmo fato é o jeito
mais rápido de o usuário parar de acreditar nas duas. Quem mostra estado de
conexão — Torre, Conexões, alertas — chama `estadoDaConexao` e
`descreverIdade` de lá.

### 2. Agenda do dia unificada
Todos os eventos de todas as contas, em uma faixa de tempo, coloridos por
conexão. Conflitos (sobreposição) aparecem destacados, porque essa é a única
coisa que ninguém enxerga hoje.

### 3. Conflitos e riscos
- Sobreposição de eventos entre contas diferentes.
- Reunião sem sala/link.
- Convite pendente de resposta com o evento já a menos de 24 h.
- Viagem/voo detectado no e-mail sem bloqueio correspondente na agenda.

### 4. Backlog de triagem
Quantos itens não lidos exigem ação, por conta e no total, com a idade do item
mais velho. A métrica que importa não é "quantos não lidos" — é **quanto tempo
o mais antigo está esperando**.

### 5. SLA de resposta
E-mails onde você é destinatário direto, marcados como "precisa resposta", sem
resposta enviada há mais de N dias. Configurável por remetente/domínio.

### 6. Métricas de atenção (semanal)
- Horas em reunião, por conta e por categoria.
- Blocos de foco disponíveis (janelas livres ≥ 90 min).
- Top remetentes por volume e por tempo de resposta exigido.

## Modelo de alertas

`Alert` tem `severity` (`INFO | WARN | CRITICAL`), `dedupeKey` e
`acknowledgedAt`. O motor de métricas roda a cada ciclo, recalcula os alertas e
faz *upsert* pelo `dedupeKey` — assim um mesmo conflito não vira 40 alertas ao
longo do dia, e um alerta reconhecido não volta a piscar até mudar de estado.

## Desempenho

Todos os blocos são agregações sobre `UnifiedItem`, `CalendarEvent` e
`Connection` — nunca chamadas ao vivo aos provedores. A tela tem que abrir
instantaneamente mesmo com todas as contas fora do ar; ela mostra o *estado
conhecido* e a idade desse estado, o que é justamente a informação de comando.

---

# Fase 3 — o que fechou

## SLA de resposta substitui "não lidos"

"47 não lidos" não mede nada: metade é newsletter. A métrica que importa é
**quem está esperando resposta sua, e há quanto tempo** — e o prazo
aceitável muda por negócio.

| Contexto | Prazo padrão |
|---|---|
| Caixa de negócio (Unitedcom, Cordex.AI, Brand.co, EmpreendaSim) | 8h |
| `Outros` | 48h |
| `Pessoais` | 72h |

Prioridade `URGENT` encurta o prazo pela metade, com piso de 1h. Um teste
trava a consequência disso: **o mesmo atraso de 8h vence numa caixa e não
vence na outra** — que é o ponto inteiro de ter prazo por negócio.

Caixa sem ninguém esperando aparece com zero e **não some da lista**. Sumir
faria o painel parecer menor do que o conjunto de caixas que você tem, e a
Torre existe para responder "está tudo sob controle?" sobre **todas**.

## Alertas: a tabela existia, nada os criava

`Alert` já tinha `dedupeKey` (unique) e `acknowledgedAt` no schema desde a
fase 0, e a Torre já renderizava a seção — mas **nenhuma linha de código
criava um alerta**. Era uma seção que nunca podia acender.

Agora existem seis condições: `REAUTH_NEEDED`, `CONNECTION_ERROR`,
`SYNC_STALE`, `CALENDAR_CONFLICT`, `SLA_BREACH`, `BILL_DUE`.

Três decisões definem se esse painel vai ser lido ou ignorado:

**1. A chave identifica a condição, não a ocorrência.** `sync-stale:<conta>`
é a mesma chave esteja a conta atrasada há 100 ou 900 minutos. Sem isso a
mesma conta atrasada viraria um alerta novo a cada verificação, e em um dia
o painel teria centenas de linhas dizendo a mesma coisa.

**2. A condição que se resolve some sozinha.** Exigir que você feche na mão
o alerta de uma conta que já voltou a sincronizar é o caminho mais curto
para você parar de ler os alertas — e a partir daí eles não protegem de
mais nada.

**3. Reconhecer não é resolver.** "Eu sei" silencia enquanto a condição
durar. Mas se a condição se resolve e volta depois, o alerta **reaparece
sem o reconhecimento antigo**: é um problema novo, ainda que pareça o
mesmo.

Os alertas são derivados do **mesmo estado que a Torre está renderizando**,
não de uma consulta própria. Uma lista de alertas que discorda dos números
ao lado dela é pior do que não ter alerta nenhum: se o painel diz "nenhuma
conta atrasada" e o alerta diz "conta atrasada", você para de acreditar nos
dois.

Detalhes que os testes travam: reautenticação **não** emite também o alerta
de atraso (uma conta parada por reautenticação também está atrasada, e
dizer as duas coisas é dizer a mesma coisa duas vezes); o mesmo par de
eventos em conflito não vira dois alertas conforme a ordem em que a
detecção devolveu; e o alerta de cobrança repete a ressalva de completude,
porque ele pode ser o único lugar que você olha.

**Verificado em execução real** o ciclo inteiro: condição aparece → 1
alerta; mesma condição de novo → atualiza, não duplica; reconheço →
sobrevive à ressincronização; condição some → alerta resolvido sozinho;
condição volta → alerta novo, sem o reconhecimento antigo.

## Busca unificada (`/busca`)

Sobre **assunto, remetente, prévia e título de evento**, em todas as caixas
de uma vez, com filtros por conta, por tipo (e-mail/evento) e por triagem
(precisam resposta / cobranças).

**O corpo fica de fora de propósito.** Indexar o corpo de tudo significaria
guardar o corpo de tudo, e a decisão de privacidade deste projeto é a
oposta: corpo só sob demanda. É uma limitação real e está escrita na
própria tela.

Busca por prefixo: quem digita "fornec" espera achar "fornecedor". Sem
isso, busca por palavra inteira quase nunca acha.

E a deduplicação continua não escondendo nada — o resultado mostra "em 2
caixas" quando o mesmo item existe em mais de uma conta.

**A ressalva de implementação**: usa `ILIKE`, não full-text do Postgres.
Full-text exigiria escolher a configuração de idioma, e estas caixas
misturam português e inglês. Com o volume de caixas pessoais isso resolve;
em centenas de milhares de mensagens ficaria lento, e aí a troca é por
full-text + índice GIN — o `toTsQuery` já está escrito e testado para esse
dia.

## O que ficou de fora

**Métricas semanais de atenção.** Sem histórico de uso real, seria um
gráfico bonito desenhado sobre dados de demonstração. Faz sentido depois de
algumas semanas com contas de verdade conectadas.

---

# Agenda unificada (`/agenda`)

## O que já existia, e o que faltava

A unificação de calendário **não começou agora** — o núcleo dela é de fases
anteriores e está em produção no código desde a fase 2:

- **Deduplicação por `iCalUID`** (RFC 5545), o identificador que é estável
  entre provedores. O mesmo convite recebido no Google, no Microsoft e no
  iCloud tem o mesmo UID, então vira **um** item. A chave inclui o horário
  de início, senão uma série recorrente inteira colapsaria em uma linha só.
- **Fallback** para quando não há UID: título normalizado + organizador +
  horário exato.
- **Detecção de conflito entre contas** (`findConflicts`), que ignora de
  propósito os pares que são a mesma reunião vista de duas caixas — senão
  todo convite recebido em duas contas viraria um falso conflito.
- **Janelas de foco** (`findFocusWindows`): os buracos de 90min+ no
  expediente, calculados depois de fundir os intervalos ocupados.
- **`buildTimeline`**, que colapsa as cópias em uma linha por reunião.

O que faltava era **a tela além de "hoje"**. A Torre mostrava a agenda do
dia; não havia como olhar a semana, navegar, ou filtrar por conta.

## A tela

Semana começando na **segunda** — é a semana útil que você olha para
decidir agenda de trabalho. Um teste trava o erro clássico: `getDay()` do
domingo é 0, e uma implementação ingênua faz o domingo pular para a semana
seguinte.

Cada dia mostra os compromissos já colapsados, com **uma bolinha por
conta**. Quando o mesmo compromisso existe em mais de uma caixa, a linha
diz explicitamente "em 2 contas: Pessoal, Trabalho" — a deduplicação nunca
esconde, ela agrupa.

O resumo da semana traz a métrica que prova que a unificação está servindo
para alguma coisa: **"1 cópia colapsada — você veria 5 linhas sem a
unificação"**.

Conflitos entre contas diferentes ganham selo no dia e destaque na linha. O
conflito é calculado sobre as **cópias**, não sobre as linhas já
colapsadas: é a comparação entre contas diferentes que interessa.

## Duas coisas que os testes travaram

**Evento de vários dias aparece em todos os dias que cobre.** Uma viagem de
terça a quinta precisa aparecer nos três dias; mostrar só no dia de início
faria a quarta-feira parecer livre. A pertinência ao dia é por
**sobreposição**, não por "começa neste dia".

**"Hoje" é o instante real, não a semana que você está olhando.** Bug
encontrado navegando na tela: `loadAgenda` recebia uma única data que servia
para escolher a semana *e* para marcar o dia atual, então ao abrir a semana
passada o dia equivalente daquela semana ganhava o selo "hoje". Agora são
dois parâmetros distintos, com teste de regressão.

## Verificado

Contra os dados de demonstração, que foram montados justamente para este
cenário: o mesmo convite em duas contas virou **uma linha com duas contas**
(e não um conflito), a reunião do Microsoft sobrepondo a consulta do Google
virou **um conflito entre contas**, e as janelas livres do dia saíram
corretas (11:00–14:00 e 16:00–20:00).

## O que ainda não tem

- **Visão de mês** e visão de dia com grade de horas. Hoje é lista por dia.
- **Fuso horário explícito**: os horários são renderizados no fuso do
  navegador. Para quem viaja, falta mostrar o fuso do evento.
- Qualquer **ação** sobre a agenda (aceitar convite, criar, mover) — isso é
  fase 4, e exige consentimento OAuth novo com escopo de escrita.

---

# Fuso horário: um bug de correção, não de formatação

As páginas são renderizadas **no servidor**, e `toLocaleString` sem
`timeZone` usa o fuso do **processo**. Este servidor roda em UTC. O
resultado, medido:

```
10:00 UTC renderiza como: 10:00   |   em São Paulo: 07:00
```

Num app de calendário isso não é detalhe de formatação. Havia duas
consequências, e a segunda é a grave:

1. **Todos os horários apareciam 3 horas adiantados.**
2. **Os limites de dia estavam errados.** Um compromisso às 21:30 em São
   Paulo é 00:30 UTC do dia seguinte — ele aparecia na quinta em vez da
   quarta. O mesmo valia para "hoje", para as janelas livres (o expediente
   "09:00" era 09:00 UTC, ou seja 06:00 local) e para o começo da semana.

## A correção

`src/core/time/zone.ts`: toda conversão passa a receber o fuso
explicitamente, lido de `User.timezone` (padrão `America/Sao_Paulo`). Sem
dependência externa — `Intl` já sabe converter, só precisava ser usado.

O módulo expõe o que o resto do sistema precisa: componentes de data em um
fuso, o instante UTC de uma hora de parede, começo do dia, dia da semana,
soma de dias e formatação. `weekBounds`, `buildWeek` e `buildMonth` passaram
a receber o fuso; nove pontos de formatação nas telas foram corrigidos.

A conversão de hora de parede para instante UTC é feita em **duas
passadas**, por causa do horário de verão: o deslocamento usado no primeiro
palpite pode ser o do outro lado da virada. O Brasil não tem mais DST, mas o
código não pode assumir isso — uma das suas caixas pode ser de fora. Há
teste com Lisboa atravessando as duas viradas de 2026.

O teste que mais importa é o que **prova o bug**: o mesmo compromisso das
21:30 em São Paulo cai na quarta com o fuso do usuário e na quinta com o do
servidor.

## Um bug menor encontrado junto

`buildTimeline` deduplicava as contas de um compromisso **por rótulo**. Duas
conexões que você nomeou igual ("Trabalho") virariam uma bolinha só, e a
linha diria "em 1 conta" quando são duas. Agora deduplica por id da conexão.

---

# Visão de mês e grade de horas

A grade do mês é expandida até cobrir **semanas inteiras** (segunda a
domingo). Sem isso a primeira e a última linha teriam buracos, e um
compromisso do dia 31 do mês anterior sumiria mesmo estando na mesma semana
que você está olhando. Os dias de fora do mês aparecem apagados, mas **não
somem** — continuam sendo compromissos seus.

`buildMonth` reaproveita `buildWeek` semana a semana em vez de
reimplementar a agregação: deduplicação, conflito e pertinência ao dia
precisam se comportar igual nas duas telas, e duas implementações
divergiriam com o tempo.

`shiftMonths` ancora no dia 1 para evitar o bug clássico de 31 de janeiro +
1 mês virar 2 ou 3 de março. Há teste.

Na visão de semana, cada compromisso ganhou uma **barra proporcional ao
horário** dentro da faixa 07:00–22:00: dá para ver de relance se o dia está
carregado de manhã ou de tarde, sem ler linha por linha. A barra é recortada
em 0–100%, então um compromisso às 05:00 encosta na borda em vez de desenhar
fora do quadro.
