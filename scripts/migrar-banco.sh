#!/usr/bin/env bash
#
# Move o banco inteiro de um Postgres para outro. Ver docs/14-migracao-do-banco.md
#
#     ORIGEM='postgresql://...' DESTINO='postgresql://...' scripts/migrar-banco.sh
#
# Só o schema `public` — é onde mora tudo do app. Os schemas do Supabase
# (auth, storage, extensions) pertencem ao projeto novo e não devem ser
# sobrescritos.
#
# NÃO imprime as URLs em lugar nenhum: elas carregam a senha do banco. Só o
# host aparece, mascarado.
#
# Ele PARA em vez de improvisar em cada uma das situações que estragariam a
# migração em silêncio:
#   · pg_dump mais velho que o servidor de origem (dump incompleto);
#   · destino que já tem tabelas (mistura de dados);
#   · qualquer erro do psql durante a restauração (restauração parcial).

set -euo pipefail

if [ -z "${ORIGEM:-}" ] || [ -z "${DESTINO:-}" ]; then
  echo "Faltam ORIGEM e/ou DESTINO." >&2
  echo "  ORIGEM='postgresql://...' DESTINO='postgresql://...' $0" >&2
  exit 1
fi

DESTINO_DIR="${DESTINO_DIR:-.}"
CARIMBO="$(date +%Y%m%d-%H%M%S)"
DUMP="$DESTINO_DIR/dump-$CARIMBO.sql"

# `…host:porta`, sem usuário e sem senha.
mascarar() {
  printf '%s' "$1" | sed -E 's#^[a-z]+://[^@]*@#…#; s#/[^/?]*(\?.*)?$##'
}

# A URL do Prisma NÃO serve para o psql.
#
# `?schema=public`, `?pgbouncer=true`, `?connection_limit=5` são invenções do
# Prisma; o libpq recusa a conexão inteira ao ver qualquer uma
# ("invalid URI query parameter"). Então fica só o que o libpq conhece.
para_libpq() {
  local url="$1" base params saida=''
  base="${url%%\?*}"
  params="${url#*\?}"
  [ "$params" = "$url" ] && { printf '%s' "$base"; return; }

  local IFS='&' par chave
  for par in $params; do
    chave="${par%%=*}"
    case "$chave" in
      sslmode|sslcert|sslkey|sslrootcert|connect_timeout|application_name|options|target_session_attrs)
        saida="${saida:+$saida&}$par" ;;
    esac
  done
  printf '%s%s' "$base" "${saida:+?$saida}"
}

