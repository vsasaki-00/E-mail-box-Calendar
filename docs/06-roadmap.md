# 06 — Roadmap

Cada fase termina em algo utilizável. Nada de "fase de infraestrutura" que não
entrega valor.

---

## Fase 0 — Fundação ✅ (esta entrega)

- Documentação de arquitetura, modelo de dados, segurança e conectores.
- Scaffold Next.js + TypeScript + Prisma + Postgres rodando.
- Contrato `Connector` definido com matriz de capacidades.
- Camada de criptografia de segredos implementada e testada.
- Modelo canônico (`UnifiedMessage`, `UnifiedEvent`) e deduplicação implementados.
- Torre de Controle renderizando com dados de demonstração (`pnpm db:seed`).

**Entrega**: dá para rodar, ver a tela de comando e entender a forma do sistema.

---

## Fase 1 — Primeira conta real, leitura ponta a ponta

- OAuth Google completo (PKCE, callback, refresh, revogação).
- Conector Gmail: full sync + incremental por `historyId`.
- Conector Google Calendar: full sync + `syncToken`.
- Worker de sync com agendamento e checkpoints.
- Inbox unificada e Agenda unificada com dados reais.

**Critério de aceite**: conectar uma conta Google e ver e-mails e eventos reais
na tela, com sync incremental funcionando por 24 h sem intervenção.

---

## Fase 2 — Multi-conta e multi-provedor

- OAuth Microsoft (MSAL) + conectores Graph mail/calendar com `deltaLink`.
- Conector IMAP/CalDAV genérico + preset Apple iCloud.
- Deduplicação ativa entre contas (`Message-ID`, `iCalUID`).
- Seletor de quais pastas/calendários entram na visão unificada.

**Critério de aceite**: todas as suas caixas e calendários em uma única tela,
com o mesmo convite aparecendo uma vez só.

---

## Fase 3 — Torre de Controle completa

- Detecção de conflitos de agenda entre contas.
- Backlog de triagem e SLA de resposta.
- Métricas semanais de atenção.
- Alertas com deduplicação e reconhecimento.
- Busca unificada (Postgres full-text sobre metadados + assunto + snippet).

**Critério de aceite**: a tela de comando responde "está tudo sob controle?"
sem você abrir mais nada.

---

## Fase 4 — Escrita e comando

Aqui o app deixa de ser observador. **Novo consentimento OAuth por conexão**,
com escopos de escrita.

- Ações em e-mail: arquivar, marcar lido, aplicar label, responder, enviar.
- Ações em calendário: aceitar/recusar convite, criar e mover evento.
- Fila de ações com confirmação e log de auditoria de tudo que o app escreveu.
- Desfazer para ações reversíveis.

**Critério de aceite**: triar a manhã inteira sem sair do app.

---

## Fase 5 — Automação e inteligência

- Motor de regras: condição + ação sobre `UnifiedItem`.
- Extração de compromisso a partir de e-mail (voo, hotel, boleto, entrega)
  com proposta de evento — sempre com confirmação, nunca criação silenciosa.
- Sugestão de horário considerando **todos** os calendários simultaneamente.
- Bloqueio automático de janelas de foco.
- Resumo diário/semanal.

---

## Fase 6 — Alcance e operação

- App mobile ou PWA sobre a mesma API.
- Push nativo (Gmail watch + Pub/Sub, Graph subscriptions) substituindo polling.
- Notificações push para alertas críticos.
- Observabilidade: métricas de sync, latência por provedor, alarmes operacionais.

---

## Riscos conhecidos e como tratamos

| Risco | Tratamento |
|---|---|
| Verificação do app Google para escopos restritos leva semanas | usar modo de teste com sua conta durante as fases 1–3; iniciar o processo de verificação no início da fase 4 |
| Throttling do Microsoft Graph | respeitar `Retry-After` desde o primeiro dia; backoff exponencial no cliente HTTP |
| Volume de e-mail estourar o banco | janela histórica configurável, corpo sob demanda, sem anexos na fase 1 |
| Recorrência e fuso horário em CalDAV | usar instâncias expandidas dos provedores; para CalDAV, biblioteca dedicada e testes com casos de DST |
| Dedupe agressivo escondendo e-mail legítimo | nunca apagar cópias; a UI sempre mostra em quantas caixas o item existe e permite expandir |
