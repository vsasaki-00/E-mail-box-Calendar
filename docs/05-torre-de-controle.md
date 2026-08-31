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
