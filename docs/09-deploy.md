# 09 — Publicar na Vercel

Este documento cobre o que muda quando o Meridiano sai do `localhost` e passa
a ter uma URL pública. São três mudanças de fundo, não uma só:

1. **Passa a existir uma porta.** No `localhost` só a sua máquina alcança o
   app. Publicado, a URL é o único obstáculo — e URL não é segredo. Por isso
   o portão de entrada (`src/middleware.ts`) é pré-requisito, não enfeite.
2. **O worker deixa de existir como processo.** `pnpm worker` é um laço
   infinito; na Vercel não há processo que sobreviva entre requisições. Quem
   chama o relógio passa a ser o cron (`/api/cron/sync`).
3. **O Postgres sai do Docker.** Um banco em `localhost:5432` não é
   alcançável de dentro de uma função da Vercel.

---

## 1. O portão de entrada

### Como funciona

`src/middleware.ts` **bloqueia tudo por padrão** e libera uma lista curta:
`/entrar`, os dois callbacks de OAuth e `/api/cron`. A ordem importa. Se a
regra fosse "bloqueie estas rotas", cada tela nova nasceria pública e o erro
só apareceria quando alguém achasse a URL.

Os callbacks de OAuth precisam ser públicos porque chegam do Google e da
Microsoft, sem o seu cookie. Eles não ficam desprotegidos: o parâmetro
`state` carrega CSRF, prazo e uso único. `/api/cron` autentica por segredo no
header, não por cookie.

O cookie de sessão (`src/lib/session.ts`) é um HMAC-SHA256 sobre um payload
que diz só até quando vale. **Não há estado no servidor** — é o que permite
validá-lo em ambiente serverless, onde requisições consecutivas não
compartilham memória. Ele usa apenas Web Crypto porque o middleware roda no
runtime Edge, onde `node:crypto` não existe.

A senha (`src/lib/senha.ts`) é conferida com scrypt, que só roda no Node — por
isso os dois arquivos são separados. A senha **nunca vai para o banco**:
o servidor guarda só o hash, e só em variável de ambiente. Um dump do banco
não revela como entrar.

### O que ele NÃO faz

- Não há usuários múltiplos. É uma senha, sua. O app pressupõe um dono.
- Não há proteção contra tentativa em massa (rate limit). O scrypt torna cada
  tentativa cara (~100ms), o que atrapalha um ataque automatizado, mas não é
  um bloqueio. Uma senha de 12+ caracteres é o que sustenta isso.
- A sessão dura 30 dias e não é renovada por uso. Depois disso, entrar de novo.

### Comportamento no desenvolvimento

Rodando `pnpm dev` **sem `APP_PASSWORD_HASH` definido**, o middleware deixa
passar. É como o app sempre funcionou no localhost, e a alternativa seria
trancar você para fora da própria máquina logo depois do `pnpm setup` — com
`SESSION_SECRET` já escrito e nenhuma senha ainda cadastrada.

Isso **não vale em produção**: lá, faltar `SESSION_SECRET` ou
`APP_PASSWORD_HASH` devolve **503 em tudo**. Um erro de configuração nunca
deve virar porta aberta.

### Gerando os segredos

```bash
pnpm gerar:senha
```

Lê a senha da entrada padrão (não de argumento — argumento fica no histórico
do shell e aparece em `ps` para outros processos) e imprime as três variáveis.
A senha em si não é gravada em lugar nenhum: guarde-a você.

---

## 2. Banco de dados — Supabase

Você precisa de um Postgres acessível pela internet. **A escolha deste
projeto é o Supabase** (Neon e o Postgres da própria Vercel também
serviriam). Crie o projeto em supabase.com, região **South America (São
Paulo)** — o app é usado do Brasil, e cada consulta atravessa essa distância.

Guarde a senha do banco na hora em que ela aparecer: o Supabase não a mostra
de novo.

### Duas strings diferentes, para dois usos diferentes

Este é o ponto onde é fácil errar. No painel do projeto, botão **Connect**,
o Supabase mostra três strings. Copie de lá — não digite de memória, o
formato do host muda entre regiões e gerações de projeto.

| Uso | Qual copiar | Por quê |
|---|---|---|
| `DATABASE_URL` na Vercel (runtime) | **Transaction pooler** (porta 6543) | cada requisição serverless abre a própria conexão; sem pool o banco esgota o limite em minutos de uso |
| `pnpm db:push` da sua máquina (DDL) | **Session pooler** (porta 5432) | o modo transação não sustenta `CREATE TABLE` de forma confiável |