# O Supabase tem DOIS poolers, e só um serve aqui.
#
#   · transação, porta 6543 — não mantém sessão, e `pg_dump` precisa de uma;
#   · sessão,    porta 5432 em <cluster>.pooler.supabase.com — serve.
#
# A conexão direta (`db.<ref>.supabase.co`) também serviria, mas hoje ela só
# resolve em IPv6 e boa parte das redes — o runner do GitHub entre elas — não
# alcança. Então o caminho recomendado é o **Session pooler**, e recusar tudo
# que diz "pooler" seria bloquear justamente o que funciona: o que se recusa é
# a porta 6543.
recusar_pooler_de_transacao() {
  case "$1" in
    *:6543/*|*:6543)
      echo "Esta é a URL do pooler de TRANSAÇÃO (porta 6543)." >&2
      echo "Ele não mantém sessão, e dump/restore precisa de uma." >&2
      echo "Use o Session pooler: Project Settings → Database →" >&2
      echo "Connection string → Session pooler (porta 5432)." >&2
      exit 1 ;;
  esac
}

echo "origem:  $(mascarar "$ORIGEM")"
echo "destino: $(mascarar "$DESTINO")"
echo

recusar_pooler_de_transacao "$ORIGEM"
recusar_pooler_de_transacao "$DESTINO"
ORIGEM_PG="$(para_libpq "$ORIGEM")"
DESTINO_PG="$(para_libpq "$DESTINO")"

# ── 1. Versões ──────────────────────────────────────────────────────────────
# Um pg_dump mais velho que o servidor produz dump incompleto SEM avisar. É a
# forma nº 1 de perder dados numa migração.
versao_servidor() { psql "$1" -tAc 'show server_version_num' | cut -c1-2; }
versao_ferramenta() { pg_dump --version | grep -oE '[0-9]+' | head -1; }

SERVIDOR="$(versao_servidor "$ORIGEM_PG")"
FERRAMENTA="$(versao_ferramenta)"
echo "servidor de origem: PostgreSQL $SERVIDOR · pg_dump local: $FERRAMENTA"
if [ "$FERRAMENTA" -lt "$SERVIDOR" ]; then
  echo >&2
  echo "pg_dump $FERRAMENTA é mais velho que o servidor $SERVIDOR." >&2
  echo "Ele geraria um dump incompleto sem reclamar. Instale o cliente $SERVIDOR:" >&2
  echo "  brew install postgresql@$SERVIDOR   # e ponha no PATH" >&2
  exit 1
fi

# ── 2. Destino precisa estar vazio ──────────────────────────────────────────
TABELAS_DESTINO="$(psql "$DESTINO_PG" -tAc \
  "select count(*) from information_schema.tables where table_schema='public'")"
if [ "$TABELAS_DESTINO" != "0" ]; then
  echo >&2
  echo "O destino já tem $TABELAS_DESTINO tabela(s) no schema public." >&2
  echo "Restaurar por cima misturaria dados. Para recomeçar do zero, rode NO DESTINO:" >&2
  echo "  drop schema public cascade; create schema public;" >&2
  echo "  grant usage on schema public to anon, authenticated, service_role;" >&2
  exit 1
fi

# ── 3. Dump ─────────────────────────────────────────────────────────────────
# `--no-owner --no-privileges`: quem restaura vira dono, e as permissões são
# reaplicadas depois, explicitamente. Carregar os GRANTs do projeto antigo faz
# a restauração inteira falhar se algum papel não existir no destino — e o
# preço de perdê-los é zero, porque o bloco no fim os recria.
echo
echo "gerando dump em $DUMP …"
pg_dump "$ORIGEM_PG" --schema=public --no-owner --no-privileges --format=plain --file="$DUMP"
echo "dump: $(wc -l < "$DUMP") linhas, $(du -h "$DUMP" | cut -f1)"

# ── 4. Restauração ──────────────────────────────────────────────────────────
# ON_ERROR_STOP: sem isso o psql segue depois de um erro e termina com "sucesso"
# tendo restaurado metade — o pior desfecho possível aqui.
#
# O dump traz `CREATE SCHEMA public` (desde o PostgreSQL 15 o schema public
# deixou de ser implícito e passou a ser dumpado como qualquer outro), então o
# `public` que já existe no projeto novo precisa sair da frente. É seguro: a
# checagem acima já garantiu que ele não tem tabela nenhuma.
echo
echo "limpando o schema public do destino (0 tabelas, conferido acima) …"
psql "$DESTINO_PG" --set ON_ERROR_STOP=on --quiet \
  -c 'drop schema if exists public cascade' \
  > /dev/null

echo "restaurando no destino …"
psql "$DESTINO_PG" --set ON_ERROR_STOP=on --quiet --file="$DUMP" > /dev/null

# As permissões, agora explicitamente. São elas que fazem o editor de tabelas
# do painel do Supabase enxergar as tabelas. Idempotente, e pula sozinho onde
# esses papéis não existem — num Postgres comum, por exemplo.
psql "$DESTINO_PG" --set ON_ERROR_STOP=on --quiet -c "
  do \$\$
  declare papel text;
  begin
    foreach papel in array array['anon','authenticated','service_role'] loop
      if exists (select 1 from pg_roles where rolname = papel) then
        execute format('grant usage on schema public to %I', papel);
        execute format('grant all on all tables in schema public to %I', papel);
        execute format('grant all on all sequences in schema public to %I', papel);
      end if;
    end loop;
  end
  \$\$;" > /dev/null

echo
echo "pronto. o dump ficou em $DUMP — guarde até conferir tudo."
echo "confira agora com:"
echo "  ORIGEM=… DESTINO=… scripts/conferir-migracao.sh"
