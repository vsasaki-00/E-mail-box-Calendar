# Migrar o banco de região

> **O banco JÁ ESTÁ em São Paulo. Esta migração não é para fazer agora.**
>
> O roteiro abaixo está ensaiado e continua valendo — para uma troca de
> projeto, de conta ou de provedor. Mas a razão que o motivou estava errada, e
> a correção fica registrada aqui porque o erro foi meu e é instrutivo.

## O que eu concluí, e por que estava errado

Medido em produção:

```
latenciaBancoMs:     1455   ← primeira consulta, com aperto de mão
latenciaConsultaMs:   583   ← segunda, conexão já aberta
```

583 ms para um `select 1` com a conexão já aberta não é custo de conectar. Daí
eu concluí "o banco está longe" e propus mudar de região.

A prova de que não estava veio do **log do backup diário**, que roda neste
mesmo repositório:

```
REF: emczaelrtidkicabrllg
CLUSTER: aws-0-sa-east-1
Recebi uma senha; montei a string do Session pooler para o projeto …
pg_dump … → 1.2M, DUMP_SEGUNDOS: 19
tabelas restauradas: 25 · linhas (estimadas): 10834
```

O pooler do Supabase é **regional**: um projeto que não está em `sa-east-1` não
é alcançável pelo pooler de `sa-east-1`. O backup conecta por
`aws-0-sa-east-1.pooler.supabase.com` e funciona há três execuções seguidas —
logo o banco está em São Paulo, a mesma cidade do `gru1` onde a Vercel roda as
funções. Distância não explica 583 ms entre vizinhos.

**A lição é a de sempre neste projeto, e eu não a apliquei:** eu tinha uma
medida (583 ms) e uma explicação plausível (distância), e tratei a segunda como
se a primeira a provasse. A medida era real; a explicação, um palpite. O que
faltava era o experimento que separa as hipóteses — e ele agora está na sonda.

## O que a sonda mede agora

`/api/saude` devolve quatro números, e o desenho deles é para não deixar
palpite passar por diagnóstico:

| campo | o que é |
| --- | --- |
| `latenciaBancoMs` | primeira consulta, com aperto de mão |
| `latenciaConsultaMs` | segunda, conexão aberta |
| `porViagemMs` | dez `select 1` divididos por dez — custo de UMA ida e volta |
| `latenciaTrabalhoMs` | uma viagem só, varrendo 200 mil linhas no servidor |

```
por viagem alto, trabalho rápido  → o caminho da conexão (pooler, rede)
trabalho também lento             → a instância do banco está sufocada
```

Referência de um Postgres local saudável: `porViagemMs: 1`,
`latenciaTrabalhoMs: 26`. O trabalho custa ~26× uma viagem. Se em produção essa
proporção estiver invertida, o problema é o caminho; se as duas escalarem
juntas, é a máquina.

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
