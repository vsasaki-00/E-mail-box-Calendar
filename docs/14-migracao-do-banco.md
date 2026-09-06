# Migrar o banco para São Paulo

## Por que

Medido em produção, no projeto atual:

```
latenciaBancoMs:     1455   ← primeira consulta, com aperto de mão
latenciaConsultaMs:   583   ← segunda, conexão já aberta
```

583 ms para um `select 1` **com a conexão já aberta** não é custo de conectar:
é distância. O mesmo `select 1` num Postgres local responde em 1–2 ms.

Isso não é um detalhe de desempenho, é o teto do que o app consegue fazer. A
Vercel roda em `gru1` (São Paulo); o projeto Supabase, na região padrão
(Virgínia). Cada ida e volta atravessa o Atlântico:

| operação | consultas | a 583 ms | a 5 ms |
| --- | ---: | ---: | ---: |
| abrir a Torre | ~14 | 8 s | 70 ms |
| gravar uma página de sync | 8 | 4,7 s | 40 ms |
| gravar uma página, versão antiga | 104 | 61 s (estourava) | 0,5 s |

A gravação em lote (ver `docs/09-deploy.md`) fez o app **caber** nessa
latência. Mudar de região é o que faz ele deixar de conviver com ela.

## O que a migração preserva

Tudo o que está no schema `public`, que é onde mora o app inteiro: as contas
conectadas, as mensagens e eventos já sincronizados, o financeiro, os
negócios, as regras de categoria, o histórico de sync.

**Os segredos das contas continuam funcionando.** Eles estão cifrados em
AES-256-GCM nas colunas `secretCiphertext`/`secretIv`/`secretTag`, e a chave
mestra vive numa variável de ambiente — fora do banco, que é o ponto do
desenho. O texto cifrado viaja como qualquer outro byte.

**Não mexa em `MASTER_ENCRYPTION_KEY`, `MASTER_ENCRYPTION_KEY_ID` nem
`MASTER_ENCRYPTION_KEYS_OLD`.** Esta migração troca uma variável só, a
`DATABASE_URL`. Se a chave mudar junto, nenhuma conta decifra e as seis pedem
reconexão — e como o `secretKeyId` viaja gravado em cada linha, a chave certa
precisa continuar no chaveiro com o mesmo id.

## O que perde, e por quê importa

Tudo que for escrito no banco ANTIGO depois do dump. Parte é recuperável
(mensagens e eventos voltam do provedor no próximo sync); parte **não é**:

- lançamentos e conciliações do financeiro,
- extratos importados,
- negócios, perfis de caixa e regras de categoria,
- mensagens e cobranças que chegaram pelo WhatsApp.

Por isso o passo 1 existe.

---

## Roteiro

### 1. Silenciar as escritas

Desligue o agendamento antes de tirar o dump, senão um ciclo pode gravar no
banco antigo enquanto você migra:

**GitHub → Actions → "Sincronizar caixas" → `⋯` → Disable workflow.**

E não use o app (nem o WhatsApp) até o fim do passo 5.

### 2. Criar o projeto novo

No Supabase, novo projeto com **Region: South America (São Paulo)**. Guarde a
senha do banco — ela não aparece de novo.

### 3. Copiar

Pegue as duas URIs em **Project Settings → Database → Connection string →
**Session pooler** (`<cluster>.pooler.supabase.com`, porta **5432**).

Não é a conexão direta e não é o pooler de transação, e os dois erros são
fáceis:

- **pooler de transação (6543)**: não mantém sessão, e `pg_dump` precisa de
  uma. O script recusa;
- **conexão direta (`db.<ref>.supabase.co`)**: funcionaria, mas hoje só resolve
  em IPv6, e boa parte das redes não alcança — foi o que derrubou o workflow de
  backup antes de ele virar Session pooler.

Se a sua senha tem `@` ou `:`, ela precisa ir percent-encoded na URI, senão a
string quebra em pedaços errados e o erro fala de "host inválido" — a pista
mais distante possível da causa. Copie a URI pronta do painel em vez de montar
à mão.

```bash
ORIGEM='postgresql://…projeto-antigo…' \
DESTINO='postgresql://…projeto-novo…' \
  scripts/migrar-banco.sh
```

O Supabase hoje roda **PostgreSQL 17**: o `pg_dump` da sua máquina precisa ser
17 ou mais novo. Um cliente mais velho gera um dump **incompleto sem
reclamar** — é a forma nº 1 de perder dados numa migração, e o script para
antes de deixar isso acontecer.

Ele também para quando o destino já tem tabelas ou quando o `psql` erra no meio
da restauração, recusa o pooler de transação, e limpa os parâmetros que só o
Prisma entende (`?schema=`, `?pgbouncer=`, `?connection_limit=`) — eles fazem o
`psql` recusar a conexão inteira com "invalid URI query parameter".

O dump fica salvo em disco. **Guarde até o fim do passo 6.**

### 4. Conferir ANTES de trocar qualquer coisa

```bash
ORIGEM='…' DESTINO='…' scripts/conferir-migracao.sh
```

Compara a contagem de toda tabela do `public` nos dois bancos e confere o
schema do destino contra o `prisma/schema.prisma`. Sai com erro se algo
divergir. Uma tabela esquecida numa migração não faz barulho: o app abre,
funciona, e a falta só aparece semanas depois, quando alguém procura um
lançamento que sumiu.

### 5. Trocar a variável e publicar

Na Vercel, **Settings → Environment Variables → `DATABASE_URL`**: a URI do
projeto novo, com os parâmetros que o Prisma espera de volta:

```
?pgbouncer=true&connection_limit=5
```

Use a URL do **pooler** aqui (é o contrário do passo 3): a aplicação abre e
fecha conexão o tempo todo, e é para isso que o pooler existe.

Variável de ambiente na Vercel **só vale em build novo**. Redeploy.

### 6. Verificar que valeu a pena

```
https://e-mail-box-calendar.vercel.app/api/saude
```

`latenciaConsultaMs` deve cair de ~583 ms para algo entre 5 e 30 ms. Se não
caiu, o `DATABASE_URL` novo não pegou — confira o `commit` na mesma resposta e
se o redeploy terminou.

Depois, na tela de Conexões: as seis contas devem continuar **ativas** e
`somente leitura` (nenhuma pedindo reconexão — é o que prova que os segredos
decifraram).

### 7. Religar e limpar

Reative o workflow "Sincronizar caixas". Espere um ciclo verde.

Só então: apague o dump do disco (ele tem os seus dados) e pause o projeto
antigo no Supabase. **Não apague o projeto antigo no mesmo dia** — é o seu
retorno se algo aparecer depois.

---

## Se der errado no meio

Nada é destrutivo até o passo 5. O banco antigo continua intacto e servindo o
app o tempo todo; a troca é uma variável de ambiente. Para voltar: devolva o
`DATABASE_URL` antigo e redeploy.