Na string do **transaction pooler**, acrescente os parâmetros que o Prisma
precisa para conviver com o PgBouncer:

```
?pgbouncer=true&connection_limit=1
```

Prefira o **session pooler** à *direct connection* para o `db push`: em
projetos novos o Supabase serve a conexão direta só por IPv6, e boa parte
das operadoras domésticas brasileiras ainda não entrega IPv6 — o sintoma é
um timeout que parece problema do banco e é da sua rede.

**Se a senha tiver caractere especial** (`@`, `#`, `/`, `:`), ela precisa
estar *percent-encoded* dentro da URL, senão o parser corta a string no
lugar errado. O jeito de não pensar nisso é escolher uma senha longa só com
letras e números.

### Criando as tabelas

```bash
DATABASE_URL="<session pooler, porta 5432>" pnpm db:push
```

`db:push`, não `db:migrate`. Este projeto não tem pasta de migrations; o
`prisma migrate dev` ofereceria **apagar o banco** para criar a primeira
migration.

### Um efeito colateral bem-vindo

O plano gratuito do Supabase pausa projetos ociosos. O cron de hora em hora
(item 5) toca o banco com frequência suficiente para isso nunca acontecer.

---

## 3. Variáveis de ambiente na Vercel

Em *Settings → Environment Variables*, para o ambiente **Production**:

| Variável | Vem de |
|---|---|
| `DATABASE_URL` | Supabase → **transaction pooler** (6543) + `?pgbouncer=true&connection_limit=1` |
| `MASTER_ENCRYPTION_KEY` | **copie a do seu `.env` local** — ver abaixo |
| `MASTER_ENCRYPTION_KEY_ID` | idem (`k1`) |
| `SESSION_SECRET` | `pnpm gerar:senha` |
| `APP_PASSWORD_HASH` | `pnpm gerar:senha` |
| `CRON_SECRET` | `pnpm gerar:senha` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `https://<seu-domínio>/api/auth/google/callback` |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Entra ID |
| `MICROSOFT_REDIRECT_URI` | `https://<seu-domínio>/api/auth/microsoft/callback` |
| `ANTHROPIC_API_KEY` | console.anthropic.com — sem ela, triagem e rascunho ficam parados |

**Sobre a `MASTER_ENCRYPTION_KEY`:** ela é o que decifra os tokens das contas
conectadas. Se produção tiver uma chave diferente da local, os dois bancos
são independentes e você reconecta as contas em cada um — o que é aceitável.
O que **não** funciona é apontar produção para o banco local (ou vice-versa)
com chave diferente: as credenciais gravadas ficam ilegíveis, e não há como
recuperá-las.

Recomendação: gere uma chave nova para produção e reconecte as contas lá.
Assim um vazamento de um lado não compromete o outro.

---

## 4. OAuth: acrescentar a URL de produção

No Google Cloud Console (*Credenciais → seu ID de cliente OAuth*) e no Entra
ID, **acrescente** a URI de produção à lista de redirecionamentos
autorizados — não substitua a de `localhost`, para os dois ambientes
continuarem funcionando:

```
https://<seu-domínio>.vercel.app/api/auth/google/callback
```

O domínio de *preview* da Vercel muda a cada deploy, então o OAuth só
funciona no domínio de produção (ou num domínio próprio). Isso é bom: uma
URL de preview autorizada seria mais uma porta a vigiar.

Enquanto o app estiver em **modo de teste** no Google, cada conta que você
for conectar precisa estar listada em *Usuários de teste*. Uma conta fora da
lista recebe `access_denied` na autorização.

---

## 5. Sincronização por cron

`vercel.json` agenda `/api/cron/sync` **uma vez por dia, 06:00 de São
Paulo** (`0 9 * * *` em UTC) — porque o plano é o Hobby, e o Hobby recusa o
build inteiro diante de um cron mais frequente ou de `maxDuration` acima de
60s. Não é degradação silenciosa, é deploy que falha; foi descoberto no
deploy real deste projeto. Migrando para o Pro, suba o cron para
`0 * * * *` e o `maxDuration` da rota para 300.

Com sync diário, o complemento natural é rodar `pnpm worker` no Mac quando
ele estiver ligado — ambos escrevem no mesmo banco e a deduplicação absorve
a sobreposição. A rota roda o mesmo
`runSyncCycle()` e `runAutomationCycle()` do worker — o núcleo é idêntico, só
muda quem dispara.

