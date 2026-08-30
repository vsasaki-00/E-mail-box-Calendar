# 00 — Visão do Produto

## O problema

Hoje a informação está espalhada por várias caixas de e-mail e vários calendários,
em provedores diferentes (Google, Microsoft, Apple/iCloud, servidores próprios).
As consequências práticas:

- **Nenhum lugar mostra "o dia inteiro"**. Um conflito entre um evento do calendário
  corporativo Microsoft e um pessoal do Gmail só aparece quando já é tarde.
- **Triagem duplicada**. A mesma decisão ("isso é importante?") é tomada N vezes,
  uma por caixa, com critérios diferentes em cada uma.
- **Compromissos nascem dentro do e-mail** e morrem lá. O convite, a confirmação de
  voo, o boleto com vencimento — tudo é um evento de calendário que ninguém criou.
- **Não existe medição**. Não dá para responder "quanto tempo eu perdi em reunião
  essa semana?" ou "quais remetentes consomem minha atenção?".

## A solução

Um **plano de controle único** sobre todas as contas. O app não substitui o Gmail
nem o Outlook: ele **agrega, normaliza e comanda**.

Três camadas, nesta ordem de prioridade:

1. **Unificação** — uma única linha do tempo de mensagens e uma única agenda,
   com deduplicação entre contas (o mesmo convite chega em 3 caixas = 1 item).
2. **Torre de Controle** — a visão de comando: estado de saúde de cada conexão,
   conflitos de agenda, backlog de triagem, SLA de resposta, métricas de atenção.
   É a tela que responde "está tudo sob controle?" em 5 segundos.
3. **Automação** — regras e agentes que agem: triar, arquivar, criar evento a partir
   de e-mail, propor horário, bloquear foco, alertar.

## Princípios de projeto

| Princípio | Consequência prática |
|---|---|
| **Read-first, write-later** | Toda escrita em provedor externo (enviar, apagar, mover) passa por confirmação explícita até a fase 4. Ler é barato; escrever errado em 6 caixas é caro. |
| **O provedor é a fonte da verdade** | O banco local é um *cache materializado*. Qualquer estado pode ser reconstruído com um resync completo. Nunca guardamos algo que só existe aqui e é insubstituível. |
| **Degradação por conexão** | Se a conta Microsoft cai, o resto do app continua funcionando e a Torre de Controle mostra exatamente o que está degradado. Nunca uma falha global. |
| **Sem segredo em claro** | Tokens e senhas de app são cifrados em repouso com chave que não vive no banco. |
| **Um modelo unificado, adaptadores burros** | Toda a inteligência fica no núcleo. Cada conector só traduz o dialeto do provedor para o modelo canônico. |

## Não-objetivos (explícitos)

- Não é um cliente de e-mail completo com editor rico e todos os recursos do Gmail.
- Não é um servidor de e-mail. Não recebemos SMTP nem hospedamos caixas.
- Não é multi-tenant SaaS na fase 1. É single-user (você), com o modelo de dados
  já preparado para múltiplos usuários para não precisar de migração dolorosa depois.

## Critério de sucesso da fase 1

> Abrir uma única tela de manhã, ver todos os compromissos do dia de todas as contas
> e todos os e-mails que exigem ação, e não precisar abrir mais nenhuma outra caixa.
