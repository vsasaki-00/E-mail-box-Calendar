# 05 — Torre de Controle

A tela de comando. Responde em 5 segundos: **está tudo sob controle?**

Não é um dashboard de vaidade com gráficos bonitos — cada bloco existe porque
leva a uma ação.

## Blocos

### 1. Saúde das conexões
Um card por conta, com o `status` da `Connection`, o horário do último sync
bem-sucedido e o último erro. Ação direta no card: *Reconectar*, *Sincronizar
agora*, *Desativar*.

Regra: **conta com sync atrasado além de 3× o intervalo esperado vira alerta.**
Silêncio não é sinal de saúde — é o modo de falha mais comum de agregadores.

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
