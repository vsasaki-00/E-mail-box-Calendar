# 04 — Segurança e Credenciais

Este app concentra acesso a **todas** as caixas de e-mail e calendários. O valor
para um atacante é altíssimo. As decisões abaixo não são opcionais.

## Segredos em repouso

Envelope encryption com AES-256-GCM (`src/lib/crypto.ts`):

- A **chave mestra** (`MASTER_ENCRYPTION_KEY`, 32 bytes em base64) vive em
  variável de ambiente — em produção, em um KMS/secret manager. **Nunca no banco.**
- Cada segredo é cifrado com IV aleatório de 12 bytes; guardamos
  `ciphertext + iv + authTag + keyId`.
- O `keyId` permite **rotação de chave** sem downtime: chaves antigas continuam
  disponíveis para decifrar, novas gravações usam a chave corrente.
- GCM é autenticado: adulteração no banco falha na decifragem em vez de
  devolver lixo silenciosamente.

Consequência prática: **um dump do Postgres não dá acesso a nenhuma caixa.**

## OAuth

- **PKCE obrigatório** em Google e Microsoft, mesmo no fluxo server-side.
- `state` aleatório de 32 bytes, guardado com TTL curto e validado no callback —
  proteção contra CSRF no fluxo de autorização.
- `redirect_uri` sempre exata e registrada; nunca construída a partir de input.
- `refresh_token` é gravado cifrado no mesmo instante em que chega; nunca é
  logado, nunca aparece em resposta de API, nunca vai para telemetria.
- Refresh proativo: renovamos com folga antes do vencimento e geramos alerta
  se o refresh falhar duas vezes seguidas.

## Escopos

Fase 1 pede **apenas leitura**. Escopos de escrita entram na fase 4, com um
novo consentimento explícito por conexão. Pedir `gmail.modify` no dia 1 para
"talvez usar depois" é exatamente o que não se faz.

## Senhas de app (Apple/IMAP)

- Nunca a senha principal da conta — sempre senha específica de app, que pode
  ser revogada individualmente.
- TLS obrigatório (IMAPS 993 / CalDAV sobre HTTPS). Certificado inválido é erro,
  não aviso — sem opção de "ignorar TLS" na interface.

## Dados em repouso e retenção

- Corpos de e-mail só são baixados sob demanda (rascunho, perfil de voz,
  extração de cobrança e o "ler" da triagem) e ficam em cache na `Message`.
  **Ressalva honesta:** o TTL de expiração desse cache ainda não está
  implementado — hoje o corpo baixado fica até a mensagem sair da janela
  de sync. Está na lista.
- O "ler" da triagem mostra o corpo **a você**, nunca ao modelo: a triagem
  segue classificando só com metadados. HTML de e-mail nunca entra na
  página — vai para um iframe com `sandbox` (sem script) e um CSP que
  bloqueia imagem remota, para pixel de rastreamento não avisar o remetente
  que você abriu. Antes disso passa por uma limpeza (script, iframe, form,
  `on*`, `javascript:`), defesa em profundidade atrás do sandbox. A rota
  responde com `Cache-Control: private, no-store`.
- Anexos **não** são armazenados na fase 1 — são referenciados e baixados do
  provedor no momento do acesso.
- `DELETE /api/connections/:id` apaga em cascata todo o cache daquela conta.

## Logs

Lista de campos proibidos em log, em qualquer nível: tokens, senhas, cabeçalhos
`Authorization`, corpo de e-mail, e endereços completos de participantes.
Logs de sync registram contagens e ids internos, não conteúdo.

## Ameaças consideradas

| Ameaça | Mitigação |
|---|---|
| Dump do banco | segredos cifrados com chave externa ao banco |
| Token vazado em log | lista de proibidos + redator no logger |
| CSRF no callback OAuth | `state` aleatório com TTL e validação |
| Conteúdo de e-mail malicioso na UI | HTML sanitizado e renderizado em `iframe` com `sandbox`; imagens remotas bloqueadas por padrão (também evita pixels de rastreamento) |
| Escalada por escopo excessivo | leitura na fase 1, escrita com consentimento separado |
| Comprometimento do host | chave mestra em KMS, não em arquivo no disco |


## Entrada por WhatsApp (fase 7A)

O canal não tem remetente verificável como o e-mail, então são **duas**
barreiras independentes, e as duas obrigatórias: assinatura HMAC-SHA256 do
corpo cru com o App Secret da Meta, e allowlist de número. Ver
[`11-whatsapp.md`](11-whatsapp.md).

Decisões que valem registrar aqui:

- **Allowlist vazia recusa tudo.** A alternativa transformaria um
  esquecimento de configuração em porta aberta para lançamentos.
- A rota é pública no middleware — como os callbacks de OAuth, que também
  chegam sem cookie. A porta é a assinatura, não a URL.
- Nenhuma mensagem vira lançamento sozinha.
- **Mídia fica por referência**: o binário continua no WhatsApp. Guardar
  comprovante do dono no nosso banco é assumir uma responsabilidade que
  este app não precisa ter.
- O log responde só contagens — nunca o texto da mensagem.