Ela responde só com contagens e mensagens de erro. Nada de assunto,
remetente ou corpo: o log da Vercel é mais um lugar onde o e-mail não deve
aparecer.

Para disparar à mão:

```bash
curl -H "x-cron-secret: $CRON_SECRET" https://<seu-domínio>/api/cron/sync
```

`?automacao=0` roda só o sync, sem gastar chamadas de modelo.

### Duas limitações do plano da Vercel

- **Plano Hobby:** o cron só aceita frequência **diária**, e funções cortam
  em **60 segundos**. Uma sincronização de várias caixas pode não caber. Se
  o cron falhar por tempo, a saída é o plano Pro (cron por minuto,
  `maxDuration` até 300s, já declarado na rota) — ou continuar rodando
  `pnpm worker` na sua máquina, que sincroniza o mesmo banco.
- O cron da Vercel **não roda em deploys de preview**, só em produção.

---

## 5b. Carga inicial pela sua máquina

O primeiro sync de caixas grandes leva **centenas de voltas** na Vercel,
porque cada função morre em 60s e cada volta grava poucos itens. O mesmo
código, rodando no seu Mac, não tem esse limite:

```bash
cp .env.producao.example .env.producao
# preencha DATABASE_URL (session pooler, 5432) e MASTER_ENCRYPTION_KEY
pnpm worker:producao
```

Deixe rodando até a Torre parar de crescer e encerre com `Ctrl+C`.

Três cuidados:

- A `MASTER_ENCRYPTION_KEY` tem que ser **exatamente** a da Vercel. Com uma
  chave diferente os tokens gravados ficam ilegíveis e toda conexão falha.
- Use o **session pooler (5432)**, não o transaction pooler: o worker é um
  processo longo e faz muitas conexões seguidas.
- `.env.producao` está no `.gitignore`. Ele carrega a chave que decifra os
  tokens de todas as suas caixas — trate como senha.

O arquivo existe porque passar os valores na linha de comando é frágil:
eles ficam no histórico do shell, aparecem em `ps` para outros processos, e
um espaço reservado colado sem substituir vira um erro obscuro de driver.

---

## 6. Ordem de execução

1. `pnpm gerar:senha` → guarde as três linhas.
2. Crie o projeto no Supabase (região São Paulo) e copie as **duas** strings
   do botão *Connect*: transaction pooler (6543) e session pooler (5432).
3. `DATABASE_URL="<session pooler, 5432>" pnpm db:push`.
4. Importe o repositório na Vercel e confira a branch de produção:
   `claude/email-calendar-manager-zsf592`. O lugar do ajuste muda com a
   versão da interface — *Settings → Environments → Production → Branch
   Tracking* na atual, *Settings → Git → Production Branch* na anterior.
   Como o repositório só tem essa branch (ela é a padrão), normalmente a
   Vercel já a usa sozinha; o sintoma de estar errado é o aviso
   "No production deployments found" ao salvar variáveis.
5. Cadastre as variáveis do item 3, com a `DATABASE_URL` do **transaction
   pooler**. **Antes do primeiro deploy** — sem `SESSION_SECRET` e
   `APP_PASSWORD_HASH` o app responde 503, de propósito.
6. Deploy. Anote o domínio.
7. Acrescente as URIs de redirecionamento no Google e na Microsoft (item 4),
   e só então cadastre `GOOGLE_REDIRECT_URI` na Vercel — ela depende do
   domínio, que só existe depois do item 6. **Redeploy**: variável nova só
   vale no build seguinte.
8. Abra a URL, entre com a senha, conecte as contas em `/conexoes`.

---

## 7. O que continua sem verificação

Honestidade sobre o que foi testado e o que não foi:

- O portão de entrada foi verificado de ponta a ponta contra um build de
  produção real: redirecionamento sem cookie, 401 nas rotas de API, recusa de
  cookie adulterado ou vencido, login com senha certa e errada, e logout.
- A rota de cron foi verificada recusando pedido sem segredo e com segredo
  errado, e respondendo com o segredo certo.
- **Nenhum deploy real na Vercel foi feito.** Os limites de plano descritos
  no item 5 vêm da documentação da Vercel, não de um teste meu.
- **Nenhuma conta de e-mail real foi conectada** em nenhum momento deste
  projeto. Todo o conector é exercitado com fakes.
