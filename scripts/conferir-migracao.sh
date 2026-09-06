#!/usr/bin/env bash
#
# Origem e destino têm as mesmas linhas? Ver docs/14-migracao-do-banco.md
#
#     ORIGEM='postgresql://...' DESTINO='postgresql://...' scripts/conferir-migracao.sh
#
# Compara a contagem de TODA tabela do schema public, nos dois bancos, e sai
# com código 1 se alguma divergir. Uma tabela esquecida numa migração não faz
# barulho: o app abre, funciona, e a falta só aparece semanas depois quando
# alguém procura um lançamento que sumiu.
#
# Também confere o schema contra o `prisma/schema.prisma`: restaurar um dump
# velho num projeto novo é a forma silenciosa de voltar no tempo.

set -euo pipefail

if [ -z "${ORIGEM:-}" ] || [ -z "${DESTINO:-}" ]; then
  echo "Faltam ORIGEM e/ou DESTINO." >&2
  exit 1
fi

# Mesma limpeza de `migrar-banco.sh`: o libpq recusa os parâmetros do Prisma.
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

ORIGEM_PG="$(para_libpq "$ORIGEM")"
DESTINO_PG="$(para_libpq "$DESTINO")"

contagens() {
  # Uma consulta só, montada a partir do catálogo: nada de listar tabela a
  # tabela e esquecer a que foi criada mês passado.
  psql "$1" -tAF'|' -c "
    select table_name,
           (xpath('/row/c/text()',
                  query_to_xml(format('select count(*) as c from public.%I', table_name),
                               false, true, '')))[1]::text::bigint as linhas
      from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name"
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

contagens "$ORIGEM_PG"  > "$TMP/origem"
contagens "$DESTINO_PG" > "$TMP/destino"

divergentes=0
total_origem=0

printf '%-28s %10s %10s\n' TABELA ORIGEM DESTINO
printf '%-28s %10s %10s\n' '----------------------------' '---------' '---------'

while IFS='|' read -r tabela linhas; do
  [ -z "$tabela" ] && continue
  destino="$(awk -F'|' -v t="$tabela" '$1==t {print $2}' "$TMP/destino")"
  destino="${destino:-AUSENTE}"
  total_origem=$((total_origem + linhas))
  if [ "$destino" = "$linhas" ]; then
    printf '%-28s %10s %10s\n' "$tabela" "$linhas" "$destino"
  else
    printf '%-28s %10s %10s   <== DIFERE\n' "$tabela" "$linhas" "$destino"
    divergentes=$((divergentes + 1))
  fi
done < "$TMP/origem"

# Tabela que existe só no destino também é divergência: quer dizer que o
# destino não estava vazio, e há dado de outra origem misturado.
while IFS='|' read -r tabela _; do
  [ -z "$tabela" ] && continue
  if ! grep -q "^$tabela|" "$TMP/origem"; then
    printf '%-28s %10s %10s   <== SÓ NO DESTINO\n' "$tabela" '-' '?'
    divergentes=$((divergentes + 1))
  fi
done < "$TMP/destino"

echo
echo "linhas na origem: $total_origem"

# ── O schema do destino é o que o código espera? ────────────────────────────
echo
echo "conferindo o schema contra prisma/schema.prisma …"
DELTA="$(npx prisma migrate diff \
  --from-url "$DESTINO" \
  --to-schema-datamodel prisma/schema.prisma \
  --script 2>/dev/null || true)"

if printf '%s' "$DELTA" | grep -qiE '^\s*(CREATE|ALTER|DROP)'; then
  echo "O destino NÃO bate com o schema. Faltou algo no dump:" >&2
  printf '%s\n' "$DELTA" | grep -iE '^\s*(CREATE|ALTER|DROP)' | head -20 >&2
  divergentes=$((divergentes + 1))
else
  echo "schema em dia."
fi

echo
if [ "$divergentes" -eq 0 ]; then
  echo "TUDO CONFERE."
else
  echo "$divergentes divergência(s). NÃO troque a DATABASE_URL ainda." >&2
  exit 1
fi
